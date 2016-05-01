var PouchDB = require('pouchdb');
var BPromise = require('bluebird');
var memdown = require('memdown');

var listener = require('./listener');

var shutdown = false;

var pouchMirror = module.exports = function(dbname, remoteURL, options) {

  var self = this;

  this.remoteDB = new PouchDB(remoteURL);
  this.localDB = new PouchDB(dbname, {'db': memdown});
  // Until the memory database is in sync, we will read from the remote DB
  this.readDB = this.remoteDB;
  this.DBSynced = false;

  // Set default options
  if(!options) {
    options = {};
  }
  options.initialTimeout = options.timeout || 1000;
  options.backoff = options.backoff || 2;
  options.maxTimeout = options.maxTimeout || 600000; // ten minutes
  options.noRetry = options.noRetry || false;

  // Start buffering changes as they come in
  self.listener = new listener(self.localDB);

  // Continuous replication with exponential back-off retry

  function startLiveReplication() {
    PouchDB.debug.enable('*');
    self.replicator = self.localDB.replicate.from(remoteURL, 
        { 
          live: true, 
          retry:true,
          back_off_function: function(delay){
            if (delay === 0){
              delay = options.initialTimeout;
              
              return delay;
            }
            delay *= options.backoff;
            if (delay > options.maxTimeout) {
              delay = options.maxTimeout;
            }
            
            return delay;
          } 
        }
      )
      .on('change', function () {
        self.DBSynced = false;
        self.readDB = self.remoteDB;
        console.log('Processing replication changes');
      })
      .on('denied', function(){
        console.warn('Error: Live replication failed. Access denied.');
      })
      .on('paused', function (err) {
        if (err){
          console.warn('Error: Live replication failed. Attempting to resume.');
          console.warn(err);
          return;  
        }
        if (!self.DBSynced) {
          self.DBSynced = true;
          self.readDB = self.localDB;
          console.log('Replication sync of ' + dbname + ' paused.');
        }
      })
      .on('active', function(){
        console.log('Replication is active.');
      })
      .on('error', function (err) {
        self.DBSynced = false;
        self.readDB = self.remoteDB;
        if (shutdown || options.noRetry) return;
        console.error('Error: Live replication failed fatally!');
        console.error(err);
      });
  }

  this.remoteDB
    .then(function() {
      startLiveReplication();
    });

};

pouchMirror.prototype.createIndex = function (obj) {
  return this.localDB.createIndex(obj);
};

pouchMirror.prototype.destroy = function (obj) {
  this.cancelSync();
  return this.localDB.destroy(obj);
};

pouchMirror.prototype.find = function (obj) {
  return this.localDB.find(obj);
};

pouchMirror.prototype.getIndexes = function () {
  return this.localDB.getIndexes();
};

pouchMirror.prototype.deleteIndex = function (obj) {
  return this.localDB.deleteIndex(obj);
};

pouchMirror.prototype.get = function () {
  var args = processArgs(arguments);
  var promise = this.readDB.get.apply(this.readDB, args.args);
  if (args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.allDocs = function () {
  var args = processArgs(arguments);
  var promise = this.readDB.allDocs.apply(this.readDB, args.args);
  if (args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.put = function () {
  var args = processArgs(arguments);
  var self = this;
  var output;
  var promise = self.remoteDB.put.apply(self.remoteDB, args.args)
    .then(function (response) {
      output = response;
      return self.listener.waitForChange(response.rev);
    })
    .then(function () {
      return BPromise.resolve(output);
    });
  if (args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.post = function () {
  var args = processArgs(arguments);
  var self = this;
  var output;
  var promise = self.remoteDB.post.apply(self.remoteDB, args.args)
    .then(function (response) {
      output = response;
      return self.listener.waitForChange(response.rev);
    })
    .then(function () {
      return BPromise.resolve(output);
    });
  if (args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.bulkDocs = function () {
  var args = processArgs(arguments);
  var self = this;
  var output;
  var promise = self.remoteDB.bulkDocs.apply(self.remoteDB, args.args)
    .then(function (results) {
      output = results;
      var promises = [];
      results.forEach(function (row) {
        if (row.ok === true) {
          promises.push(self.listener.waitForChange(row.rev));
        }
      });
      return BPromise.all(promises);
    })
    .then(function () {
      return BPromise.resolve(output);
    });
  if (args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.remove = function () {
  var args = processArgs(arguments);
  var self = this;
  var output;
  var promise = self.remoteDB.remove.apply(self.remoteDB, args.args)
    .then(function (result) {
      output = result;
      return self.listener.waitForChange(result.rev);
    })
    .then(function () {
      return BPromise.resolve(output);
    });
  if (args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.changes = function () {
  var args = processArgs(arguments);
  var promise = this.localDB.changes.apply(this.localDB, args.args);
  if (args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.replicate = function () {
  var args = processArgs(arguments);
  var promise = this.localDB.replicate.apply(this.localDB, args.args);
  if (args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.sync = function () {
  return this.localDB.sync.apply(this.localDB, arguments);
};

pouchMirror.prototype.putAttachment = function () {
  var args = processArgs(arguments);
  var self = this;
  var output;
  var promise = self.remoteDB.putAttachment.apply(self.remoteDB, args.args)
    .then(function (response) {
      output = response;
      return self.listener.waitForChange(response.rev);
    })
    .then(function () {
      return BPromise.resolve(output);
    });
  if (args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.getAttachment = function () {
  var args = processArgs(arguments);
  var promise = this.readDB.getAttachment.apply(this.readDB, args.args);
  if (args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.removeAttachment = function () {
  var args = processArgs(arguments);
  var self = this;
  var output;
  var promise = self.remoteDB.removeAttachment.apply(self.remoteDB, args.args)
    .then(function (response) {
      output = response;
      return self.listener.waitForChange(response.rev);
    })
    .then(function () {
      return BPromise.resolve(output);
    });
  if (args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.query = function () {
  var args = processArgs(arguments);
  var promise = this.readDB.query.apply(this.readDB, args.args);
  if (args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.info = function () {
  var args = processArgs(arguments);
  var self = this;
  var theinfo = {};
  var promise = new BPromise(function (resolve, reject) {
    BPromise.all([self.remoteDB.info(), self.localDB.info()])
      .then(function (results) {
        theinfo.remote = results[0];
        theinfo.local = results[1];
        return resolve(theinfo);
      }, function (err) {
        return reject(err);
      });
  });
  if (args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.cancelSync = function () {
  shutdown = true;
  this.replicator.cancel();
};

// Creates an object that separates the callback from the rest of the arguments
var processArgs = function (args) {
  args = Array.prototype.slice.call(args);
  if (typeof args[args.length - 1] === 'function') {
    var callback = args.pop();
    return { args: args, cb: callback };
  } else {
    return { args: args, cb: null };
  }
};
