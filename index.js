var PouchDB = require('pouchdb');
var Promise = require('bluebird');
var memdown = require('memdown');
var listener = require('./listener');

var pouchMirror = module.exports = function(dbname, remoteURL) {

  var self = this;

  this.remoteDB = new PouchDB(remoteURL);
  this.localDB = new PouchDB(dbname, {'db': memdown});
  // Until the memory database is in sync, we will read from the remote DB
  this.readDB = this.remoteDB;
  this.DBSynced = false;
  // Perform the initial sync and notify when complete

  // return Promise.all([this.remoteDB, this.localDB])
  this.remoteDB
    .then(function() {
      self.replicator = self.localDB.replicate.from(remoteURL, {live: true})
        .on('uptodate', function() {
          if(!self.DBSynced) {
            self.DBSynced = true;
            self.readDB = self.localDB;
            console.log('Initial sync of ' + dbname + ' complete.');
          }
        })
        .on('complete', function (info) {
          console.log('Error: Live replication failed!');
          console.log(info);
        })
        .on('error', function (err) {
          console.log(err);
        });
      self.listener = new listener(self.localDB);
    })
    .catch(function(err) {
      throw new Error(err);
    });
};

pouchMirror.prototype.get = function() {
  var args = processArgs(arguments);
  var promise = this.readDB.get.apply(this.readDB, args.args);
  if(args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.allDocs = function() {
  var args = processArgs(arguments);
  var promise = this.readDB.allDocs.apply(this.readDB, args.args);
  if(args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.put = function() {
  var args = processArgs(arguments);
  var self = this;
  var output;
  var promise = self.remoteDB.put.apply(self.remoteDB, args.args)
    .then(function(response) {
      output = response;
      return self.listener.waitForChange(response.rev);
    })
    .then(function() {
      return Promise.resolve(output);
    });
  if(args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.post = function() {
  var args = processArgs(arguments);
  var self = this;
  var output;
  var promise = self.remoteDB.post.apply(self.remoteDB, args.args)
    .then(function(response) {
      output = response;
      return self.listener.waitForChange(response.rev);
    })
    .then(function() {
      return Promise.resolve(output);
    });
  if(args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.bulkDocs = function() {
  var args = processArgs(arguments);
  var self = this;
  var output;
  var promise = self.remoteDB.bulkDocs.apply(self.remoteDB, args.args)
    .then(function(results) {
      output = results;
      var promises = [];
      results.forEach(function(row){
        if(row.ok === true) {
          promises.push(self.listener.waitForChange(row.rev));
        }
      });
      return Promise.all(promises);
    })
    .then(function(){
      return Promise.resolve(output);
    });
  if(args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.remove = function() {
  var args = processArgs(arguments);
  var self = this;
  var output;
  var promise = self.remoteDB.remove.apply(self.remoteDB, args.args)
    .then(function(result) {
      output = result;
      return self.listener.waitForChange(result.rev);
    })
    .then(function() {
      return Promise.resolve(output);
    });
  if(args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.changes = function() {
  var args = processArgs(arguments);
  var promise = this.localDB.changes.apply(this.localDB, args.args);
  if(args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.replicate = function() {
  var args = processArgs(arguments);
  var promise = this.localDB.replicate.apply(this.localDB, args.args);
  if(args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.sync = function() {
  return this.localDB.sync.apply(this.localDB, arguments);
};

pouchMirror.prototype.putAttachment = function() {
  var args = processArgs(arguments);
  var self = this;
  var output;
  var promise = self.remoteDB.putAttachment.apply(self.remoteDB, args.args)
    .then(function(response) {
      output = response;
      return self.listener.waitForChange(response.rev);
    })
    .then(function() {
      return Promise.resolve(output);
    });
  if(args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.getAttachment = function() {
  var args = processArgs(arguments);
  var promise = this.readDB.getAttachment.apply(this.readDB, args.args);
  if(args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.removeAttachment = function() {
  var args = processArgs(arguments);
  var self = this;
  var output;
  var promise = self.remoteDB.removeAttachment.apply(self.remoteDB, args.args)
    .then(function(response) {
      output = response;
      return self.listener.waitForChange(response.rev);
    })
    .then(function() {
      return Promise.resolve(output);
    });
  if(args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.query = function() {
  var args = processArgs(arguments);
  var promise = this.readDB.query.apply(this.readDB, args.args);
  if(args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.info = function() {
  var args = processArgs(arguments);
  var self = this;
  var theinfo = {};
  var promise = new Promise(function(resolve, reject) {
    Promise.all([self.remoteDB.info(), self.localDB.info()])
      .then(function(results) {
        theinfo.remote = results[0];
        theinfo.local = results[1];
        return resolve(theinfo);
      }, function(err) {
        return reject(err);
      });
  });
  if(args.cb) promise.nodeify(args.cb);
  return promise;
};

pouchMirror.prototype.cancelSync = function() {
  this.replicator.cancel();
};

// Creates an object that separates the callback from the rest of the arguments
var processArgs = function(args) {
  args = Array.prototype.slice.call(args);
  if(typeof args[args.length-1] === 'function') {
    var callback = args.pop();
    return {args: args, cb: callback};
  } else {
    return {args: args, cb: null};
  }
};