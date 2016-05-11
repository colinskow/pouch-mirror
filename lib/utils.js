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

// Creates an object that separates the callback from the rest of the arguments
exports.processArgs = function  (args) {
  args = Array.prototype.slice.call(args);
  if (args.length && typeof args[args.length - 1] === 'function') {
    var callback = args.pop();
    return { args: args, cb: callback };
  } else {
    return { args: args, cb: null };
  }
}

exports.callbackify = function (promise, cb) {
  promise.then(function(result) {
    cb(null, result);
    return Promise.resolve(result);
  }, function(err) {
    cb(err, null);
    return Promise.reject(err);
  });
}