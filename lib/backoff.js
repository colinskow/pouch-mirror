module.exports = function Backoff(maxTimeout) {
  if(maxTimeout == null) {
    maxTimeout = 600000; // 10 minutes
  }

  // Backoff function from PouchDB
  // Starts with a random number between 0 and 2 seconds and doubles it after every failed connect
  // Will not go higher than options.maxTimeout
  function randomNumber(min, max) {
    min = parseInt(min, 10) || 0;
    max = parseInt(max, 10);
    if (max !== max || max <= min) {
      max = (min || 1) << 1; //doubling
    } else {
      max = max + 1;
    }
    // In order to not exceed maxTimeout, pick a random value between 50% of maxTimeout and maxTimeout
    if(maxTimeout && max > maxTimeout) {
      min = maxTimeout >> 1; // divide by two
      max = maxTimeout;
    }
    var ratio = Math.random();
    var range = max - min;

    return ~~(range * ratio + min); // ~~ coerces to an int, but fast.
  }

  function defaultBackOff(min) {
    var max = 0;
    if (!min) {
      max = 2000;
    }
    return randomNumber(min, max);
  }

  return defaultBackOff;
};