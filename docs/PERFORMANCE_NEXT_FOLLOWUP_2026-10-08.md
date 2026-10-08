# Next performance follow-up — 8 October 2026

**Acceptance remains blocked.** Specific retained ownership and write-amplification fixes have controlled evidence. Whole-service post-job memory floors, disk writes per hour, and consistently fast live navigation are not yet acceptable. This report extends `PERFORMANCE_FOLLOWUP_2026-10-08.md`; it does not claim its previously completed fixes again.

Evidence directory: `/tmp/rss-next-20261008`. Times in evidence are UTC; Vietnam time is UTC+7. Temporary evidence contains local diagnostics and must not be published as a repository fixture.

## New causes and implemented changes

* Pinned publication cache entries strongly retained historical personal-decision states and their indexes. Their state-generation comparison now uses weak references. Current authoritative state remains strongly owned.
* Card Board-membership/folder checks repeatedly scanned the same immutable collections. Weakly owned indexes now share those lookups, with collection replacement on mutation.
* Opening one Smart destination filtered the entire six-destination publication. A weakly owned section index shares existing card objects and limits navigation to the requested destination.
* Some Smart metadata and published-state updates still fell through to full main/Smart snapshots and backups. Their keys now use the existing atomic keyed-overlay writer.
* Changed embedding checkpoints still rewrote the entire history. Immutable delta parts and an atomic manifest now persist changed vectors; the original flat file remains readable and immutable. Delta compaction streams live vectors without rewriting the legacy base.
* Cached forum opens reconstructed Intl formatters for each post. Shared formatters preserve existing text and accessibility labels.
* Smart navigation repeatedly applied personal filtering to unchanged immutable ranked lists, twice per request. A navigation-specific cache keys reuse by input array, destination, stage, and exact personal-state generation. Undo, concurrent edits, and new inputs invalidate it; old personal graphs are weakly referenced.

All implementation is in modules, with minimal integration changes in existing entry points. No ranking/coverage reduction, cache clearing, production forced GC, heap increase, or new queue system was introduced.

## Memory ownership and floors

Controlled ownership experiment: five completed personal transactions, each containing 20,000 representative historical decisions, with five pinned published snapshots. Explicit GC is confined to this isolated diagnostic process.

| Completed cycle | Before post-idle heap, MiB | After post-idle heap, MiB |
|---|---:|---:|
| 1 | 63.2 | 62.4 |
| 2 | 81.5 | 63.3 |
| 3 | 99.8 | 63.3 |
| 4 | 118.1 | 63.3 |
| 5 | 136.4 | 63.3 |

Heap graph evidence: `publication-before.heapsnapshot` and `publication-after.heapsnapshot`, with `owners-before.json`/`owners-after.json`, identify five publication-cache `state` edges changing from strong Object edges to WeakRef edges. Live personal-state generations rise from one to five before; exactly one survives each completed after-cycle. This proves the specific ownership repair, **not** whole-service stability.

The 30-second collector records heapUsed/heapTotal/RSS/external/arrayBuffers, old space, natural GC, CPU, physical write counters, event-loop delay, queue/job state, browser pages, and job boundaries. At 22:37 Vietnam time it had 648 samples over approximately 5.44 hours, spanning two process generations. The first segment completed 13 RSS boundaries, the second 22; neither recorded a completed Smart boundary. Only two samples were fully quiescent, both near startup (approximately 441 and 458 MiB), so they are not repeated completed-job floors.

The later process segment had heap median approximately 1066 MiB and maximum 1765 MiB while work was active. Old-space growth and multi-second event-loop maxima remain concerning. Do not interpret survival, startup memory, or active-job minima as a memory acceptance pass.

## Desktop navigation and Smart Top

`full-navigation-timeline.mjs` captures handler entry, fetch creation, CDP network timing/protocol, server receipt, database lookup/decode/parse/clone, server stages, compression, response completion, JSON parsing, assignment, first DOM mutation, and visible-card/frame completion. Detailed rows are in `tab-current.json`.

