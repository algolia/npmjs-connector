# npm-registry Algolia connector

Replicate the full npmjs registry and watch for updates. Supports
being killed at any moment during either full replication or watching.

# Usage

## Local

```sh
npm install
APPLICATION_ID='ALGOLIA_APPLICATION_ID' \
API_KEY='ALGOLIA_ADMIN_API_KEY' \
INDEX_PREFIX='npmjs-'
CONFIG='{
  "NPM_REGISTRY": "https://skimdb.npmjs.com/registry",
  "PACKAGES_INDEXNAME": "registry",
  "REPLICATION_CONCURRENCY": 10000,
  "DOWNLOADS_CONCURRENCY": 100,
  "WATCH_CONCURRENCY": 1,
  "EXIT_AFTER": "5min"
}' \
./run
```

## Docker

Build it:
```sh
docker build -t npmjs-connector .
```

Run it:
```sh
docker run \
-e APPLICATION_ID='ALGOLIA_APPLICATION_ID' \
-e API_KEY='ALGOLIA_ADMIN_API_KEY' \
-e INDEX_PREFIX='npmjs-' \
-e CONFIG='{
  "NPM_REGISTRY": "https://skimdb.npmjs.com/registry",
  "PACKAGES_INDEXNAME": "registry",
  "REPLICATION_CONCURRENCY": 10000,
  "DOWNLOADS_CONCURRENCY": 100,
  "WATCH_CONCURRENCY": 1,
  "EXIT_AFTER": "5min"
}' \
npmjs-connector
```

# Workflow

The goal is to be resilient to failures or interruptions of service without
having to re-replicate everything.

1. get current lastSequence known, either the current from repo or the one from index
1. get current replicateLastPackage known
  if not found, browse repository to find the first package (by page)
  if found but special "DONE" token, pass replication
2. start replication at this package
3. every loop of replication = save replicateLastPackage
4. once replication is done, save lastSequence known, store special DONE flag in replicateLastPackage 
5. start download job, start at downloadsLastPackage or first package of index
6. at each download run, save downloadsLastPackage
7. use lastSequence known, start watching
8. every watch loop, save lastSequence known

Download count and repo watching can be done in parallel once full replication is done.
