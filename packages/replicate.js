module.exports = replicate;

var EventEmitter = require('events').EventEmitter;
var PouchDB = require('pouchdb');

var normalize = require('./normalize');

function replicate(opts) {
  // events: `packages`, `error`, `end`
  var emitter = new EventEmitter();
  var db = new PouchDB(opts.registryEndpoint);

  loop({
    db: db,
    limit: opts.concurrency,
    emitter: emitter,
    startkey: opts.firstPackage,
    // first time we skip nothing
    // see http://pouchdb.com/2014/04/14/pagination-strategies-with-pouchdb.html
    skip: -1
  })
  .then(end(emitter))
  .catch(errorOccured(emitter));

  return emitter;
}

function loop(opts) {
  return opts.db
    .allDocs({
      limit: opts.limit,
      startkey: opts.startkey,
      skip: opts.skip + 1,
      include_docs: true
    })
    .then(handleAllDocsResponse);

    function handleAllDocsResponse(res) {
      if (!opts.firstOffset) {
        opts.firstOffset = res.offset;
      }

      if (res.total_rows === res.offset) {
        // That's all folks! We're done.
        return Promise.resolve(res.offset - opts.firstOffset);
      }

      return emitPackages(
          res
            .rows
            .map(getDocFromRow)
            .map(normalize)
        )
        .then(nextLoop);
    }

    function nextLoop(packages) {
      return loop({
        db: opts.db,
        limit: opts.limit,
        emitter: opts.emitter,
        firstOffset: opts.firstOffset,
        startkey: packages[packages.length - 1].name,
        // skip `lastPackage` from results on next loop
        skip: 0
      });
    }

    function emitPackages(packages) {
      return new Promise(function(resolve, reject) {
        opts.emitter.emit('packages', packages, function() {
          resolve(packages);
        });
      });
    }
}

function end(emitter) {
  return function emitEnd(packagesDone) {
    emitter.emit('end', packagesDone);
  };
}

function errorOccured(emitter) {
  return function emitError(err) {
    setTimeout(function() {
      emitter.emit('error', err);
    }, 0);
  };
}

function getDocFromRow(row) {
  return row.doc;
}
