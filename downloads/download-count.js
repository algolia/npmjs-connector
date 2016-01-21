// This module gives you the download count for a particular `package`.
// You get two time periods for downloads:
//   1. now - 1 month() => now()
//   2. now - 2 months() => now - 1 month()
module.exports = downloadCount;

function downloadCount(packages) {
  var moment = require('moment');
  var partial = require('lodash/function/partial');
  var times = require('lodash/utility/times');

  var oneYear = [];

  times(12, function addPeriod(monthIndex) {
    oneYear.push(
      moment().subtract(monthIndex + 1, 'months').format('YYYY-MM-DD') + ':' +
      moment().subtract(monthIndex, 'months').format('YYYY-MM-DD')
    );
  });

  return Promise
    .all(oneYear.map(partial(downloadCountPeriod, packages)))
    .then(groupByPackageName);
}

function downloadCountPeriod(packages, downloadPeriod) {
  var https = require('https');

  return new Promise(function get(resolve, reject) {
    var util = require('util');
    var escape = require('querystring').escape;

    var requestOptions = {
      hostname: 'api.npmjs.org',
      method: 'GET',
      path: util.format('/downloads/point/%s/%s', downloadPeriod, packages.map(function(pkg) {return escape(pkg)}).join(',')),
      keepAlive: true
    };

    var req = https.request(requestOptions, onResponse);
    req.once('error', reject);
    req.end();

    function onResponse(res) {
      if (res.statusCode !== 200) {
        reject(new Error('download-count: could not get download count for ' + packages));
        return;
      }

      var chunks = [];

      res.on('data', onData);
      res.once('end', onEnd);
      res.once('error', reject);

      function onData(chunk) {
        chunks.push(chunk);
      }

      function onEnd() {
        var ret;
        var tmp = JSON.parse(Buffer.concat(chunks));

        if (packages.length === 1) {
          ret = {};
          ret[tmp.package] = tmp;
        } else {
          ret = tmp;
        }

        resolve(ret);
      }
    }
  });
}

var groups = [
  100000000,
  80000000,
  50000000,
  25000000,
  15000000,
  10000000,
  8000000,
  5000000,
  2500000,
  1000000,
  800000,
  500000,
  250000,
  100000,
  80000,
  50000,
  25000,
  10000,
  8000,
  5000,
  2500,
  1000,
  500,
  250,
  100,
  10,
  1,
  0
];

function groupByPackageName(results) {
  var find = require('lodash/collection/find');
  var forEach = require('lodash/collection/forEach');
  var map = require('lodash/collection/map');
  var math = require('mathjs');

  var packages = {};

  results = results.filter(function(res) {
    return res.error !== 'no stats for this package for this period (0002)';
  });

  forEach(results, function(packagesByPeriod) {
    forEach(packagesByPeriod, function(package) {
      packages[package.package] = packages.hasOwnProperty(package.package) && packages[package.package] || {downloads: {raw: []}};
      packages[package.package].downloads.raw.push(package.downloads || 0);
    });
  });

  forEach(packages, function(pkg) {
    pkg.downloads.medianChange = math.median(map(pkg.downloads.raw, function(current, index, downloads) {
      if (downloads[index + 1] === undefined) {
        return 0;
      }

      return Math.round((current - downloads[index + 1]) / downloads[index + 1] * 100);
    }));

    pkg.downloads.group = find(groups, function(group, index) {
      var downloads = pkg.downloads.raw[0];
      var currentDifference = group - downloads;
      var nextDifference = downloads - (groups[index + 1] || 0);
      return currentDifference < nextDifference;
    });
  });

  return packages;
}
