# Performance follow-up — 7–8 October 2026

## Status

**Incomplete: do not treat this as final acceptance.** Several measured causes have been fixed and activated. The desktop Forum thumbnail regression is fixed. Stable retained heap across repeated completed job cycles, fast desktop navigation, and consistently sub-400 ms cached articles remain unproven. Live disk writes remain excessive.

Evidence: `/tmp/rss-audit-followup-20261007/`; repeatable drivers: `tools/experiments/performance-audit/`. Captures contain private article/state data and are not committed. Existing unrelated checkout changes were preserved. Mobile tests use Chromium emulation, not real Safari/iPhone.

## Causes, implementation, and focused evidence

| Cause | Fix and modules | Evidence / boundary |
|---|---|---|
| Database owner retained large decoded serialized strings, alongside parsed graphs. | `src/database/stored-value.js`, `access.js`; store wiring; immutable UTF-8 backing for large strings, original public API types. | Same frozen state and parsed owners after isolated diagnostic GC: heap 954 → 446 MiB; RSS 1051 → 844 MiB; external 2 → 303 MiB. This identifies a substantial necessary owner and reduces its representation, but does not identify every live retainer. |
| Small state changes rewrote unrelated large overlay values, including the permanent identity ledger. | `keyed-overlay.js`, `persistence.js`; durable versioned per-key parts, ordered fsync and atomic manifest replacement. | Identical ledger plus 12 small updates: 450,664,506 → 34,692,670 bytes; CPU 2.26 → 0.29 seconds. Exact recovered values checked. Changed large keys still rewrite. |
| Embedding checkpoints rewrote the full history even when required vectors had not changed. | `src/smart/embeddings/checkpoint.js`, worker-runner wiring. | Real cache, 500 required vectors, 3 unchanged checkpoints: 988,529,907 bytes / 22.45 s → zero writes / 4.49 ms. Changed vectors still rewrite the approximately 330 MB file. |
| AI admission checked available capacity before an asynchronous gap; test callbacks assumed arrival order. | `src/ai/provider-admission.js`, provider wiring; deterministic mock matching and bounded tests. | Eight simultaneous calls: peak 8 → configured peak 2. Ten repeated isolated test runs passed. Existing scheduler remains authoritative. |
| Thumbnail requests occupied browser connections needed by navigation. | `public/thumbnail-loading.js`, card binding, image-focus wiring; near-visible requests limited to two. Cached image lookup avoids full article normalization; remote discovery uses existing P2 lane. | Identical eight slow images: all eight load; peak active 6 → 2; navigation 945–1121 ms → 8–17 ms. Controlled production mobile fixture with 35 s thumbnails: Smart timeout at 30,060 ms / 0 cards → 2,183 ms / 8 cards. |
| First thumbnail fix observed a hidden source image in desktop Glass mode. Its rectangle was zero, leaving thumbnail/focus work waiting until resize. | Thumbnail loading and image focus now observe the visible card; offscreen stalled requests release admission. | Reproduced blank desktop Forum. Fixed live 1440 px viewport shows decoded photos and focus-ready cards before any resize and after scrolling; screenshot inspected. Regression covers hidden source image. |
| Failed feed requests could resemble an empty successful list. | `public/js/feeds/requests.js`, `list.js`, existing list component. | Distinct timeout/network/server messages and explicit retry; stale navigation cannot overwrite the latest view. Tests cover timeout, 503/offline, and stale abort. |
| Client persistence traversed reactive proxies during synchronous saving. | `public/js/app/persistence.js`; raw nested values used for read-only serialization. | Paired same-page saved contents equal; typical mobile save approximately 14–16 → 9–11 ms. Cached article improvements remain small/mixed. |
| Published personal decisions committed one article at a time, repeatedly cloning and serializing all prior decisions. | `src/smart/prefilter/published-view.js`; batch by original destination override, retain original ordering and state invalidation. | Five matched 100-story replays: 100 → 1 writes; 6,323,719 → 122,733 serialized bytes; median 176 → 53 ms. These are serialization counts, not physical disk measurements. Mixed destinations, failed durable commit, repeated reads, and Undo tested. |

## Memory, CPU, and disk observations

The old implementation suffered another OOM on 7 October at 05:20:55 UTC: full GC retained 3062.8 MiB and systemd restarted it. The staged fixes were activated later at approximately 12:11 and 12:36 UTC. Do not attribute the earlier crash to the later implementation.

Stage-two PID 3538677 remained running without an automatic restart for over five hours. At 5 h 10 min: heap 1,618,314,920 bytes, RSS 2,503,774,208 bytes, external 461,823,198 bytes; Smart refresh was no longer running, database transaction queue empty. Earlier half-hour heap minima rose from approximately 471 to 1560 MiB while work progressed. This is not proof of stable retained heap: no live forced GC was performed in this follow-up.

