'use strict';

var Listener = require('./listener');
var Backoff = require('./backoff');

var PouchMirror = module.exports = function (localDB, remote) {
  // self and localDB are the same object, but for clarity I will use localDB only in context of db operations
  var self = this;
  if(typeof localDB !== 'object' || !localDB.constructor) {
    throw new TypeError('[PouchMirror] localDB must be an instance of PouchDB');
  }
  self._localDB = localDB;
  var PouchDB = self._pouch = localDB.constructor;

  // remote is a URL string or a PouchDB instance
  if(typeof remote === 'string') {
    self._remoteDB = new PouchDB(remote);
  } else if(remote instanceof PouchDB) {
    self._remoteDB = remote;
  } else {
    throw new TypeError('remote must be a URL string or instance of PouchDB');
  }

  // Clone all the functions from the localDB into the PouchMirror instance
  function cloneLocalDB() {
    function passThroughFn(name) {
      self[name] = function() {
        return localDB[name].apply(localDB, arguments);
      };
    }
    for(var prop in localDB) {
      if(prop.charAt(0) !== '_' && typeof localDB[prop] === 'function' && !self[prop]) {
        passThroughFn(prop);
      }
    }
  }

  cloneLocalDB();
  self._initState();

};

PouchMirror.prototype._initState = function() {
  var self = this;
  // remoteDB is the source of truth until initial sync is complete
  self._readDB = self._remoteDB;
  self._remoteSynced = false;
  self._active = false;
};

PouchMirror.prototype.start = function (options) {
  var self = this;
  if(!options) options = {};
  options.live = true;
  if(options.retry && typeof options.back_off_function !== 'function') {
    var backoff = new Backoff(options.maxTimeout);
    options.back_off_function = backoff;
    // Export this for testing
    self._defaultBackoff = backoff;
  }
  if(self._active) throw new Error('[PouchMirror] Error: replication already active');
  self._active = true;
  // Start buffering changes as they come in
  self._listener = new Listener(self._localDB);
  var replicator = self._localDB.replicate.from(self._remoteDB, options)
    .on('paused', function (err) {
      if (err) return;
      if (!self._remoteSynced) {
        self._remoteSynced = true;
        self._readDB = self._localDB;
        replicator.emit('up-to-date', {db: self._localDB._db_name});
      }
    })
    .on('error', function (err) {
      self._listener.cancel();
      self._initState();
      console.error('[PouchMirror] Fatal replication error', err);
    });
  replicator._superCancel = replicator.cancel;
  replicator.cancel = function() {
    self._listener.cancel();
    replicator._superCancel();
    self._initState();
  };
  self._replicator = replicator;
  return replicator;
};

PouchMirror.prototype.pause = function() {
  var self = this;
  self._replicator.cancel();
};

PouchMirror.prototype.get = function () {
  var self = this;
  return self._readDB.get.apply(self._readDB, arguments);
};

PouchMirror.prototype.allDocs = function () {
  var self = this;
  return self._readDB.allDocs.apply(self._readDB, arguments);
};

PouchMirror.prototype.bulkGet = function () {
  var self = this;
  return self._readDB.bulkGet.apply(self._readDB, arguments);
};

PouchMirror.prototype.put = function () {
  var self = this;
  var argObj = processArgs(arguments);
  var output;
  var promise = self._remoteDB.put.apply(self._remoteDB, argObj.args)
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

PouchMirror.prototype.post = function () {
  var self = this;
  var argObj = processArgs(arguments);
  var output;
  var promise = self._remoteDB.post.apply(self._remoteDB, argObj.args)
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

PouchMirror.prototype.bulkDocs = function () {
  var self = this;
  var argObj = processArgs(arguments);
  var output;
  var promise = self._remoteDB.bulkDocs.apply(self._remoteDB, argObj.args)
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

PouchMirror.prototype.remove = function () {
  var self = this;
  var argObj = processArgs(arguments);
  var output;
  var promise = self._remoteDB.remove.apply(self._remoteDB, argObj.args)
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

PouchMirror.prototype.putAttachment = function () {
  var self = this;
  var argObj = processArgs(arguments);
  var output;
  var promise = self._remoteDB.putAttachment.apply(self._remoteDB, argObj.args)
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

PouchMirror.prototype.getAttachment = function () {
  var self = this;
  return self._readDB.getAttachment.apply(self._readDB, arguments);
};

PouchMirror.prototype.removeAttachment = function () {
  var self = this;
  var argObj = processArgs(arguments);
  var output;
  var promise = self._remoteDB.removeAttachment.apply(self._remoteDB, argObj.args)
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

PouchMirror.prototype.query = function () {
  var self = this;
  return self._readDB.query.apply(self._readDB, arguments);
};

PouchMirror.prototype.info = function () {
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

PouchMirror.prototype.replicate = {
  to: function() {
    this._localDB.replicate.to.apply(this._localDB, arguments);
  },
  from: function() {
    this._localDB.replicate.from.apply(this._localDB, arguments);
  }
};

// Creates an object that separates the callback from the rest of the arguments
function processArgs (args) {
  args = Array.prototype.slice.call(args);
  if (args.length && typeof args[args.length - 1] === 'function') {
    var callback = args.pop();
    return { args: args, cb: callback };
  } else {
    return { args: args, cb: null };
  }
}

function callbackify(promise, cb) {
  promise.then(function(result) {
    cb(null, result);
    return Promise.resolve(result);
  }, function(err) {
    cb(err, null);
    return Promise.reject(err);
  });
}

if(typeof window === 'object') {
  window.PouchMirror = PouchMirror;
}