module.exports = watch;

var EventEmitter = require('events').EventEmitter;
var PouchDB = require('pouchdb');

var normalize = require('./normalize');

function watch(opts) {
  // events: `change`(+ last sequence), `delete`(+last sequence), `error`
  var emitter = new EventEmitter();
  var db = new PouchDB(opts.registryEndpoint);

  listenForChanges({
    db: db,
    since: opts.lastSequence,
    limit: opts.concurrency,
    emitter: emitter
  })
  .catch(errorOccured(emitter));

  return emitter;
}

function listenForChanges(opts) {
  return opts.db
    .changes({
      since: opts.since,
      limit: opts.limit,
      include_docs: true
    })
    .then(handleChangeResponse)
    .then(nextLoop);

    function handleChangeResponse(res) {
      if (res.results.length === 0) {
        return new Promise(function(resolve) {
          setTimeout(function() {
            resolve(res.last_seq);
          }, 5000);
        });
      }

      var updates = res.results.filter(function(pkg) {return pkg.deleted !== true}).map(function(pkg) {return normalize(pkg.doc)});
      var deletes = res.results.filter(function(pkg) {return pkg.deleted === true}).map(function(pkg) {return normalize(pkg.doc)});

      return new Promise(function(resolve, reject) {
        opts.emitter.emit('changes', {
          updates: updates,
          deletes: deletes
        }, res.last_seq, cb);

        function cb() {
          resolve(res.last_seq);
        }
      });
    }

    function nextLoop(lastSequence) {
      return listenForChanges({
        since: lastSequence,
        db: opts.db,
        limit: opts.limit,
        emitter: opts.emitter
      });
    }
}

function errorOccured(emitter) {
  return function emitError(err) {
    setTimeout(function() {
      emitter.emit('error', err);
    }, 0);
  };
}
