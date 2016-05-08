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