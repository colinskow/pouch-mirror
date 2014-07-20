var PouchMirror = require('../index');
var Promise = require('bluebird');
var expect = require('chai').expect;

var remoteURL = 'http://localhost:5984/pouchtest';
var dbname = 'pouchtest';

var db = new PouchMirror(dbname, remoteURL);

// Used to make sure the previous test has completed before starting the next one
var previous;

describe('PouchMirror', function () {

  describe('info()', function () {

    it('should return info from local and remote', function (done) {
      console.log('Testing info');
      previous = db.info()
        .then(function (results) {
          expect(results.remote.db_name).to.equal(dbname);
          expect(results.local.db_name).to.equal(dbname);
          console.log('Finished info');
          done();
        }, function (err) {
          throw new Error(err);
        });
    });

  });

  describe('post() and remove()', function () {
    var newID;
    var newRev;
    var newDoc;

    it('should add a new document to both local and remote', function (done) {
      previous
        .finally(function() {
          console.log('Testing post');
          previous = db.post({title: 'testdoc1'})
            .then(function (response) {
              newID = response.id;
              newRev = response.rev;
              return db.localDB.get(newID);
            })
            .then(function (local) {
              newDoc = local;
              expect(local.title).to.equal('testdoc1');
              return db.remoteDB.get(newID);
            })
            .then(function (remote) {
              expect(newDoc._rev).to.equal(remote._rev);
              expect(remote.title).to.equal('testdoc1');
              console.log('Finished post');
              done();
            })
            .catch(function (err) {
              throw new Error(err);
            });
        });
    });

    it('should remove the document we just added', function (done) {
      previous
        .finally(function() {
          console.log('Testing remove');
          previous = db.remove(newID, newRev)
            .then(function () {
              return db.localDB.get(newID);
            })
            .catch(function (err) {
              expect(err.reason || err.message).to.equal('deleted');
              console.log('Finished remove');
              done();
            });
        });
    });

  });

  describe('bulkDocs', function () {
    var testDocs = [
      {_id: 'testDoc2', title: 'hello2'},
      {title: 'hello3'}
    ];
    it('should write two documents across remote and local', function (done) {
      previous
        .finally(function() {
          console.log('Testing bulkDocs');
          previous = db.bulkDocs(testDocs)
            .then(function (results) {
              expect(results[0].id).to.equal('testDoc2');
              // expect(results[1].ok).to.equal(true);
              console.log('Finished bulkDocs');
              done();
            });
        });
    });

  });

  describe('attachments', function () {
    
    var sampledoc = {
      _id: 'sampledoc'
    };
    var attachment = new Buffer("It's a God awful small affair");
    
    it('should save, get, and remove an attachment', function (done) {
      var rev;
      previous
        .finally(function() {
          console.log('Testing attachments');
          previous = db.put(sampledoc)
            .then(function (result) {
              return db.putAttachment('sampledoc', 'text', result.rev, attachment, 'text/plain');
            })
            .then(function (result) {
              rev = result.rev;
              expect(result.ok).to.equal(true);
              return db.getAttachment('sampledoc', 'text');
            })
            .then(function (buffer) {
              expect(buffer.toString()).to.equal("It's a God awful small affair");
              return db.removeAttachment('sampledoc', 'text', rev);
            })
            .then(function (response) {
              expect(response.ok).to.equal(true);
              console.log('Finished attachments');
              done();
            });
        });
    });
    
  });

  describe('callbacks', function() {

    it('should work with callbacks also', function(done) {
      previous
        .finally(function() {
          return new Promise(function(resolve) {
            console.log('Testing callbacks');
            db.put({_id: 'callback_test'}, function(err, result) {
              expect(result.id).to.equal('callback_test');
              db.get('callback_test', function(err, doc) {
                expect(doc._id).to.equal('callback_test');
                console.log('Finished callbacks');
                resolve(true);
                done();
              });
            });
          });
        });
    });

  });

  describe('cleanup', function () {

    it('should destroy the pouchtest database', function (done) {
      previous
        .finally(function() {
          console.log('Cleanup');
          db.cancelSync();
          db.remoteDB.destroy()
            .then(function () {
              return db.localDB.destroy();
            })
            .then(function () {
              done();
            });
        });
    });

  });

});