Examples from the same live desktop Classic run, with 40 cards:

| Stage | Cold Smart Top | Slow feed | Warm Smart Top |
|---|---:|---:|---:|
| Action → request creation | 64 ms | 9 ms | 12 ms |
| Origin processing total | 4400 ms | 2286 ms | 653 ms |
| Published state/filter read | 2996 ms | — | 1 ms |
| Personal/view filtering | 263 ms | — | 319 ms |
| Snapshot construction | 117 ms | — | 189 ms |
| Card preparation | 960 ms | 34 ms | 64 ms |
| Compression interval | 44 ms | 2102 ms | 66 ms |
| Headers → parsed JSON | 36 ms | 25 ms | 31 ms |
| State assignment → stable-frame proxy | 237 ms | 334 ms | 238 ms |
| Action → stable-frame proxy | 5662 ms | 3313 ms | 1638 ms |

The slow feed's compression interval contained 2102 ms of active main-loop time and essentially zero idle time. This is not evidence that gzip itself required two seconds: its completion callback was delayed while the main thread was busy. Another request showed 1786 ms with the same pattern. A separate 30-second server CPU sample attributed substantial active time to GC and background database parsing, including briefing prewarm publication reads. It did not capture every slow-navigation burst, so attribution is incomplete.

Browser wait must remain separate from server processing: request creation → response headers also includes browser dispatch/connection wait, transfer, and callback scheduling. CDP rows retain those individual fields. Local traffic uses HTTP/1.1; no production HTTP/2/3 parity claim is made. These live samples do not establish a new thumbnail-starvation defect.

Matched synthetic personal-filter replay: 861 unchanged articles, an active confirmed rule, 32 samples per variant in alternating blocks. Before median/p75/p95/max: **346/441/587/889 ms**; cached path: **0.005/0.011/13/419 ms**, including the initial cold fill. Real dismissal and Undo behavior were checked. This is one backend stage, not an end-to-end percentage.

Timeline limitations: browser “first useful” is a measured visible-card frame after loading completes, not proof of the earliest possible paint. Two animation frames do not guarantee that all late images have settled. The POST-blocking browser route prevents benchmark preference/history mutations but disables browser HTTP caching. Not every requested T0–T17 substage has an independently measured boundary.

## Physical disk writes

Matched isolated persistence replays use the same data and mutations and read `/proc/self/io` physical write counters:

| Workload | Before physical bytes | After physical bytes |
|---|---:|---:|
| Three cycles of four Smart metadata/publication mutations | 4,607,860,736 | 429,735,936 |
| Five changed-vector checkpoints, 329 MB legacy history, 200 changed vectors/checkpoint | 1,645,158,400 | 10,936,320 |

The first workload still writes changed Top state and publications in full; its improvement comes from avoiding unrelated snapshots/backups. The second preserves all historical vector keys and verifies restart/subset recovery.

**Matched whole-service before/after bytes/hour is not available.** The live soak's first process segment wrote 56.71 GiB over 2.01 hours; the later segment wrote 84.45 GiB over 3.41 hours. These are unmatched workloads and do not demonstrate service-wide I/O improvement. Process counters can include reaped child-process writes.

Targeted payload-suppressed syscall tracing found these leading writers in a 150-second active interval (`writes-refresh.json`). These are returned write syscall bytes, not per-file physical block accounting:

| File/dataset | Writes | Bytes | Average | Trigger / next opportunity |
|---|---:|---:|---:|---|
| Provider conversation_summaries.db-wal | 15,159 | 21,192,120 | 1,398 | External CLI bookkeeping; outside reader persistence |
| Provider conversation_summaries.db | 1,162 | 4,759,552 | 4,096 | External CLI checkpointing |
| Thread archive example | 6 | approximately 1.19 MB | approximately 198 KB | Board refresh; inspect incremental post persistence |
| Second thread archive example | 4 | approximately 1.02 MB | approximately 255 KB | Board refresh |
| Article strategy statistics revision | 2 | approximately 466 KB | approximately 233 KB | Fetch outcomes; possible coalescing |
| Cache membership revision | 2 | approximately 285 KB | approximately 142 KB | Board membership refresh |

