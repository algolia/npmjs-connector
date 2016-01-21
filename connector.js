var algoliasearch = require('algoliasearch');
var request = require('request');
var winston = require('winston');
var bindAll = require('lodash/function/bindAll');
var log = winston.log.bind(winston, 'info');

var config = JSON.parse(process.env.CONFIG);
var NPM_REGISTRY = config.NPM_REGISTRY;
var APPLICATION_ID = process.env.APPLICATION_ID;
var API_KEY = process.env.API_KEY;
var INDEX_PREFIX = process.env.INDEX_PREFIX || 'npmjs-';
var PACKAGES_INDEXNAME = INDEX_PREFIX + config.PACKAGES_INDEXNAME;
var REPLICATION_CONCURRENCY = config.REPLICATION_CONCURRENCY;
var WATCH_CONCURRENCY = config.WATCH_CONCURRENCY;
var DOWNLOADS_CONCURRENCY = config.DOWNLOADS_CONCURRENCY;
var EXIT_AFTER = config.EXIT_AFTER;
var FORCE_RESET = process.env.FORCE_RESET;

if (DOWNLOADS_CONCURRENCY > 100) {
  DOWNLOADS_CONCURRENCY = 100;
  log('forcing DOWNLOADS_CONCURRENCY to 200 otherwise it might fail on api.npmjs.org side');
}

if (EXIT_AFTER !== undefined) {
  EXIT_AFTER = require('parse-duration')(EXIT_AFTER);
  setTimeout(function() {
    log('forced exiting because of EXIT_AFTER env variable set to: %s (%dms)', config.EXIT_AFTER, EXIT_AFTER);
    process.exit(0);
  }, EXIT_AFTER);
}

var client = algoliasearch(APPLICATION_ID, API_KEY);
var index = client.initIndex(PACKAGES_INDEXNAME);

bindAll(index);

var algoliaState = {
  sequence: null,
  replication: null,
  downloads: null,
  replicationDone: '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!DONE'
};

var npmjsState = {
  sequence: null,
  firstPackage: null
};

init()
  .then(getStates)
  .then(work)
  .catch(err);

function getStates() {
  return Promise.all([
    getAlgoliaState(),
    getLastSequenceFromNPMRegistry(),
    getFirstPackageNameFromNPMRegistry(),
  ]);
}

function work(states) {
  algoliaState = states[0];

  npmjsState.sequence = states[1];
  npmjsState.firstPackage = states[2];

  log('algolia last known registry sequence: %d', algoliaState.sequence);
  log('registry sequence: %d', npmjsState.sequence);
  log('last replicated package: %s', algoliaState.replication);
  log('first package name in registry: %s', npmjsState.firstPackage);
  log('last replicated package for downloads: %s', algoliaState.downloads);

  var actions = [];

  if (algoliaState.replication === null && algoliaState.sequence === null) {
    log('starting full replication');
    algoliaState.sequence = npmjsState.sequence;
    actions.push(saveAlgoliaState(algoliaState));
    actions.push(waitForIndexing());
    actions.push(replicate());
  } else if (algoliaState.replication !== algoliaState.replicationDone) {
    log('continuing replication');
    actions.push(replicate());
  } else {
    log('full replication was done, will now watch for changes')
  }

  return Promise
    .all(actions)
    .then(function() {
      return Promise.race([
        watch(),
        downloads()
      ])
    })
}

function err(err) {
  setTimeout(function() {
    throw err;
  })
}

function watch() {
  return new Promise(function(resolve, reject) {
    log('watch: starting watching for registry changes at sequence:%d', algoliaState.sequence);

    // we never resolve, watch is a continuous process
    // if we fail at some point it will restart where it was
    var watchPackages = require('./packages/watch.js');
    var watch = watchPackages({
      lastSequence: algoliaState.sequence,
      registryEndpoint: NPM_REGISTRY,
      concurrency: WATCH_CONCURRENCY
    });

    watch.on('changes', function(changes, lastSequence, cb) {
      log('got %d updates and %d deletes', changes.updates.length, changes.deletes.length);

      var chain;
      if (changes.updates.length > 0) {
        chain = index.partialUpdateObjects(changes.updates)
      } else {
        chain = Promise.resolve();
      }

      if (changes.deletes.length > 0) {
        chain = chain.then(function() {
          return index.deleteObjects(changes.deletes.map(function(pkg) {return pkg.name}))
        })
      }

      chain
        .then(function() {
          algoliaState.sequence = lastSequence;
          return saveAlgoliaState(algoliaState)
        })
        .then(cb)
        .catch(reject);
    });

    watch.once('error', function(err) {
      reject(err);
    });
  });
}

