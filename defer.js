var BPromise = require('bluebird');

module.exports = function() {
  var resolve, reject;
  var promise = new BPromise(function() {
    resolve = arguments[0];
    reject = arguments[1];
  });
  return {
    resolve: resolve,
    reject: reject,
    promise: promise
  };
};