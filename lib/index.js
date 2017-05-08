'use strict';

var getStrategy = require('./strategy'), 

PouchMirror = module.exports = function (localDB, remote, strategy) {
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
      self[name] = localDB[name].bind(localDB);
    }
    for(var prop in localDB) {
      if(prop.charAt(0) !== '_' && typeof localDB[prop] === 'function' && !self[prop]) {
        passThroughFn(prop);
      }
    }
  }

  cloneLocalDB();
  
  self._strategy = getStrategy(self, strategy);
};

PouchMirror.prototype.start = function (options) {
  var self = this;
  return self._strategy.start(options);
};

PouchMirror.prototype.pause = function() {
  var self = this;
  self._strategy.pause();
};

PouchMirror.prototype.get = function () {
  var self = this;
  return self._strategy.get.apply(self._strategy, arguments);
};

PouchMirror.prototype.allDocs = function () {
  var self = this;
  return self._strategy.allDocs.apply(self._strategy, arguments);
};

PouchMirror.prototype.bulkGet = function () {
  var self = this;
  return self._strategy.bulkGet.apply(self._strategy, arguments);
};

PouchMirror.prototype.put = function () {
  var self = this;
  return self._strategy.put.apply(self._strategy, arguments);
};

PouchMirror.prototype.post = function () {
  var self = this;
  return self._strategy.post.apply(self._strategy, arguments);
};

PouchMirror.prototype.bulkDocs = function () {
  var self = this;
  return self._strategy.bulkDocs.apply(self._strategy, arguments);
};

PouchMirror.prototype.remove = function () {
  var self = this;
  return self._strategy.remove.apply(self._strategy, arguments);
};

PouchMirror.prototype.putAttachment = function () {
  var self = this;
  return self._strategy.putAttachment.apply(self._strategy, arguments);
};

PouchMirror.prototype.getAttachment = function () {
  var self = this;
  return self._strategy.getAttachment.apply(self._strategy, arguments);
};

PouchMirror.prototype.removeAttachment = function () {
  var self = this;
  return self._strategy.removeAttachment.apply(self._strategy, arguments);
};

PouchMirror.prototype.query = function () {
  var self = this;
  return self._strategy.query.apply(self._strategy, arguments);
};

PouchMirror.prototype.info = function () {
  var self = this;
  return self._strategy.info.apply(self._strategy, arguments);
};

PouchMirror.prototype.replicate = {
  to: function() {
    this._strategy.replicate.to.apply(self._strategy, arguments);
  },
  from: function() {
    this._strategy.replicate.from.apply(self._strategy, arguments);
  }
};

if(typeof window === 'object') {
  window.PouchMirror = PouchMirror;
}