PouchMirror
===

**Version 0.2.0 has a NEW API, see usage below.**

PouchMirror helps you create a local mirror of any CouchDB database for lightning-fast reads and secure writes. It now works in both NodeJS and the browser!

Accessing a remote CouchDB instance can be slow. PouchDB is an incredible tool that allows you to create local 
instances of your databases in any Javascript environment and keep them in sync with your server. The problem is that 
writing to a replica of your main database comes with no guarantees and can lead to unexpected results. For example, 
if multiple nodes are writing to the same documents at the same time, automatic conflict resolution can cause changes 
you thought you saved to pop out of existence.

When PouchMirror first starts up it will initiate replication to create a local in-memory mirror of your remote 
database. Before this initial replication is finished, all read requests are automatically routed to the server to 
ensure accurate reads. Once the initial replication is complete, you will enjoy lightning-fast reads from your local 
database on all requests.

When you write, PouchMirror makes sure that the data is saved on your CouchDB server with no conflict AND fully 
replicated to your local instance before resolving the promise. If a conflict arises, your promise will be rejected and 
no data saved.

While PouchMirror does feature browser support, it uses your remote db as the primary source of truth and therefore is not appropriate for front-end apps that need to work offline. If you are building an offline app, [`NG-Pouch-Mirror`](https://github.com/colinskow/ng-pouch-mirror) is a much better option.

For issues and feature requests visit the [issue tracker](https://github.com/colinskow/pouch-mirror/issues).

Build status
---
[![Build Status](https://travis-ci.org/colinskow/pouch-mirror.png?branch=master)](https://travis-ci.org/colinskow/pouch-mirror)

Usage
---
PouchMirror is an exact mirror of the PouchDB API, and can serve as a drop-in replacement for your existing PouchDB 
code. Both promises and callbacks are supported.

In Node.js, simply require "pouch-mirror" and initiate it:
`new PouchMirror(localDB, remote)`

`localDB` MUST be an instance of `PouchDB`. `remote` may be a URL string OR an instance of `PouchDB`.

In the browser, simply include a script tag below PouchDB:
`<script src="dist/pouch-mirror.js"></script>` and use the same syntax.

Example:
```Javascript
var PouchDB = require('pouchdb');
var memdown = require('memdown');
var PouchMirror = require('pouch-mirror');

var localDB = new PouchDB('testDB', {db: memdown});
var mirror = new PouchMirror(localDB, 'http://localhost:5984/pouchtest');

var replicator = mirror.start({retry: true});
// PouchDB replication events will pass through here.
// When the initial replication is complete you will get a
// special one-time 'up-to-date' event.
replicator.on('up-to-date', function(info) {
  console.log('Congratulations, initial replication of ' +
    info.db + 'complete!');
});

mirror.post({title: "Ziggy Stardust"})
  .then(function(result) {
    return mirror.get(result.id);
  })
  .then(function(doc){
    console.log(doc);
    // You can pause replication any time you want like this:
    mirror.pause();
    // And restart it again with mirror.start()
  })
  .catch(function(err) {
    console.log(err);
  });
```

API
---
PouchMirror uses that exact same API as [PouchDB](http://pouchdb.com/api.html), but does some magic in the background 
to ensure your local mirror stays in perfect sync. In addition, you have the following commands available:

* `pouchMirror.start([options])` - starts replication and returns the PouchDB replicator object.
* `pouchMirror.pause()` - pauses replication. `replicator.cancel()` also does the same thing.

All `start` options will be passed directly to `PouchDB.replicate`:
* `options.retry` - set this to `true` if you want PouchMirror to automatically attempt to reconnect in the case of replication problems. This uses PouchDB's default backoff function with a maximum timeout added.
* `options.maxTimeout` - the retry timeout for the default backoff will never exceed this value (default 600000, 10 min). Set to 0 to allow infinite backoff.
* `options.back_off_function` - supply your own backoff function. `maxTimeout` has no effect with this option.

All write requests will ALWAYS go to the remote db first, and the promise will only resolve after changes are confirmed to have replicated to local. When replication is paused, all read requests will also go to remote. After the initial replication has finished all read requests will come from the local db as long as replication stays active.

Road Map
---

**Local first mode**

Continuous replication can be request heavy, and in order to save hosting money I have a [request](https://github.com/colinskow/pouch-mirror/issues/5) to create a mode which puts the local database first and debounces changes before sending them to the remote server.

**More extensive testing**

I have run the tests against a local CouchDB instance, and have been using it in small-scale production on Cloudant. However, this definitely needs more experience on large setups to make sure it stands up to scaling demands.
