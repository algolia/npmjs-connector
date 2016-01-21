module.exports = downloads;

var EventEmitter = require('events').EventEmitter;
var PouchDB = require('pouchdb');

var downloadCount = require('./download-count');

function downloads(opts) {
  var db = new PouchDB(opts.registryEndpoint);

  // events: `packages`, `error`, `end`
  var emitter = new EventEmitter();

  loop({
    db: db,
    startkey: opts.firstPackage,
    limit: opts.concurrency,
    // first time we skip nothing
    // see http://pouchdb.com/2014/04/14/pagination-strategies-with-pouchdb.html
    skip: -1,
    emitter: emitter
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
      skip: opts.skip + 1
    })
    .then(handleAllDocsResponse);

    function handleAllDocsResponse(res) {
      if (!opts.firstOffset) {
        opts.firstOffset = res.offset;
      }

      if (res.total_rows === res.offset) {
        // That's all folks! We're done, send the number of done packages to
        // end promise
        return Promise.resolve(res.offset - opts.firstOffset);
      }

      var potentialPackages = res.rows.filter(noUpperCase).map(onlyNames);

      if (potentialPackages.length === 0) {
        return nextLoop([{objectID: res.rows[res.rows.length - 1].id}]);
      }

      return downloadCount(potentialPackages)
        .then(packagesToArray)
        .then(emitPackages)
        .then(nextLoop);
    }

    function nextLoop(packages) {
      return loop({
        db: opts.db,
        limit: opts.limit,
        emitter: opts.emitter,
        startkey: packages[packages.length - 1].objectID,
        firstOffset: opts.firstOffset,
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

function onlyNames(package) {
  return package.id;
}

function packagesToArray(packages) {
  var arrayPackages = [];
  var forEach = require('lodash/collection/forEach');

  forEach(packages, function(pkgData, pkgName) {
    arrayPackages.push({
      objectID: pkgName,
      downloads: pkgData.downloads
    });
  });

  return arrayPackages;
}

// the npmjs downloads API is not able to distinguish
// lowercase form uppercase
// example: https://api.npmjs.org/downloads/point/2015-01-01:2015-02-01/AssetPipeline
// Package name is AssetPipeline but downloads API says assetpipeline
// to avoid confusion we just skip uppercase packages, they are also no more allowed
// while publishing
function noUpperCase(pkg) {
  return pkg.id.toLowerCase() === pkg.id;
}
