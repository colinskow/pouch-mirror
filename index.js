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
  return this.readDB.get.apply(this.readDB, arguments);
};

pouchMirror.prototype.allDocs = function() {
  return this.readDB.allDocs.apply(this.readDB, arguments);
};

pouchMirror.prototype.put = function() {
  var self = this;
  var myArguments = argsArray(arguments);
  var output;
  return self.remoteDB.put.apply(self.remoteDB, myArguments)
    .then(function(response) {
      output = response;
      return self.listener.waitForChange(response.rev);
    })
    .then(function() {
      return Promise.resolve(output);
    })
    .catch(function(err) {
      throw new Error(err);
    });
};

pouchMirror.prototype.post = function() {
  var self = this;
  var myArguments = argsArray(arguments);
  var output;
  return self.remoteDB.post.apply(self.remoteDB, myArguments)
    .then(function(response) {
      output = response;
      return self.listener.waitForChange(response.rev);
    })
    .then(function() {
      return Promise.resolve(output);
    })
    .catch(function(err) {
      throw new Error(err);
    });
};

pouchMirror.prototype.bulkDocs = function() {
  var self = this;
  var myArguments = argsArray(arguments);
  var output;
  return self.remoteDB.bulkDocs.apply(self.remoteDB, myArguments)
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
    })
    .catch(function(err) {
      throw new Error(err);
    });
};

pouchMirror.prototype.remove = function() {
  var self = this;
  var myArguments = argsArray(arguments);
  var output;
  return self.remoteDB.remove.apply(self.remoteDB, myArguments)
    .then(function(result) {
      output = result;
      return self.listener.waitForChange(result.rev);
    })
    .then(function() {
      return Promise.resolve(output);
    })
    .catch(function(err) {
      throw new Error(err);
    });
};

pouchMirror.prototype.changes = function() {
  return this.localDB.changes.apply(this.localDB, arguments);
};

pouchMirror.prototype.replicate = function() {
  return this.localDB.replicate.apply(this.localDB, arguments);
};

pouchMirror.prototype.sync = function() {
  return this.localDB.sync.apply(this.localDB, arguments);
};

pouchMirror.prototype.putAttachment = function() {
  var self = this;
  var myArguments = argsArray(arguments);
  var output;
  return self.remoteDB.putAttachment.apply(self.remoteDB, myArguments)
    .then(function(response) {
      output = response;
      return self.listener.waitForChange(response.rev);
    })
    .then(function() {
      return Promise.resolve(output);
    })
    .catch(function(err) {
      throw new Error(err);
    });
};

pouchMirror.prototype.getAttachment = function() {
  return this.readDB.getAttachment.apply(this.readDB, arguments);
};

pouchMirror.prototype.removeAttachment = function() {
  var self = this;
  var myArguments = argsArray(arguments);
  var output;
  return self.remoteDB.removeAttachment.apply(self.remoteDB, myArguments)
    .then(function(response) {
      output = response;
      return self.listener.waitForChange(response.rev);
    })
    .then(function() {
      return Promise.resolve(output);
    })
    .catch(function(err) {
      throw new Error(err);
    });
};

pouchMirror.prototype.query = function() {
  return this.readDB.query.apply(this.readDB, arguments);
};

pouchMirror.prototype.info = function() {
  var self = this;
  var theinfo = {};
  return new Promise(function(resolve, reject) {
    Promise.all([self.remoteDB.info(), self.localDB.info()])
      .then(function(results) {
        theinfo.remote = results[0];
        theinfo.local = results[1];
        return resolve(theinfo);
      }, function(err) {
        return reject(err);
      });
  });
};

pouchMirror.prototype.cancelSync = function() {
  this.replicator.cancel();
};

var argsArray = function(args) {
  return Array.prototype.slice.call(args, 0);
};