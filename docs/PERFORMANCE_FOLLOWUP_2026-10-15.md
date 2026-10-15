# RSS Reader follow-up — October 15, 2026

Overall acceptance: **INCOMPLETE**. This continuation fixes reproduced image lifecycle defects and reduces redundant image work. The production heap OOM and write amplification remain unresolved. No heap reduction, service CPU improvement, or navigation latency improvement is claimed from these frontend changes.

## Preserved implementation and production evidence

Verified the current SHA-256/WeakMap ranking-input implementation in `src/articles/ranking-input.js`, `src/database/stored-value.js`, `src/database/access.js`, and its snapshot integration. These files were not changed. Lazy decoding, immutable source ownership, progressive identity and the 60-second ranking interval remain intact. The previous isolated 143.05 → 50.07 MiB finding concerns **external memory**, not V8 heap.

The existing `rss-reader-audit-20261015.service` completed and was inactive. Its original `/tmp/rss-oct15/soak.jsonl` was read without restarting, truncating or overwriting it. It contains 1,433 records, 720 unique valid resource samples, one process generation, and 11.993 hours, from October 15 02:55:14 to 14:54:50 Vietnam time. There are 69 RSS completion markers and nine Smart completion changes. Deduplicated results are in [collector.json](performance-followup-2026-10-15/collector.json).

The journal confirms another heap OOM at **October 15 15:02:23 Vietnam / 08:02:23 UTC**, after collection ended. Final mark-compacts retained approximately 2,525.5 and 2,541.7 MB. PID 3849854 was killed at 08:04:18 UTC and automatically restarted at 08:04:23. Initial inspection in this continuation found PID 191049, active/running, `NRestarts=1`. The three October 14 OOMs remain part of the crash history. A completed collector is not stability acceptance when its following workload crashes.

| Unmatched production measurement | Median | p75 | p95 | Maximum |
|---|---:|---:|---:|---:|
| Heap used, MiB | 1926.73 | 2211.81 | 2440.08 | 2566.36 |
| External memory, MiB | 346.98 | 417.24 | 487.71 | 631.32 |
| RSS, MiB | 3378.19 | 3687.31 | 3890.04 | 4094.07 |
| Process CPU, % | 8 | 17 | 74 | 163 |
| Per-interval event-loop p95, ms | 21.17 | 21.84 | 55.18 | 245.89 |
| Per-interval maximum event-loop delay, ms | 789.32 | 2077.23 | 5276.43 | 21860.71 |

These event-loop rows summarize interval statistics; they are not percentiles of individual requests. The observed idle-candidate minima after successive Smart completions rose from 1403.80 to 1758.58, 1971.92, 1982.49, 2068.43, 2153.66, 2199.10 and 2243.43 MiB. These are **not proven all-jobs-completed heap floors**. The first three associated Smart cycles ended in error. The queue reached two pending persistence transactions and 69 pending AI jobs at sampled times; these maxima do not identify the retained owner.

## Heap ownership investigation

Reviewed database stored/parsed/weak-cache ownership, presentation publication histories and view-cache bounds, personal-state weak view caches, prefilter indexes, transaction queues, browser jobs and AI scheduler context. No indiscriminate release, heap-limit increase, production forced GC, production heap snapshot, permanent-data removal or provider-history modification was made.

Two current isolated replays ran with explicit diagnostic GC only in their own processes:

* Sanitizer: 12 cycles of 400 distinct forum fragments. Cache reached its 1,000-entry bound. Post-cycle heap stabilized around 45 MiB (47.54 million bytes at the last checkpoint). This workload does not reproduce the production growth.
* Current database snapshots plus keyed overlays: four completed parse cycles retained 248,999,640 / 248,999,872 / 249,000,280 / 249,029,384 bytes of heap. Releasing only that isolated parsed cache reduced heap to 93,891,128 bytes; external backing remained approximately 312.82 million bytes. This is a causal cache-release diagnostic, **not a proposed production cache flush**. The remaining snapshot/diagnostic owners are not the live service's dominant retaining path.

