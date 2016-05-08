(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
module.exports = function Backoff(maxTimeout) {
  if(maxTimeout == null) {
    maxTimeout = 600000; // 10 minutes
  }

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
    if(maxTimeout && max > maxTimeout) {
      min = maxTimeout >> 1; // divide by two
      max = maxTimeout;
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

  return defaultBackOff;
};
},{}],2:[function(require,module,exports){
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
},{"./backoff":1,"./listener":3}],3:[function(require,module,exports){
'use strict';
var utils = require('./utils');
var defer = utils.defer;
var timeout = utils.timeout;

var timeLimit = 4900;

module.exports = function (db) {
  var pending = {};
  var bufferedChanges = {};

  // Keep a buffer of recent changes in case the change comes in before our response
  function bufferChange(rev) {
    bufferedChanges[rev] = new Date();
    // get rid of any expired changes
    for(var key in bufferedChanges) {
      if((bufferedChanges[key] + timeLimit) < new Date()) {
        delete bufferedChanges[key];
      }
    }
  }

  // Init Listener
  var listener = db.changes({ since: 'now', live: true })
    .on('change', function (change) {
      change.changes.forEach(function (item) {
        if(typeof pending[item.rev] !== 'undefined') {
          pending[item.rev].resolve({rev: item.rev});
          delete(pending[item.rev]);
        } else {
          bufferChange(item.rev);
        }
      });
    });

  function waitForChange(rev) {
    var deferred = defer();
    timeout(deferred.promise, timeLimit)
      .catch(Promise.TimeoutError, function(err) {
        delete(pending[rev]);
        return Promise.reject(err);
      });
    if(bufferedChanges[rev]) {
      deferred.resolve({rev: rev});
      delete bufferedChanges[rev];
    } else {
      pending[rev] = deferred;
    }
    return deferred.promise;
  }
  
  return {
    waitForChange: waitForChange,
    cancel: function() {
      return listener.cancel();
    }
  };

};
},{"./utils":4}],4:[function(require,module,exports){
'use strict';

exports.defer = function() {
  var resolve, reject;
  var promise = new Promise(function() {
    resolve = arguments[0];
    reject = arguments[1];
  });
  return {
    resolve: resolve,
    reject: reject,
    promise: promise
  };
};

exports.timeout = function(promise, time) {
  var done;
  var delayPromise = new Promise(function (resolve) {
    var timeout = setTimeout(resolve, time);
    done = function() {
      clearTimeout(timeout);
      resolve(true);
    };
  });
  return Promise.race([
    promise.then(function() {
      done();
    }),
    delayPromise.then(function (status) {
      if(!status) {
        throw new Error('Operation timed out');
      }
    })
  ]);
};
},{}]},{},[2]);