Exact maxima and paths are in the evidence JSON. A later 60-second trace captured only 466 KB of strategy statistics plus small health/manifest writes; neither short trace explains the full hourly total. Large corpus snapshots and external provider writes remain blockers. No provider history was deleted or modified.

Disk-format recovery tests cover legacy loading, normal merge/restart, streaming compaction, missing indexed data, altered legacy bases, and real SIGKILL at partial-part, durable-part, pre-manifest, and committed-manifest boundaries. Old code cannot safely read new embedding deltas: rollback requires flattening the committed generation first. Backups of runtime state must preserve the legacy base, manifest, and referenced parts together. The existing sanitized public repository backup intentionally excludes runtime data.

## Cached articles

Matched synthetic cached forum article, 40 posts, identical cache/content/state, 16 opens per viewport/variant. Milliseconds:

| Viewport / variant | Median | p75 | p95 | Maximum |
|---|---:|---:|---:|---:|
| Desktop before | 416.0 | 492.6 | 978.0 | 978.0 |
| Desktop after | 38.0 | 45.1 | 298.2 | 298.2 |
| Mobile Chromium before | 69.8 | 75.0 | 104.6 | 104.6 |
| Mobile Chromium after | 42.3 | 62.0 | 113.4 | 113.4 |

Source-time markup preparation median fell from 50.2 to 2.0 ms on desktop and 16.4 to 3.2 ms on mobile. Mobile maximum did not improve. These synthetic results do not prove a live cached-article p95 below 400 ms. Persistence, speech preparation, VOZ position checks, assignment, and frame delay remain separate recorded stages in `cached-replay.json`.

Automatic approval review rejected exporting live article/history data into a new fixture. The matched article replay therefore uses synthetic content. Timing-only live profiling remains permitted; no rejected export was retried through another mechanism.

## Frontend and WebKit

Glass browser CPU profiling found several seconds in forced geometry reads from `fitCardImageViewport`, repeated watch/mutation paths, shared-card style admission, and Top photo geometry. Classic also showed DOM construction/removal, reactive evaluation, GC, and synchronous persistence. Network-only improvements cannot resolve all Glass stalls.

An animation-frame coalescing experiment was rejected: Smart Top did not improve consistently and fallback-position timing differed. Its implementation was removed. A narrower viewport-admission experiment is under validation; no appearance/design simplification is authorized.

Actual **Linux Playwright WebKit 26.5** ran with an iPhone viewport/user agent. This is real WebKit, **not a physical iPhone or iOS Safari validation**. Classic and Glass passed initial load, feed/Top switching, cached/first article opening, ten open/back cycles, long scrolling, delayed API responses, and offline failure/recovery with zero JavaScript errors. DOM count stayed constant at 2006 during the repeated fixture cycle. It was slow: Top approximately 6–10 seconds and cached opens approximately 1.3–4.3 seconds on this headless host. Physical touch, OS background/foreground resume, iOS memory pressure, and real-device responsiveness remain untested.

## Tests, activation, and remaining acceptance

Latest completed full suite before final viewport-admission validation: **761 passed, 0 failed**, 371.4 seconds. Focused embedding SIGKILL/recovery tests passed. Final activation and measurements will be appended after validation.

Still required: stable post-Smart/RSS completed-job floors across multiple cycles; elimination of remaining cold-state and main-loop stalls; consistent Glass rendering and live cached-article tail latency; matched service-wide physical writes/hour with attribution of major bursts; responsive navigation during representative background work; physical iPhone testing when available. This pass must not be described as complete while these remain open.
