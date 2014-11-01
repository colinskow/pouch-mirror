var BPromise = require('bluebird');
var defer = require('./defer');

var timeLimit = 4900;

module.exports = function (db) {
  var pending = {};
  var bufferedChanges = {};

  // Keep a buffer of recent changes in case the change comes in before our response
  var bufferChange = function(rev) {
    // console.log('Buffering change ' + rev);
    bufferedChanges[rev] = new Date();
    // get rid of any expired changes
    for(var key in bufferedChanges) {
      if((bufferedChanges[key] + timeLimit) < new Date()) {
        delete bufferedChanges[key];
      }
    }
  };

  // Init Listener
  db.changes({ since: 'now', live: true})
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

  var waitForChange = function(rev) {
    var deferred = defer();
    deferred.promise
      .timeout(timeLimit)
      .catch(BPromise.TimeoutError, function(err) {
        delete(pending[rev]);
        console.log(err);
        return BPromise.reject(err);
      });
    if(bufferedChanges[rev]) {
      deferred.resolve({rev: rev});
      delete bufferedChanges[rev];
    } else {
      pending[rev] = deferred;
    }
    return deferred.promise;
  };
  
  return {
    waitForChange: waitForChange
  };

};