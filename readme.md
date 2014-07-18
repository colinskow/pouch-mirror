PouchMirror
===
PouchMirror helps you create a local slave mirror of any CouchDB database for lightning-fast reads and secure writes.

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

For issues and feature requests visit the [issue tracker](https://github.com/colinskow/pouch-mirror/issues).

Usage
---
PouchMirror is an exact mirror of the PouchDB API, and can serve as a drop-in replacement for your existing PouchDB 
code. The only caveat is that currently only Promises are supported, and callback functions won't work.

In Node.js, simply require "pouch-mirror" and initiate it:
`new PouchMirror(dbName, remoteURL)`

Example:
```Javascript
var PouchMirror = require('pouch-mirror');
var db = new PouchMirror('testDB', 'http://localhost:5897/testdb');
db.post({title: "Ziggy Stardust"})
  .then(function(result) {
    return db.get(result.id);
  })
  .then(function(doc){
    console.log(doc);
  })
  .catch(function(err) {
    console.log(err);
  });
```

Road Map
---

**1) Callback functions**

I personally use Promises exclusively and don't use callbacks. If someone wants this functionality, I would be happy to 
merge a pull request.

**2) Disk database**

Currently PouchMirror uses PouchDB's in-memory MemDown adapter. This works well for frequently-accessed data that will 
fit in your server's memory. I would like to add the option to backup your data to disk, or use an on-disk database 
exclusively.

**3) Browser support**

PouchMirror currently doesn't work in the browser. However, I believe this is simply a matter of using Browserify and 
making sure PouchDB loads the correct adapters. If someone wants to do this, I would be very happy to receive a pull 
request.

**4) More extensive testing**

I have run the tests against a local CouchDB instance, and against Cloudant. However, this definitely needs real world 
experience on a multi-tiered setup to make sure it is production safe.

