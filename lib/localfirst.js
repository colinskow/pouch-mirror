'use strict';

var Backoff = require('./backoff'),
Listener = require('./listener'), 
utils = require('./utils'), 
processArgs = utils.processArgs,
callbackify = utils.callbackify,

LocalFirst = function (pouchMirror){
    var self = this;
    self.pouchMirror = pouchMirror;
    self._localDB = pouchMirror._localDB;
    self._remoteDB = pouchMirror._remoteDB;
    self._initState();
};

LocalFirst.prototype._initState = function(failOver) {
  var self = this;
  // remoteDB is the source of truth until initial sync is complete
  if (!failOver){
    self._writeDB = self._readDB = self._remoteDB;
  }
  else {
    // Sync failed fatally, failover to localDB
    self._writeDB = self._readDB = self._localDB;
  }
  self._remoteSynced = false;
  self._active = false;
};

LocalFirst.prototype._destroyIfPending = function(){
    var self = this;
    if (typeof self._resolvePendingDestroy == 'function'){
      self._resolvePendingDestroy();
      self._resolvePendingDestroy = null;
    }
};

LocalFirst.prototype.destroy = function(){
    var self = this,
        args = arguments;
    // If delta sync is scheduled, wait for it to complete.
    if (self._deltaSyncHandle != null){
        return (new Promise(function (resolve, reject){
            self._resolvePendingDestroy = resolve;
        })
        .then(function(){
            return self.destroy.apply(self, args);
        }));
    }
    
    return self._localDB.destroy.apply(self._localDB, args);
};

LocalFirst.prototype._deltaSync = function(){
    var self = this;
    self._listener = new Listener(self._localDB);
    var replicator = self._localDB.sync(self._remoteDB, 
    {
        live: false,
        back_off_function: self._defaultBackoff
    })
    .on('complete', function (info) {
      if (!self._remoteSynced) {
        self._remoteSynced = true;
        self._deltaSyncHandle = null;
        replicator.emit('up-to-date-delta', {db: self._localDB._db_name});
        self._destroyIfPending();
      }
    })
    .on('pause', function(err){
     if (err){
        console.error('[PouchMirror] Non-fatal delta replication error', err);
     }
    })
    .on('denied', function (err) {
      console.error('[PouchMirror] Fatal delta replication error', err);
      self._listener.cancel();
      self._deltaSyncHandle = null;
      self._destroyIfPending();
    })
    .on('error', function (err) {
      console.error('[PouchMirror] Fatal replication error', err);
      self._listener.cancel();
      self._deltaSyncHandle = null;
      self._destroyIfPending();
    });
  
  replicator._superCancel = replicator.cancel;
  replicator.cancel = function() {
    self._listener.cancel();
    replicator._superCancel();
  };
  self._deltaSyncReplicator = replicator;
  return replicator;
};

LocalFirst.prototype._scheduleDeltaSyncOnce = function(debounceIntervalInMs){
    var self = this;
    // Clear pending sync on re-entry.
    if (self._deltaSyncHandle){
        clearTimeout(self._deltaSyncHandle);
        self._deltaSyncHandle = null;
    }
    
    self._deltaSyncHandle = setTimeout(self._deltaSync.bind(self), debounceIntervalInMs);
};

LocalFirst.prototype._monitorLocalChanges = function(debounceIntervalInMs){
    var self = this;
    self._localDB.changes({
        since: 'now',
        live: true})
    .on('change', self._scheduleDeltaSyncOnce.bind(self, debounceIntervalInMs))
    .on('error', function(err){
        console.error('[PouchMirror] Non-fatal changes feed error', err);
    });
};

LocalFirst.prototype.start = function (options) {
  var self = this;
  if(!options) options = {};
  options.live = false;
  if(options.retry && typeof options.back_off_function !== 'function') {
    var backoff = new Backoff(options.maxTimeout);
    options.back_off_function = backoff;
    // Store this for delta-sync too.
    self._defaultBackoff = backoff;
  }
  if (self._active) throw new Error('[PouchMirror] Error: sync already active');
  self._active = true;
  // Start buffering changes as they come in
  self._listener = new Listener(self._localDB);
  var replicator = self._localDB.sync(self._remoteDB, options)
    .on('complete', function (info) {
        console.log('initial-sync-completed');
      if (!self._remoteSynced) {
        self._remoteSynced = true;
        // Switch local DB as the source of truth.
        self._writeDB = self._readDB = self._localDB;
        replicator.emit('up-to-date', {db: self._localDB._db_name});
        // Start monitoring local changes
        self._monitorLocalChanges(options.debounceInterval || 1000);
      }
    })
    .on('pause', function(err){
     if (err){
        console.error('[PouchMirror] Non-fatal replication error', err);
     }
    })
    .on('denied', function (err) {
      self._listener.cancel();
      self._initState(true);
      console.error('[PouchMirror] Fatal replication error', err);
    })
    .on('error', function (err) {
      self._listener.cancel();
      self._initState(true);
      console.error('[PouchMirror] Fatal replication error', err);
    });
  replicator._superCancel = replicator.cancel;
  replicator.cancel = function() {
    self._listener.cancel();
    replicator._superCancel();
    self._initState();
  };
  self._syncReplicator = replicator;
  return replicator;
};

