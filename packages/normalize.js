module.exports = normalizePackage;

var normalize = require('npm-registry/normalize').packages;

function normalizePackage(pkg) {
  var normalized = normalize(pkg);

  var cleaned = {
    objectID: normalized.name,
    name: normalized.name,
    description: normalized.description,
    keywords: normalized.keywords,

    // author: an object like
    // "author":{"name":"tmpvar","email":"tmpvar@gmail.com","gravatar_id":"..","gravatar":".."}
    // "latest" maintainer was the first one to publish the package
    author: normalized.maintainers[normalized.maintainers.length - 1],

    // github:
    // "github":{"user":"tmpvar","repo":"polygon.clip.js"}
    github: normalized.github,

    // array of authors
    maintainers: normalized.maintainers,

    version: normalized.latest.version,
    dependenciesCount: Object.keys(normalized.dependencies).length,
    releasesCount: Object.keys(normalized.releases).length,
    bin: normalized.bin,
    created: Date.parse(normalized.created),
    modified: Date.parse(normalized.modified)
  };

  return cleaned;
}