**CONFIRMED BUT UNRESOLVED:** dominant live retained V8 object graph, full RSS/Smart/embedding/AI/extraction overlap, and repeated-cycle stability. No new backend memory fix was justified by these isolated results. Retained-heap/external/CPU/event-loop before/after for a new memory fix: **NOT TESTED**, because none was implemented.

## Image lifecycle fixes

**CONFIRMED AND FIXED:** the old lifecycle assigned palette/tint/blend immediately, but deferred focus after the fallback had been shown. Its completion depended on leaving the viewport. The current baseline replay reproduced this in Classic at 3,000 ms: focus stayed at .5 while the returned palette was active and `deferred` remained populated. Some baseline Glass runs ended before the delayed response; those samples are inconclusive, not passes. The earlier October 15 report provides the independent Glass reproduction.

`public/image-visual-state.js` now owns source configuration, generation, timeout and asynchronous metadata completion. Focus, palette, tint and blend are assigned in the same synchronous commit. A callback must still own the image, source, configuration and generation, and the image must remain connected. A→B→A cannot revive the first A callback. Removal and shutdown ignore obsolete completions. Failed requests retain a settled fallback.

`public/image-visual-assets.js` prepares generated inline assets before a late metadata commit. Failed/timed-out generated assets are omitted while valid focus and the source photograph remain available. The existing near-viewport request queue and session metadata reuse remain. No feed-wide wait, arbitrary fade, loading overlay or thumbnail suppression was added.

**Visible correction policy:** if the 2.5-second fallback was already presented, a late authoritative result may change its crop once. That is intentional and is necessary to finish correct focus while continuously visible. The change guarantees coherent metadata ownership, not that a delayed correction is visually imperceptible. Existing CSS transitions and image geometry were not redesigned.

`public/top-story-card/blend/source-readiness.js` tracks the assigned soft-image source and owner in a WeakMap. Assigning another source clears readiness until that image's decode completes. A previous image's `complete`/`naturalWidth` cannot authorize the replacement. Stale decode completions and removed nodes cannot refresh a different owner. Blend runtime integration preserves existing geometry, masks, colors, feathering and typography.

**CONFIRMED AND FIXED:** fallback attempts leaked across primary-source replacement. The original handler produced A→A2, then B→B3 on B's first failure. `public/js/smart/image-fallback.js` resolves the next candidate from the actual assigned source rather than a lifetime DOM counter. It preserves candidate order, ignores removed images and stops at the final fallback. The legacy method now only delegates to the module.

**CONFIRMED AND FIXED:** mutation delivery used to set `state.source=null` even for identical assignments. It now preserves source ownership; the lifecycle compares actual source and configuration. With old attribute values enabled, identical `src`/`srcset`/`sizes` assignments skip the image pass. `sizes` is now observed. The viewport-exit observer used solely for indefinite deferral was removed. Genuine load/resize/geometry/insertion/removal paths remain. The existing iterable Map still releases disconnected images; no new strong registry was introduced.

## Validation and limitations

Validation results and activation evidence are appended below after completion. The initial full suite passed **797 tests, zero failures, zero skipped** in 366.10 seconds, before the final identical-assignment regression and observer removal. It is not the final-source test result.

The required extended temporal matrix remains broader than delayed metadata tests: physical iPhone Safari, browser-tab suspension, arbitrarily long idle, all real publisher decode failures, and every real responsive candidate/fallback combination require additional evidence. Linux WebKit is not physical iPhone validation. Diagnostics remain opt-in; generated fixture recordings contain no production article content. Instrumented timings are not ordinary navigation benchmarks.

## Scheduling, writes and navigation

No Smart scheduling or ranking code was modified. The 60-second interval, coalescing and signature checks remain. A scheduler request was not counted as a worker execution. Production worker execution counts and a demonstrated redundant worker reduction remain **NOT VERIFIED**.