LocalFirst.prototype.pause = function() {
  var self = this;
  self._syncReplicator.cancel();
  self._deltaSyncReplicator.cancel();
};

LocalFirst.prototype.get = function () {
  var self = this;
  return self._readDB.get.apply(self._readDB, arguments);
};

LocalFirst.prototype.allDocs = function () {
  var self = this;
  return self._readDB.allDocs.apply(self._readDB, arguments);
};

LocalFirst.prototype.bulkGet = function () {
  var self = this;
  return self._readDB.bulkGet.apply(self._readDB, arguments);
};

LocalFirst.prototype.put = function () {
  var self = this;
  var argObj = processArgs(arguments);
  var output;
  var promise = self._writeDB.put.apply(self._writeDB, argObj.args)
    .then(function (response) {
      output = response;
      if(!self._active) return Promise.resolve();
      return self._listener.waitForChange(response.rev);
    })
    .then(function () {
      return Promise.resolve(output);
    });
  if (argObj.cb) callbackify(promise, argObj.cb);
  return promise;
};

LocalFirst.prototype.post = function () {
  var self = this;
  var argObj = processArgs(arguments);
  var output;
  console.log("Writing to remotedDB? " + (self._writeDB == self._remoteDB));
  console.log("Writing to localDB? " + (self._writeDB == self._localDB));
  var promise = self._writeDB.post.apply(self._writeDB, argObj.args)
    .then(function (response) {
      output = response;
      if(!self._active) return Promise.resolve();
      return self._listener.waitForChange(response.rev);
    })
    .then(function () {
      return Promise.resolve(output);
    });
  if (argObj.cb) callbackify(promise, argObj.cb);
  return promise;
};

LocalFirst.prototype.bulkDocs = function () {
  var self = this;
  var argObj = processArgs(arguments);
  var output;
  var promise = self._writeDB.bulkDocs.apply(self._writeDB, argObj.args)
    .then(function (results) {
      output = results;
      var promises = [];
      results.forEach(function (row) {
        if (row.ok === true) {
          promises.push(self._listener.waitForChange(row.rev));
        }
      });
      if(!self._active) return Promise.resolve();
      return Promise.all(promises);
    })
    .then(function () {
      return Promise.resolve(output);
    });
  if (argObj.cb) callbackify(promise, argObj.cb);
  return promise;
};

LocalFirst.prototype.remove = function () {
  var self = this;
  var argObj = processArgs(arguments);
  var output;
  var promise = self._writeDB.remove.apply(self._writeDB, argObj.args)
    .then(function (result) {
      output = result;
      if(!self._active) return Promise.resolve();
      return self._listener.waitForChange(result.rev);
    })
    .then(function () {
      return Promise.resolve(output);
    });
  if (argObj.cb) callbackify(promise, argObj.cb);
  return promise;
};

LocalFirst.prototype.putAttachment = function () {
  var self = this;
  var argObj = processArgs(arguments);
  var output;
  var promise = self._writeDB.putAttachment.apply(self._writeDB, argObj.args)
    .then(function (response) {
      output = response;
      if(!self._active) return Promise.resolve();
      return self._listener.waitForChange(response.rev);
    })
    .then(function () {
      return Promise.resolve(output);
    });
  if (argObj.cb) callbackify(promise, argObj.cb);
  return promise;
};

LocalFirst.prototype.getAttachment = function () {
  var self = this;
  return self._readDB.getAttachment.apply(self._readDB, arguments);
};

LocalFirst.prototype.removeAttachment = function () {
  var self = this;
  var argObj = processArgs(arguments);
  var output;
  var promise = self._writeDB.removeAttachment.apply(self._writeDB, argObj.args)
    .then(function (response) {
      output = response;
      if(!self._active) return Promise.resolve();
      return self._listener.waitForChange(response.rev);
    })
    .then(function () {
      return Promise.resolve(output);
    });
  if (argObj.cb) callbackify(promise, argObj.cb);
  return promise;
};

LocalFirst.prototype.query = function () {
  var self = this;
  return self._readDB.query.apply(self._readDB, arguments);
};

LocalFirst.prototype.info = function () {
  var self = this;
  var argObj = processArgs(arguments);
  var theinfo = {};
  var promise = Promise.all([
      self._remoteDB.info.apply(self._remoteDB, argObj.args),
      self._localDB.info.apply(self._localDB, argObj.args)
    ])
    .then(function (results) {
      theinfo.remote = results[0];
      theinfo.local = results[1];
      return Promise.resolve(theinfo);
    });
  if (argObj.cb) callbackify(promise, argObj.cb);
  return promise;
};

LocalFirst.prototype.replicate = {
  to: function() {
    this._localDB.replicate.to.apply(this._localDB, arguments);
  },
  from: function() {
    this._localDB.replicate.from.apply(this._localDB, arguments);
  }
};

module.exports = LocalFirst;