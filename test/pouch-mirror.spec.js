'use strict';

// Only for Node.js tests
if(typeof window !== 'object') {
  var expect = require('chai').expect;
  var PouchDB = require('pouchdb');
  var memdown = require('memdown');
  var PouchMirror = require('../lib/index');

  var dbOptions = {db: memdown};
} else {
  // Browser variables
  var expect = chai.expect;
  var dbOptions = {adapter: 'memory'};
}

var remoteURL = 'http://localhost:5984/pouchtest';
var dbname = 'pouchtest';

describe (('PouchMirror'), function(){
  
  describe('Remote First', function () {

    var localDB, remoteDB, mirror, replicator, emitterPromise, previous;

    before(function() {
      // Used to make sure the previous test has completed before starting the next one
      previous = Promise.resolve();
      localDB = new PouchDB(dbname, dbOptions);
      remoteDB = new PouchDB(remoteURL);
      mirror = new PouchMirror(localDB, remoteDB);
      replicator = mirror.start({retry: true});

      // To test the up-to-date event
      emitterPromise = new Promise(function(resolve) {
        replicator.on('up-to-date', function() {
          resolve();
        });
      });
    });

    after(function() {
      return Promise.all([mirror._remoteDB.destroy(), mirror._localDB.destroy()]);
    });

    describe('info()', function () {

      it('should return info from local and remote', function () {
        return previous
          .then(function() {
            return mirror.info();
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
            return mirror.post({title: 'testdoc1'});
          })
          .then(function (response) {
            newID = response.id;
            newRev = response.rev;
            return localDB.get(newID);
          })
          .then(function (local) {
            newDoc = local;
            expect(local.title).to.equal('testdoc1');
            return mirror._remoteDB.get(newID);
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
            return mirror.remove(newID, newRev);
          })
          .then(function () {
            return mirror._localDB.get(newID);
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
            return mirror.bulkDocs(testDocs);
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
            return mirror.put(sampledoc);
          })
          .then(function (result) {
            return mirror.putAttachment('sampledoc', 'text', result.rev, attachment, 'text/plain');
          })
          .then(function (result) {
            rev = result.rev;
            expect(result.ok).to.equal(true);
            return mirror.getAttachment('sampledoc', 'text');
          })
          .then(function (result) {
            expect(result.size || result.length).to.equal(79);
            return mirror.removeAttachment('sampledoc', 'text', rev);
          })
          .then(function (response) {
            expect(response.ok).to.equal(true);
          });
      });
      
    });

    describe('Backoff', function() {

      it('should start off less than two seconds and never exceed 10 minutes', function() {
        var backoff = mirror._strategy._defaultBackoff;
        var limit = 600000;
        var delay = 0;
        var values = [];
        for(var i=0; i<100; i++) {
          delay = backoff(delay);
          values.push(delay);
        }
        var max = Math.max.apply(null, values);
        expect(values[0]).to.be.at.most(2000);
        expect(max).to.be.at.most(limit);
      });

    });

    describe('PouchMirror API', function() {

      it('should pass through functions from the localDB object', function() {
        expect(mirror.type()).to.equal('leveldb');
      });

      it('should work with callbacks', function() {
        return previous
          .then(function() {
            return new Promise(function(resolve) {
              mirror.put({_id: 'callback_test'}, function(err, result) {
                expect(result.id).to.equal('callback_test');
                mirror.get('callback_test', function(err, doc) {
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
            expect(mirror._strategy._remoteSynced).to.equal(true);
            expect(mirror._strategy._readDB).to.equal(localDB);
          });
      });

      it('should pause and restart replication without error', function() {
        expect(mirror._strategy._active).to.equal(true);
        mirror.pause();
        expect(mirror._strategy._active).to.equal(false);
        expect(mirror._strategy._remoteSynced).to.equal(false);
        expect(mirror._strategy._readDB).to.equal(remoteDB);
        mirror.start();
        expect(mirror._strategy._active).to.equal(true);
      });

    });

  });
  
  xdescribe('Local First', function () {

    var localDB, remoteDB, mirror, replicator, emitterPromise, previous;

    before(function() {
      // Used to make sure the previous test has completed before starting the next one
      previous = Promise.resolve();
      localDB = new PouchDB(dbname, dbOptions);
      remoteDB = new PouchDB(remoteURL);
      mirror = new PouchMirror(localDB, remoteDB, 'local-first');
      replicator = mirror.start({retry: true});

      // To test the up-to-date event
      emitterPromise = new Promise(function(resolve) {
        replicator.on('up-to-date', function() {
          resolve();
        });
      });
    });

    after(function() {
      return Promise.all([mirror._remoteDB.destroy(), mirror._localDB.destroy()]);
    });

    describe('info()', function () {

      it('should return info from local and remote', function () {
        return previous
          .then(function() {
            return mirror.info();
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
            console.log(1);
            return mirror.post({title: 'testdoc1'});
          })
          .then(function (response) {
            newID = response.id;
            newRev = response.rev;
            console.log(2);
            return localDB.get(newID);
          })
          .then(function (local) {
            newDoc = local;
            console.log(3);
            expect(local.title).to.equal('testdoc1');
            return mirror._remoteDB.get(newID);
          })
          .then(function (remote) {
            console.log(4);
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
            return mirror.remove(newID, newRev);
          })
          .then(function () {
            return mirror._localDB.get(newID);
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
            return mirror.bulkDocs(testDocs);
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
            return mirror.put(sampledoc);
          })
          .then(function (result) {
            return mirror.putAttachment('sampledoc', 'text', result.rev, attachment, 'text/plain');
          })
          .then(function (result) {
            rev = result.rev;
            expect(result.ok).to.equal(true);
            return mirror.getAttachment('sampledoc', 'text');
          })
          .then(function (result) {
            expect(result.size || result.length).to.equal(79);
            return mirror.removeAttachment('sampledoc', 'text', rev);
          })
          .then(function (response) {
            expect(response.ok).to.equal(true);
          });
      });
      
    });

    describe('Backoff', function() {

      it('should start off less than two seconds and never exceed 10 minutes', function() {
        var backoff = mirror._strategy._defaultBackoff;
        var limit = 600000;
        var delay = 0;
        var values = [];
        for(var i=0; i<100; i++) {
          delay = backoff(delay);
          values.push(delay);
        }
        var max = Math.max.apply(null, values);
        expect(values[0]).to.be.at.most(2000);
        expect(max).to.be.at.most(limit);
      });

    });

    describe('PouchMirror API', function() {

      it('should pass through functions from the localDB object', function() {
        expect(mirror.type()).to.equal('leveldb');
      });

      it('should work with callbacks', function() {
        return previous
          .then(function() {
            return new Promise(function(resolve) {
              mirror.put({_id: 'callback_test'}, function(err, result) {
                expect(result.id).to.equal('callback_test');
                mirror.get('callback_test', function(err, doc) {
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
            expect(mirror._strategy._remoteSynced).to.equal(true);
            expect(mirror._strategy._readDB).to.equal(localDB);
          });
      });

      it('should pause and restart replication without error', function() {
        expect(mirror._strategy._active).to.equal(true);
        mirror.pause();
        expect(mirror._strategy._active).to.equal(false);
        expect(mirror._strategy._remoteSynced).to.equal(false);
        expect(mirror._strategy._readDB).to.equal(remoteDB);
        mirror.start();
        expect(mirror._strategy._active).to.equal(true);
      });

    });

  });
});
