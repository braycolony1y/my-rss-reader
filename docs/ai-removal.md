# Removal of the AI Smart/Top data

Stories ranking is now deterministic (`src/ranking`). The data that only the old AI Top/Smart
pipeline used was archived on 2026-11-22 and is deleted after one stable week.

## What was archived

Archive: `database_state/archive/ai-removed-<timestamp>/` (gitignored, never commit it).
`manifest.json` lists, for every key: row count, uncompressed bytes, gzip bytes and sha256
(of the gzip file and of the JSON). Each `<key>.json.gz` holds
`{key, encoding, shape, itemCount, digest, value, orphanChildren?}`.

| Key | Content |
| --- | --- |
| `topStoriesState`, `topStoriesPublished` (+ `$topStoriesPublished.articles`) | Top stories state and last publication |
| `storyBriefings` | AI briefings |
| `smartEditorialAssessmentCache`, `smartEventVerificationCache`, `smartVerificationFailures` | AI scoring and LLM cluster verification caches |
| `smartAiProviderHealth` | provider health records |
| `smartPersonalFilters` | old AI "not interested" rules |
| `smartProgressivePublication` (+ `$smartProgressivePublication.clusters`), `smartProgressiveClusterState` | retired progressive publication; nothing reads or writes it now |
| `userPreferences.smartTabModes`, `userPreferences.clusteringModel` | two entries inside `userPreferences` |
| `legacy/` | pre-cutover keyed-overlay part files that hold only these keys (`database_state/smart-state.json/`, `database_state/database-state.json/`) |

Deliberately NOT archived or deleted, because the Stories path still uses them:
`smartAiConfig` (cluster reuse signature), `smartDeferredReviewGroups` (story relationships),
`smartTopPrefilterState` (deterministic regex prefilter decisions), `lastSourceEvalTime` and
`smartSourceScores` (source evaluation), `smart-embeddings-worker.json` and
`database_state/embeddings/` (clustering and ranker vectors), and `smart-data.json*` (mixed with the
Classic corpus). The manifest's `legacyFilesListed` shows their sizes.

The first archive (`ai-removed-2026-11-22T08-16-35-654Z`) was taken before the service restarted on the
new code, so the old service kept writing some of these caches afterwards. A second archive was taken
right after that restart and is the one to delete from:
`database_state/archive/ai-removed-2026-11-22T08-42-05-325Z/` (delete allowed after 2026-11-29T08:42:05Z).

`scripts/build-ranking-centroids.mjs` reads `topStoriesPublished`; it needs the archive restored
(see below) if the shipped centroids ever have to be rebuilt.

## Delete after a week

The delete is refused unless the archive manifest is 7 or more days old (the manifest's
`deleteAllowedAfter`), every archived file still matches its sha256, and the service is stopped.

```sh
cd /home/ubuntu/my-rss-reader
sudo systemctl stop rss-reader
nice -n 19 node scripts/delete-ai-data.mjs --dry-run     # review the plan and the gate results
nice -n 19 node scripts/delete-ai-data.mjs               # newest archive (the 08-42-05 one); or --archive <dir>
sudo systemctl start rss-reader
```

It takes `database.writer.lock` itself while it runs (so the service cannot start mid-delete),
deletes the collections (child rows cascade), removes the two `userPreferences` entries, then runs
`PRAGMA wal_checkpoint(TRUNCATE)`. It does not VACUUM. `--force-young-archive` overrides only the
age gate. Until it is run, the retired keys simply sit in `reader.sqlite`: the SQLite store ignores
keys it does not know, and retention no longer prunes them.

After the delete, the `// TODO remove after delete-ai-data` entries can be dropped from
`src/database/store.js`, `src/database/state-policy.js`, `src/database/sqlite/export.js` and
`src/database/sqlite/codec.js`. They were kept only because the legacy JSON store (offline
comparison and rollback) rejects keys it does not list.

## Restore

```sh
sudo systemctl stop rss-reader
nice -n 19 node scripts/restore-ai-data.mjs --archive database_state/archive/ai-removed-<timestamp> --dry-run
nice -n 19 node scripts/restore-ai-data.mjs --archive database_state/archive/ai-removed-<timestamp> [--key storyBriefings] [--overwrite]
sudo systemctl start rss-reader
```

Existing keys are skipped unless `--overwrite` is given. Restoring only puts the data back; the
code that used it is in git history before the "Remove Top stories mode" commits. A full rollback
can instead use the SQLite backups in `database_state/sqlite-backups/`.
