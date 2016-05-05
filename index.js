var PouchDB = require('pouchdb');
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
  options.maxTimeout = options.maxTimeout || 600000; // ten minutes
  options.noRetry = options.noRetry || false;
  if(typeof options.back_off_function !== 'function') {
    options.back_off_function = defaultBackOff;
  }
  var timeout = options.initialTimeout;

  // Start buffering changes as they come in
  self.listener = new listener(self.localDB);

  // Continuous replication with exponential back-off retry

  function startLiveReplication() {
    self.replicator = self.localDB.replicate.from(remoteURL, 
        { 
          live: true, 
          retry: !options.noRetry,
          back_off_function: options.back_off_function
        }
      )
      .on('denied', function(err){
        console.warn('[PouchMirror] Warning', err);
      })
      .on('paused', function (err) {
        if (err) {
          console.warn('[PouchMirror] Warning', err);
          // return;
        }
        if (!self.DBSynced) {
          self.DBSynced = true;
          self.readDB = self.localDB;
          console.log('[PouchMirror] Initial replication of ' + dbname + ' complete.');
        }
      })
      .on('error', function (err) {
        self.DBSynced = false;
        self.readDB = self.remoteDB;
        if (shutdown || options.noRetry) return;
        console.error('[PouchMirror] Fatal replication error', err);
      });
  }

  this.remoteDB
    .then(function() {
      startLiveReplication();
    });

  // Backoff function from PouchDB
  // Starts with a random number between 0 and 2 seconds and doubles it after every failed connect
  // Will not go higher than options.maxTimeout
  function randomNumber(min, max) {
    min = parseInt(min, 10) || 0;
    max = parseInt(max, 10);
    if (max !== max || max <= min) {
      max = (min || 1) << 1; //doubling
    } else {
      max = max + 1;
    }
    // In order to not exceed maxTimeout, pick a random value between 50% of maxTimeout and maxTimeout
    if(max > options.maxTimeout) {
      min = options.maxTimeout >> 1; // divide by two
      max = options.maxTimeout;
    }
    var ratio = Math.random();
    var range = max - min;

    return ~~(range * ratio + min); // ~~ coerces to an int, but fast.
  }

  function defaultBackOff(min) {
    var max = 0;
    if (!min) {
      max = 2000;
    }
    return randomNumber(min, max);
  }

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
  if (args.cb) callbackify(promise, args.cb);
  return promise;
};

pouchMirror.prototype.allDocs = function () {
  var args = processArgs(arguments);
  var promise = this.readDB.allDocs.apply(this.readDB, args.args);
  if (args.cb) callbackify(promise, args.cb);
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
      return Promise.resolve(output);
    });
  if (args.cb) callbackify(promise, args.cb);
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
      return Promise.resolve(output);
    });
  if (args.cb) callbackify(promise, args.cb);
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
      return Promise.all(promises);
    })
    .then(function () {
      return Promise.resolve(output);
    });
  if (args.cb) callbackify(promise, args.cb);
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
      return Promise.resolve(output);
    });
  if (args.cb) callbackify(promise, args.cb);
  return promise;
};

pouchMirror.prototype.changes = function () {
  var args = processArgs(arguments);
  var promise = this.localDB.changes.apply(this.localDB, args.args);
  if (args.cb) callbackify(promise, args.cb);
  return promise;
};

pouchMirror.prototype.replicate = function () {
  var args = processArgs(arguments);
  var promise = this.localDB.replicate.apply(this.localDB, args.args);
  if (args.cb) callbackify(promise, args.cb);
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
      return Promise.resolve(output);
    });
  if (args.cb) callbackify(promise, args.cb);
  return promise;
};

pouchMirror.prototype.getAttachment = function () {
  var args = processArgs(arguments);
  var promise = this.readDB.getAttachment.apply(this.readDB, args.args);
  if (args.cb) callbackify(promise, args.cb);
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
      return Promise.resolve(output);
    });
  if (args.cb) callbackify(promise, args.cb);
  return promise;
};

pouchMirror.prototype.query = function () {
  var args = processArgs(arguments);
  var promise = this.readDB.query.apply(this.readDB, args.args);
  if (args.cb) callbackify(promise, args.cb);
  return promise;
};

pouchMirror.prototype.info = function () {
  var args = processArgs(arguments);
  var self = this;
  var theinfo = {};
  var promise = new Promise(function (resolve, reject) {
    Promise.all([self.remoteDB.info(), self.localDB.info()])
      .then(function (results) {
        theinfo.remote = results[0];
        theinfo.local = results[1];
        return resolve(theinfo);
      }, function (err) {
        return reject(err);
      });
  });
  if (args.cb) callbackify(promise, args.cb);
  return promise;
};

pouchMirror.prototype.cancelSync = function () {
  shutdown = true;
  this.replicator.cancel();
};

// Creates an object that separates the callback from the rest of the arguments
function processArgs (args) {
  args = Array.prototype.slice.call(args);
  if (typeof args[args.length - 1] === 'function') {
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