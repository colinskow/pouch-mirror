'use strict'
var RemoteFirst = require('./remotefirst'),
LocalFirst = require('./localfirst'),
// There are two strategies available in Pouch-Mirror -
// 1. remote-first.
// This is the default strategy and is backward-compatible with the previous
// versions of Pouch-Mirror (upto 0.2.0). In this mode, Pouch-Mirror keeps
// the remote DB as the source of truth for all writes (always) and for all
// reads (till the local DB is populated). It's guaranteed that there will be
// no write conflicts in this mode.
// 
// 2. local-first.
// This is a new strategy introduced in 0.3.0, to cater to local interactions
// heavy scenarios. Although the remote-first strategy guarantees 
// no-write-conflicts, it cannot be used when there are lots of local 
// interactions, or when the remote DB is unavailable. In these conditions,
// you can use this strategy to ensure the data needs are fulfilled by the
// local DB with the changes eventually sync'd with the remote DB.
// In this strategy, there is an initial two-way sync with the remote.
// During this initial sync, the remote is the source of truth. Afterwards,
// the local DB becomes the source-of-truth for all read/writes. When a write
// is detected locally, a one-time two-way remote sync is debounced with a
// configurable delay timer. This allows quick local turnaround without waiting
// for remote sync to complete when there are frequent back-to-back writes.

// Here's a quick comparison chart -

// |   Strategy   |    Stage     | SOT Read | SOT Write | Works Offline | Conflicts Occurrence? |
// |--------------|--------------|----------|-----------|---------------|-----------------------|
// | remote-first | initial sync | remote   | remote    | No            | No-conflicts          |
// | remote-first | delta sync   | local    | remote    | No            | No-conflicts          |
// | local-first  | initial sync | remote   | remote    | Yes           | No-conflicts          |
// | local-first  | delta sync   | local    | local     | Yes           | Possible              |
// |--------------|--------------|----------|-----------|---------------|-----------------------|

getStrategy = function(pouchMirror, strategy){
    if (!strategy || strategy == 'remote-first'){
        return new RemoteFirst(pouchMirror);
    }
    
    if (strategy == 'local-first'){
        return new LocalFirst(pouchMirror);
    }
}

module.exports = getStrategy;