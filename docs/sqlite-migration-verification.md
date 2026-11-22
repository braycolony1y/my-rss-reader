# SQLite migration verification

Migration completed on 12 November 2026. The reader now uses
`database_state/reader.sqlite`; images, PDFs and large media remain files.
See [storage and recovery procedures](sqlite-storage.md).

## Preservation and recovery

The live import validated 52 collection descriptors and their record digests,
relationships, counts, SQLite integrity and foreign keys before publishing the
database. Import and validation took 180 seconds, excluding source backup time.

| Collection | Imported records |
| --- | ---: |
| Feeds | 49 |
| Feed articles | 9,316 |
| Reading states | 760 |
| Saved states | 22 |
| Board states | 200 |
| Preferences | 5,199 |
| Smart clusters | 13,852 |
| Smart raw articles | 1,715 |
| Smart clustering inputs | 7,990 |
| Content and archive files imported | 8,688 |

The first verified backup is
`database_state/sqlite-backups/reader-2026-11-12T09-18-19-017Z.sqlite`.
It was restored into an isolated directory using the supported restore command.
All collection revisions, encodings, fingerprints and counts matched. Counts
also matched across all 11 data tables, including 41,023 article variants,
4,725 cluster members, 8,150 ranking rows, 16,327 archive entries and all
8,688 cache paths/digests/deletion states. Logical collection counts differ
from physical table counts because tables also contain Smart sources, historical
variants, normalized child collections and cache membership metadata.

Original JSON snapshots, overlays and content-cache files remain retained.
After activation, all 8,717 original source/cache files were rehashed against
the migration inventory and matched. Live reading, saved, Board, hidden,
recent-history and preference state matched the exact restored cutover backup.
One cursor had advanced between the earlier API baseline and stopping the old
writer; its newer value was preserved.
Checksummed source copies and the full validation inventory are under
`database_state/sqlite-migrations/2026-11-12T04-49-23-015Z-ce17a7a3-9b78-4342-beae-4c78cbbede27/`.
An abandoned, unpublished rehearsal stage remains preserved for inspection.
No cleanup of original JSON has been scheduled.

## Matched measurements

The maintained storage and HTTP experiments ran against isolated copies of the
same frozen production snapshots. External providers were disabled for HTTP
comparisons. These are single-host measurements, with competing host work;
they establish targeted improvements rather than absolute latency guarantees.
MiB and KiB use binary units.

| Isolated storage operation | JSON | SQLite |
| --- | ---: | ---: |
| Cold storage initialization | 44.34 s | 1.33 s |
| First article read after initialization | <1 ms, eagerly loaded | 2.86 s, loaded on demand |
| Indexed lookup of 20 Smart articles | 1.70 s | 0.96 s |
| Ten preference changes | 1.90 s | 1.36 s |
| Physical writes for ten preference changes | 4.49 MiB | 124 KiB |
| One article update | 47.31 s | 3.95 s |
| Physical writes for one article update | 393.20 MiB | 36 KiB |
| Ranking fingerprint | 234 ms | 17 ms |
| RSS after the storage workload | 647 MiB | 384 MiB |

Physical write bytes come from `/proc/self/io`. WAL checkpoints and filesystem
accounting can shift writes between operations, so these samples should not be
treated as a fixed per-update cost. Compatibility callers can still provide a
whole collection: unchanged records are skipped, while entry-level preference
and editorial/verification cache paths avoid whole-map decoding and rewriting.

| Whole application, providers disabled | JSON | SQLite |
| --- | ---: | ---: |
| Cold application initialization | 47.39 s | 0.61 s |
| Warm Today API median | 662 ms | 270 ms |
| Warm Saved API median | 1,079 ms | 412 ms |
| Warm Recently Read API median | 1,338 ms | 438 ms |
| Warm Board API median | 1,290 ms | 450 ms |
| Warm Smart Classic API median | 1,681 ms | 181 ms |
| Warm Smart Top API median | 892 ms | 160 ms |
| RSS after 24 view requests | 1,446 MiB | 1,462 MiB |

Warm medians use three measured repeats after the initial pass. Whole-app RSS
was effectively flat, slightly higher in this sample. The storage owner no
longer retains roughly 309 MB of serialized corpus buffers, but presentation
graphs and application work still dominate warm memory. A restarted live
process is not evidence of a long-term memory reduction.

An unchanged full Smart publication of 21,842 input/cluster records took 2.34 s,
wrote zero changed records and used 409 MiB process RSS. Global clustering and
diversity ranking retain complete required inputs; targeted lookups, metadata
projections and per-entry caches reduce unnecessary work without approximating
the ranking algorithm.

## Size and maintenance

The migrated database and its first backup are each 1,127,710,720 bytes
(1.05 GiB). The two active legacy snapshots total 328,609,559 bytes
(313 MiB); imported cache JSON adds 499,905,475 bytes (477 MiB), before
overlays and recovery copies. SQLite is larger than those two snapshots plus
cache JSON because of relational rows, indexes and preserved state. Size
reduction is not claimed. The preserved source inventory, including recovery
copies, totals 2,281,242,114 bytes, separately from content caches.

Runtime uses WAL, FULL durability, foreign keys, a 10-second busy timeout,
8 MiB page caches, bounded decoded caching and dedicated database/maintenance
workers. Six-hour maintenance performs integrity checks, index optimization,
passive checkpoints and private verified backups, retaining 12. Existing
retention rules govern content cleanup; tombstones prevent old retained JSON
from reappearing. Saved stories and history have no new guessed expiration.

Local backup restoration is verified. An off-server backup destination has not
been configured by this change. Existing media and protected configuration
must accompany database backups for complete server-disaster recovery.

## Regression coverage and acceptance limits

Storage tests cover lossless migration, Unicode and opaque values, duplicate
IDs/order, overlays, concurrent transactions, callback rollback, stale ranking
fingerprints, process-crash/WAL recovery, checksum restoration, cache deletion,
per-post archive updates and rollback to current JSON including new writes.
Integration coverage includes Boards, preferences, retained content, PDF jobs,
ranking inputs, feed publication and HTTP behavior.
The final full `npm test` run passed **979 tests, zero failures** and both
entry-point syntax checks. The test run used host access because isolated HTTP
fixtures require local listening sockets. The earlier restricted run's socket
permission failures were environmental.

The activated service passed health checks with zero automatic restarts.
Today, Saved, Recently Read, Boards, Smart Classic and Smart Top returned their
expected article-array API shapes. A retained Board thread loaded 39,528 bytes
of archived content through the reader API in 178 ms. Desktop and mobile
Chromium rendered Forum, Saved and Board cards without JavaScript errors.
Mobile pagination's read-only POST data requests were allowed by the browser
audit guard; preference and reading-state writes remained blocked.

On frozen snapshots, all six view responses retained identical article links
and order. With an identical ranking clock, Saved, Recently Read, Board, Smart
Classic and Smart Top also had identical complete article payload hashes.
The Today comparison retained a benchmark-only `sqliteBenchmark` property in
the legacy fixture's first article; this field was removed from the SQLite
fixture before the comparison. The original uncontrolled-clock Classic hash
difference disappeared with the fixed clock.

Evidence and repeatable experiment output are retained locally under
`/tmp/rss-sqlite-audit/`. Private data is excluded from source backups. No
multi-day memory/OOM soak or physical-device Safari acceptance is claimed.
