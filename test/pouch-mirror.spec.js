'use strict';

// Only for Node.js tests
if(typeof window !== 'object') {
  var expect = require('chai').expect;
  var PouchDB = require('pouchdb');
  var memdown = require('memdown');
  var PouchMirror = require('../index');

  var dbOptions = {db: memdown};
} else {
  var expect = chai.expect;
  var dbOptions = {adapter: 'memory'};
}

var remoteURL = 'http://localhost:5984/pouchtest';
var dbname = 'pouchtest';

describe('PouchMirror', function () {

  var localDB, remoteDB, db, replicator, emitterPromise, previous;

  before(function() {
    // Used to make sure the previous test has completed before starting the next one
    previous = Promise.resolve();
    localDB = new PouchDB(dbname, dbOptions);
    remoteDB = new PouchDB(remoteURL);
    db = new PouchMirror(localDB, remoteDB);
    replicator = db.start();

    // To test the up-to-date event
    emitterPromise = new Promise(function(resolve) {
      replicator.on('up-to-date', function() {
        resolve();
      });
    });
  });

  after(function() {
    return Promise.all([db._remoteDB.destroy(), db._localDB.destroy()]);
  });

  describe('info()', function () {

    it('should return info from local and remote', function () {
      return previous
        .then(function() {
          return db.info();
        })
        .then(function (results) {
          expect(results.remote.db_name).to.equal(dbname);
          expect(results.local.db_name).to.equal(dbname);
        })
        .catch(function(err) {
          return Promise.reject(err);
        });
    });

  });

  describe('post() and remove()', function () {
    var newID;
    var newRev;
    var newDoc;

    it('should add a new document to both local and remote', function () {
      return previous
        .then(function() {
          return db.post({title: 'testdoc1'});
        })
        .then(function (response) {
          newID = response.id;
          newRev = response.rev;
          return localDB.get(newID);
        })
        .then(function (local) {
          newDoc = local;
          expect(local.title).to.equal('testdoc1');
          return db._remoteDB.get(newID);
        })
        .then(function (remote) {
          expect(newDoc._rev).to.equal(remote._rev);
          expect(remote.title).to.equal('testdoc1');
        })
        .catch(function(err) {
          return Promise.reject(err);
        });
    });

    it('should remove the document we just added', function () {
      return previous
        .then(function() {
          return db.remove(newID, newRev);
        })
        .then(function () {
          return db._localDB.get(newID);
        })
        .catch(function (err) {
          expect(err.reason || err.message).to.equal('deleted');
        });
    });

  });

  describe('bulkDocs', function () {
    var testDocs = [
      {_id: 'testDoc2', title: 'hello2'},
      {title: 'hello3'}
    ];
    it('should write two documents across remote and local', function () {
      return previous
        .then(function() {
          return db.bulkDocs(testDocs);
        })
        .then(function (results) {
          expect(results[0].id).to.equal('testDoc2');
        });
    });

  });

  describe('attachments', function () {
    
    var sampledoc = {
      _id: 'sampledoc'
    };

    var attachment =
      'TGVnZW5kYXJ5IGhlYXJ0cywgdGVhciB1cyBhbGwgYXBhcnQKTWFrZS' +
      'BvdXIgZW1vdGlvbnMgYmxlZWQsIGNyeWluZyBvdXQgaW4gbmVlZA==';
    
    it('should save, get, and remove an attachment', function () {
      var rev;
      return previous
        .then(function() {
          return db.put(sampledoc);
        })
        .then(function (result) {
          return db.putAttachment('sampledoc', 'text', result.rev, attachment, 'text/plain');
        })
        .then(function (result) {
          rev = result.rev;
          expect(result.ok).to.equal(true);
          return db.getAttachment('sampledoc', 'text');
        })
        .then(function (result) {
          expect(result.size || result.length).to.equal(79);
          return db.removeAttachment('sampledoc', 'text', rev);
        })
        .then(function (response) {
          expect(response.ok).to.equal(true);
        });
    });
    
  });

  describe('PouchMirror API', function() {

    it('should pass through functions from the localDB object', function() {
      expect(db.type()).to.equal('leveldb');
    });

    it('should work with callbacks', function() {
      return previous
        .then(function() {
          return new Promise(function(resolve) {
            db.put({_id: 'callback_test'}, function(err, result) {
              expect(result.id).to.equal('callback_test');
              db.get('callback_test', function(err, doc) {
                expect(doc._id).to.equal('callback_test');
                resolve(true);
              });
            });
          });
        });
    });

    it('should have emitted an up-to-date event', function() {
      return previous
        .then(function() {
          return emitterPromise;
        })
        .then(function() {
          expect(db._remoteSynced).to.equal(true);
          expect(db._readDB).to.equal(localDB);
        });
    });

    it('should pause and restart replication without error', function() {
      expect(db._active).to.equal(true);
      db.pause();
      expect(db._active).to.equal(false);
      expect(db._remoteSynced).to.equal(false);
      expect(db._readDB).to.equal(remoteDB);
      db.start();
      expect(db._active).to.equal(true);
    });

  });

});