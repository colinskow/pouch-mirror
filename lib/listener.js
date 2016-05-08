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