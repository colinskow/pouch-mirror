var PouchMirror = require('../index');
var BPromise = require('bluebird');
var expect = require('chai').expect;

var remoteURL = 'http://localhost:5984/pouchtest';
var dbname = 'pouchtest';

var db = new PouchMirror(dbname, remoteURL);

// Used to make sure the previous test has completed before starting the next one
var previous = BPromise.resolve();

describe('PouchMirror', function () {

  after(function() {
    return previous
      .finally(function() {
        db.cancelSync();
        return BPromise.all([db.remoteDB.destroy(), db.localDB.destroy()]);
      });
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
        });
    });

    it('should remove the document we just added', function () {
      return previous
        .then(function() {
          return db.remove(newID, newRev);
        })
        .then(function () {
          return db.localDB.get(newID);
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
    var attachment = new Buffer("It's a God awful small affair");
    
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
        .then(function (buffer) {
          expect(buffer.toString()).to.equal("It's a God awful small affair");
          return db.removeAttachment('sampledoc', 'text', rev);
        })
        .then(function (response) {
          expect(response.ok).to.equal(true);
        });
    });
    
  });

  describe('callbacks', function() {

    it('should work with callbacks also', function() {
      return previous
        .then(function() {
          return new BPromise(function(resolve) {
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

  });

});