function downloads() {
  return new Promise(function downloadsPromise(resolve, reject) {
    var firstPackage = algoliaState.downloads || npmjsState.firstPackage;
    log('downloads: starting computing downloads count for packages, starting at package %s', firstPackage);

    var downloads = require('./downloads/index.js');
    var downloadCount = downloads({
      firstPackage: firstPackage,
      registryEndpoint: NPM_REGISTRY,
      // too high concurrency will fail because of https://api.npmjs.org/downloads limits
      concurrency: DOWNLOADS_CONCURRENCY
    });

    downloadCount.on('packages', function(packages, cb) {
      var forEach = require('lodash/collection/forEach');

      log('downloads: updating %d packages that we found download info for, first one is %s', packages.length, packages[0].objectID);

      index
        .partialUpdateObjects(packages)
        .then(function() {
          algoliaState.downloads = packages[packages.length - 1].objectID;
          return saveAlgoliaState(algoliaState)
        })
        .then(cb)
        .catch(reject);
    });

    downloadCount.once('error', function(err) {
      log('downloads: error while reading from the registry', err);
      reject(err);
    });

    downloadCount.once('end', function(packagesDone) {
      log('downloads: finished computing downloads for packages');
      algoliaState.downloads = npmjsState.firstPackage;
      saveAlgoliaState(algoliaState);
    });
  });
}

function replicate() {
  return new Promise(function(resolve, reject) {
    var firstPackage = algoliaState.replication || npmjsState.firstPackage;

    log('replicate: starting replication at package named `%s`', firstPackage);

    var replicatePackages = require('./packages/replicate.js');
    var replicate = replicatePackages({
      registryEndpoint: NPM_REGISTRY,
      firstPackage: firstPackage,
      concurrency: REPLICATION_CONCURRENCY
    });

    replicate.on('packages', function(packages, cb) {
      log('replicate: replicating %d packages, first one is %s', packages.length, packages[0].name);

      index
        .saveObjects(packages)
        .then(function() {
          algoliaState.replication = packages[packages.length - 1].name;
          return saveAlgoliaState(algoliaState)
        })
        .then(cb)
        .catch(reject)
    });

    replicate.once('error', function(err) {
      log('replicate: error while reading from the registry', err);
      reject(err);
    });

    replicate.once('end', function(packagesDone) {
      log('replicate: finished replicating packages');
      algoliaState.replication = algoliaState.replicationDone;
      saveAlgoliaState(algoliaState).then(waitForIndexing()).then(resolve);
    });
  });
}

function getLastSequenceFromNPMRegistry() {
  return new Promise(function(resolve, reject) {
    request({url: NPM_REGISTRY, json: true}, function(err, res, body) {
      if (err) {
        reject(err);
        return;
      }

      resolve(body.committed_update_seq);
    });
  });
}

function getFirstPackageNameFromNPMRegistry() {
  return new Promise(function(resolve, reject) {
    request({url: NPM_REGISTRY + '/_all_docs', qs: {limit: 1}, json: true}, function(err, res, body) {
      if (err) {
        reject(err);
        return;
      }

      resolve(body.rows[0].id);
    })
  });
}

function getAlgoliaState() {
  log('getting algolia state');

  return index
    .getSettings()
    .then(getProperty('userData'));
}

function saveAlgoliaState(state) {
  log('saving algolia state:', state);

  return index
    .setSettings({
      userData: state
    });
}

function waitForIndexing() {
  return function(res) {
    log('waiting for indexing task #%d to be finished', res.taskID);
    return index.waitTask(res.taskID);
  }
}

function getProperty(path) {
  return function(object) {
    var get = require('lodash/object/get');
    return get(object, path);
  }
}

function waitPromise() {
  return new Promise(function(resolve) {
    setTimeout(resolve, 5*1000);
  });
}

function init() {
  return client
    .listIndexes()
    .then(function(res) {
      var currentIndex = res.items.find(function(indice) {return indice.name === PACKAGES_INDEXNAME});

      if (!currentIndex) {
        log('creating the index');
        return saveAlgoliaState(algoliaState).then(waitForIndexing());
      } else {
        if (FORCE_RESET) {
          log('reseting the index');
          return saveAlgoliaState(algoliaState).then(waitForIndexing());
        }

        return getAlgoliaState()
          .then(function(state) {
            if (state === undefined) {
              log('creating the settings state');
              return saveAlgoliaState(algoliaState).then(waitForIndexing());
            } else if(currentIndex.pendingTask === true) {
              log('index is currently building, wait five seconds...')
              return waitPromise().then(init);
            }
          })
      }
    })
}