A user-approved two-minute allocation sample at about five hours showed heap varying approximately 1.68–2.05 GB, falling during the sample. Largest sampled surviving allocations included database reads (~26 MB and ~14 MB), personal identity work (~15 MB), and decoding (~14 MB). Sampling allocation sites is **not** a full retaining-owner graph. No live heap snapshot was taken. The localhost inspector was explicitly closed and its listening port verified absent after collection; no service restart or forced GC was used for this diagnostic.

One-hour stage-two sample (361 observations):

| Metric | Median | p75 | p95 | Max |
|---|---:|---:|---:|---:|
| Heap MiB | 976.3 | 1091.6 | 1233.5 | 1515.3 |
| RSS MiB | 3016.5 | 3141.0 | 3510.2 | 3957.0 |
| CPU percent, process | 9 | 34 | 91 | 107 |

Physical process writes were **21.879 GiB in 60.76 minutes**. This remains high despite the proven component savings. Main/Smart snapshots, changed embeddings, the identity ledger, and decision/briefing state still contribute. File-event tracking excludes some backup/temp files; `/proc/io` provides the broader total. The earlier 34.7 GB / 3.5 hours and current hour do not have matched workloads, so they cannot establish a causal whole-service improvement. Shared desktop Chromium memory is not all reader-owned.

## Navigation and rendering

Unmatched live runs during changing background load:

| View | Before | Stage two |
|---|---|---|
| Mobile feed, four samples | median 1300 ms; p75 1721; max 2366 | median 756 ms; max 2577 |
| Desktop feed, four samples | median 2653 ms; p75 3211; max 4163 | median 4490 ms; max 4994 |
| Mobile Top, two samples | 2911 / 4678 ms | 6240 / 4462 ms, 15 cards |
| Desktop Top, two samples | 9278 / 5441 ms | 13989 / 11119 ms, 40 cards |

These results are mixed and do not prove the desktop speed objective. Connection tracing previously measured a 5856 ms wait before sending one mobile Smart request, and a separate cold persisted-state read of 4649 ms. Thumbnail contention is now controlled; backend cold work and frontend rendering still need investigation.

Later six-category mobile run, after the Forum fix, showed 15 cards and no JavaScript errors in every case:

| Destination | Classic ms | Glass ms |
|---|---:|---:|
| News global | 5607 | 7293 |
| Finance global | 7630 | 9352 |
| Tech global | 8816 | 15689 |
| News Vietnam | 12991 | 12324 |
| Finance Vietnam | 13205 | 19224 |
| Tech Vietnam | 5593 | 16943 |

No zero-card timeout in these 12 cases, but latency is still unacceptable. One observation per combination is insufficient for meaningful per-combination percentiles.

Cached article opens in a later live profile: 867 / 442 / 487 / 238 ms, same 7403-character content. Earlier 1353–1509 ms observations were not workload-matched. Native DOM/layout and synchronous persistence remain relevant; no claim of consistently achieving 400 ms.

Sixteen controlled before/after production-card cases retained exact card geometry across desktop/mobile, Classic/Glass, feed/Top. Timings were mixed; mobile Classic Top regressed from 175 to 249 ms in that replay. The original fixture missed the hidden-image thumbnail regression; the new dedicated desktop Forum check covers it. Slow-network/mobile fixture passed feed selection, readable overlay, and error recovery. Physical WebKit remains untested.

## Verification and activation

Full suite after the Forum fix: **749/749 passed**, `final-suite.log`. The additional publication-batching change has its own focused regression and a subsequent full-suite run recorded in `batch-full-suite.log`; activation status is recorded below after validation.

Publication batching: **750/750 passed**, zero failures or skipped tests. Activated with a controlled service restart on 8 October; `/health` returned `ok`, systemd `active/running`, `NRestarts=0`, PID 61926. The inspector port remained closed. Initial heap was 380 MiB; this startup value is not evidence of improved long-term retention.

Browser-assisted VOZ extraction was checked before the earlier activation: 198,549 bytes returned with title and posts. Existing page identity, resume, source strategy, and history semantics were retained. No new provider calls or ranking shortcuts were introduced.

## Rollback and outstanding acceptance

Before-change code archive: `/tmp/rss-audit-followup-20261007/code-before.tar.gz`; associated README, ignore, and backup-script copies are beside it. Do not reset the whole dirty checkout. For a format rollback, stop the writer, use `ops/maintenance/export-state-overlays.mjs` to export keyed overlays to legacy files, then restore the relevant old code. Keep the parts until conversion succeeds. The export guard refuses to run against an active writer. No destructive production rollback was performed.

Remaining work, in priority order:

1. Identify additional reachable owners after repeated completed jobs in an isolated representative instance; establish long-term retained-heap stability. A five-hour no-crash observation is insufficient.
2. Remove measured multi-second desktop and Smart cold-path stalls, separating backend, connection, and rendering time under equivalent workloads.
3. Reduce remaining changed-snapshot and changed-embedding write amplification with crash-consistent persistence.
4. Improve cached article rendering without changing source formatting, VOZ page/resume behavior, or freshness.
5. Complete matched end-to-end scenario runs and actual WebKit/iPhone validation when available.

No overall success claim is warranted until these acceptance gaps are resolved.