The collector measured **270.879 GiB** of process-attributed physical writes across 11.993 hours, or **22.586 GiB/hour**. This is unmatched, not a before/after regression attribution. A 120-second file-revision observer saw changes including personal filters, provider health and event-verification state. A separate 20-second payload-suppressed syscall trace saw cache membership, article-thread cache and provider-health writes, but no large snapshot rewrite. It did not capture a representative completed heavy cycle and cannot explain the 270.879 GiB total. Syscall bytes, file revision sizes and physical bytes are distinct. No persistence change was made; no new SIGKILL recovery claim is made.

No new feed, Smart Top or cached-article navigation implementation was justified by matched critical-path evidence in this continuation. The prior multi-second feed/Top timings and cached-open tails remain **CONFIRMED BUT UNRESOLVED**. No 400 ms cached readability target or service-wide CPU improvement is claimed. Original formatting, VOZ pagination/resume, user history and content preservation continue to be covered by regression tests.

## Remaining work and rejected approaches

1. Highest priority: reproduce complete completed RSS/Smart/AI/embedding/extraction cycles in an isolated process and capture actual strong retaining paths at successive post-job boundaries. The live crash is confirmed; isolated parse/sanitizer stability does not identify it.
2. Capture per-writer attribution across a complete heavy persistence cycle with matching physical counters. Trace the callers before considering coalescing or incremental commits; then test interrupted writes and SIGKILL recovery.
3. Finish temporal image acceptance on physical iPhone and real image replacements, including background/foreground, extended idle and failed decode/retry cases.
4. Run matched uninstrumented T0–T17 feed/Top and cached-readable-frame experiments after the lifecycle correction, separating server time from browser scheduling and rendering. Remove repeated work only where demonstrated.

**REJECTED / NOT APPLIED:** approximate fingerprints; retained full JSON equality strings; arbitrary 15-minute ranking; blanket cache flushing; broad CSS-container observer exclusions; readiness inherited from an old decoded hero; disabling blur/Smart/AI; reducing article counts; deleting histories; increasing the heap cap. The dirty working tree and existing VOZ/ranking fixes were preserved; nothing was staged or reset.

## Matched image-assignment experiment

Alternating before/after/after/before replays used the same fixture article data, local image bytes, 1440×900 Chromium viewport and theme. Each run assigned identical sources to eight cards 12 times. Instrumentation counted actual image application passes; native load/resize work can still occur after a browser source setter.

| Theme | Before image passes (two runs) | After image passes (two runs) | Card geometry |
|---|---:|---:|---|
| Classic | 197 / 197 | 77 / 77 | Preserved in all runs |
| Liquid Glass | 244 / 236 | 104 / 104 | Preserved in all runs |

This establishes reduced redundant image work in that controlled trigger. It does not establish that unrelated source-time, hover, briefing or child-list mutations no longer do work; those paths were deliberately preserved.

Instrumented assignment-to-two-frame distributions, **under varying production/test contention**, are shown for transparency, not navigation acceptance:

| Theme / variant | Median ms | p75 ms | p95 ms | Max ms |
|---|---:|---:|---:|---:|
| Classic before | 488.50 | 573.20 | 746.10 | 802.40 |
| Classic after | 405.30 | 527.70 | 764.90 | 1235.20 |
| Glass before | 3746.40 | 4023.90 | 4814.80 | 5706.80 |
| Glass after | 2886.45 | 3661.80 | 4762.50 | 5096.60 |

Classic tails worsened in this small loaded experiment. No fixed-p95 or broad speedup claim follows. Raw scalar results: [identical-images.json](performance-followup-2026-10-15/identical-images.json).

The concurrent intermediate full run completed with 796/798 passing, two timeouts, and zero skipped. Both timed-out tests passed sequentially with unchanged limits: publication retention in 15.66 seconds and HTTP application smoke in 12.61 seconds. This history is retained; the isolated reruns do not substitute for a clean final full suite.
