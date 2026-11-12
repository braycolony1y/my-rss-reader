# SQLite storage

The default owner is `src/database/sqlite/store.js`. Node 24's built-in SQLite
runs in a dedicated worker without another database service. The legacy JSON
implementation remains for comparisons and explicit rollback, never silent
recovery from stale files.

## Audit and compatibility

Previously, main/Smart JSON snapshots and revisioned state parts formed one
database. The owner retained the complete serialized corpus and a decoded cache;
corpus commits rewrote snapshots and backup copies. The initial live sample was
1,596 MiB RSS with about 313 MB retained serialized values. RSS, Smart and AI jobs
were active: this was not an idle memory floor.

RSS_DATA get/put/putMany/updateMany preserve JSON-text, opaque-string and native
types, IDs, duplicate variants, ordering, unknown fields, relationships and newer
overlays. Historical saved links need not reference a current feed/article, so
they are not constrained to live corpus membership.

## Schema and runtime

`database_state/reader.sqlite` stores sources, feeds, article variants, related
cluster members, publication/ranking rows, reading history, Boards, preferences,
rules and per-entry persistent metadata. Indexed columns cover links, normalized
state URLs, categories, dates, cluster IDs and publication ranks. Per-record JSON
retains publisher/editorial extension fields; corpora are not single blobs.

Article content caches, Board archives and PDF job checkpoints also use SQLite.
Board posts and historical snapshots are separate rows. Images, PDFs, model
weights and derived embedding/image caches remain files. Credentials/provider
operational state stay in their protected configuration locations. Browser
navigation caches remain local.

Connections use WAL, FULL synchronous durability, foreign keys, a 10-second busy
timeout and an 8 MiB page cache. Migration temporarily allows 64 MiB. Decoded
caching defaults to 48 MiB (`RSS_SQLITE_CACHE_MB`) plus weak references to graphs
still owned by presentation views. Large serialized corpus buffers are not kept.

updateMany holds BEGIN IMMEDIATE through its synchronous updater and commit.
Callbacks are never replayed. Errors/expired transactions roll back. Worker death
rejects uncertain operations, invalidates caches and causes the main owner to
exit, allowing systemd/WAL recovery. Ranking fingerprints verify revision and
materialize within the same read transaction.

Smart processing uses indexed personal/feedback lookups, link-only feed cleanup
projections, revision fingerprints, and entry-level editorial/verification caches.
Global clustering and diversity ranking retain their complete required inputs.

## Migration

Migration requires the actual host writer to be stopped. Checksummed immutable
copies of snapshots, overlays, referenced parts and recovery backups are retained
under `database_state/sqlite-migrations/`. Large double-encoded values stream
through temporary files; UTF-16 spill files preserve lone surrogate characters.
Records, relationships and counts are validated, then integrity/foreign-key checks
run before checkpoint/close/atomic rename. `sqlite-cutover.json` prevents importing
stale JSON after an established database goes missing. Interrupted staging is
not published and can be retried. Original JSON/cache files are retained.

```sh
sudo systemctl stop rss-reader
node ops/maintenance/sqlite-storage.mjs migrate
node ops/maintenance/sqlite-storage.mjs backup
sudo systemctl restart rss-reader
```

## Backup, recovery and rollback

Private online backups run every six hours, retaining the newest 12. Backup and
integrity checks run on separate connections/workers so they do not hold the
application request queue. Each backup is integrity-checked and has a checksum
manifest. Local backups do not protect against losing the server: copy backups,
manifests, media and configuration to your existing private off-server destination.
The public GitHub source backup excludes databases/private content.

```sh
node ops/backup/backup-sqlite.mjs
node ops/maintenance/sqlite-storage.mjs check
sudo systemctl stop rss-reader
node ops/maintenance/sqlite-storage.mjs restore /absolute/backup.sqlite
sudo systemctl restart rss-reader
```

Restore verifies the manifest and integrity, quarantines the previous database
and WAL/SHM together, and atomically installs the backup. It never combines an
old WAL with a replacement database or silently recovers from stale JSON.

```sh
sudo systemctl stop rss-reader
node ops/maintenance/sqlite-storage.mjs rollback-json
sudo systemctl restart rss-reader
```

Rollback backs up SQLite, exports its current state/cache records, imports that
export into an isolated database, and compares descriptors/digests. Only after
validation does it preserve the old originals, install the export and publish an
explicit `backend.json` selection. Post-migration writes are included. SQLite and
all originals remain. New writes made after rollback must be migrated deliberately
before returning to SQLite; do not select the older SQLite snapshot directly.

Existing saved/Board protection and content-retention rules govern cache cleanup.
Tombstones prevent preserved cache files reappearing after logical deletion.
Maintenance checks integrity, optimizes indexes and requests passive checkpoints;
it does not guess expiry rules for history, saved stories or editorial state.

Isolated benchmarks are `tools/experiments/performance-audit/sqlite-storage.mjs`
and `sqlite-http.mjs`. Source checksums, imported counts and validated digests are
in the local migration report. Cold/warm and isolated/live results must be reported
separately; see the migration verification report for measured outcomes and limits.
