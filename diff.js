// debug utility to find differences between the algolia index and the registry

var PouchDB = require('pouchdb');
var db = new PouchDB('https://skimdb.npmjs.com/registry');
var difference = require('lodash/array/difference');

Promise.all([
  db.allDocs().then(function(res) {
    return res.rows.map(function(pkg) {return pkg.id});
  }),
  new Promise(function(resolve, reject) {
    var algoliasearch = require('algoliasearch');
    var client = algoliasearch('H4PJQW91NZ', '0fd7a79cd6abdf308ded148553390351');
    var index = client.initIndex('npmjs-registry');
    var browser = index.browseAll();
    var pkgs = [];

    browser.on('result', function(res) {
      pkgs = pkgs.concat(res.hits.map(function(pkg) {
        return pkg.objectID;
      }));
    });

    browser.on('end', function() {
      resolve(pkgs);
    });
  })
]).then(function(res) {
  var registryPkgs = res[0];
  var algoliaPkgs = res[1];
  console.log(difference(algoliaPkgs, registryPkgs));
});
