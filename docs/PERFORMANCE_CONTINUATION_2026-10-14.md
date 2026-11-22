# Performance continuation — 14 October 2026

**Status: incomplete.** One frontend root cause is fixed and validated. Feed/Smart navigation, cached-article latency, memory stability, and overall physical-write reduction still fail or lack sufficient acceptance evidence. The twelve-hour collector recorded a fatal JavaScript heap OOM followed by an automatic service restart. A lower heap after that restart is not an improvement.

Times below are milliseconds unless specified. Percentiles use nearest rank; medians average the middle pair. Small samples do not establish population tail latency. Live timings include the actual shared host and background workload; they are not matched before/after experiments.

## 1–4. Confirmed cause, paths, change, modules

Background feed revalidation cloned each matched article in `public/js/feeds/requests.js`. `articleRowKey()` in `public/js/feeds/list.js` assigns keys through a WeakMap keyed by article object. `public/components/article-card.html` uses those keys for its Alpine loop. Cloning therefore destroyed and recreated otherwise unchanged cards, including their image initialization and observers.

The existing request module now updates a matched object with `Object.assign(existing, refreshed)`. It retains object identity, visible membership, order and local fields while applying fresh server fields. Identity aliases remain id/guid/originalLink/link. The authoritative Smart Top replacement path is unchanged. No CSS, image-focus geometry, masks, layout, extraction, AI, or backend behavior was changed. `index.html` contains only the script-version integration change, `20261014_revalidation_1`.

`test/feed-pagination.test.js` now verifies object and row-key identity, changed canonical link/title/briefing, retained local fields, retained missing entries and exclusion of new entries during background revalidation. Browser checks additionally change image URLs.

Diagnostic modules added under `tools/experiments/performance-audit/`: `image-observer-probe.mjs`, `revalidation-replay.mjs`, `soak-summary.mjs`. Existing `image-update-replay.mjs` gained candidate/trace replay options; `client-profile.mjs` gained optional unsampled timings and synchronous-stage measurements. These are diagnostic tools, not production instrumentation. Existing unrelated work in the dirty checkout was preserved.

## 5. Rejected candidates

* Suppressing unchanged story-attribute assignments: the 40-card Glass replay improved feed median 5,688 → 5,184 but worsened Top 7,159 → 9,023. Rejected.
* Ignoring unchanged mutation records: 146 of 1,447 records were unchanged, but rectangle reads stayed at 136. Rejected; no demonstrated useful reduction.
* Skipping image intersection work when visibility appeared unchanged: rectangle reads fell 240 → 90, but Glass feed median worsened 1,954 → 2,103 and Top 2,942 → 2,958. A traced image fallback differed in focal position, 70/40 versus 50/50. Rejected for inconsistent timing and insufficient visual equivalence.

The production image-focus, mutation and blend implementations retain their original behavior. No unbounded image-observer feedback loop was demonstrated.

## 6. Matched browser style/layout experiment

Synthetic eight-card fixture, identical content/images, ABBA order, eight samples per theme/variant. This measures **background revalidation**, not switching feeds. Separate instrumented and ordinary timing runs avoid attributing probe overhead to navigation.

| Chromium background refresh | Before median / p75 / p95 / max | After median / p75 / p95 / max |
|---|---:|---:|
| Classic | 107.5 / 146.6 / 175.8 / 175.8 | 32.1 / 59.1 / 97.4 / 97.4 |
| Glass | 372.9 / 378.5 / 402.9 / 402.9 | 114.6 / 166.7 / 318.4 / 318.4 |

All baseline refreshes retained 0/8 DOM cards; all fixed refreshes retained 8/8. Separate changed-title/image runs passed fresh-field assertions and retained all card geometry.

| Median diagnostic work | Classic before → after | Glass before → after |
|---|---:|---:|
| Layout events | 2 → 1 | 35.5 → 1 |
| Style recalculations | 7 → 1 | 83.5 → 1 |
| Layout duration | 12.15 → 0.44 | 51.23 → 0.41 |
| Style duration | 12.56 → 9.80 | 211.53 → 23.49 |
| Script duration | 117.68 → 16.63 | 180.24 → 22.72 |
| Task duration | 163.93 → 35.36 | 470.36 → 63.54 |

Settled desktop Glass screenshots are pixel-identical. Classic card areas are identical; 120 channel bytes differed in the top navigation area in the settled comparison. Early baseline captures showed temporarily blank remounted lazy images, so final visual comparison waited for visible images to decode and become focus-ready. Saved [desktop before](performance-2026-10-14/desktop-glass-before.png), [desktop after](performance-2026-10-14/desktop-glass-after.png), [mobile before](performance-2026-10-14/mobile-glass-before.png), [mobile after](performance-2026-10-14/mobile-glass-after.png).

## 7–8. Actual feed and Smart Top navigation

Current live Chromium, desktop 1440×900, 40 cards, four samples per mode/theme. GET requests were not intercepted. API mutations from the diagnostic browser were blocked. Smart/background work remained enabled. These are current observations; there is no comparable pre-change live sample that supports an end-to-end improvement claim.

| Mode | Median / p75 / p95 / max to stable content | Median server origin | Median state assignment → stable |
|---|---:|---:|---:|
| Classic feed | 1,940.8 / 2,338.0 / 2,419.9 / 2,419.9 | 56.2 | 932.4 |
| Classic Smart Top | 4,804.1 / 4,833.5 / 5,254.9 / 5,254.9 | 186.4 | 1,326.3 |
| Glass feed | 8,434.7 / 9,866.2 / 11,255.8 / 11,255.8 | 66.3 | 4,178.6 |
| Glass Smart Top | 6,723.0 / 6,784.3 / 11,324.1 / 11,324.1 | 202.2 | 2,995.5 |

Median request-created → JavaScript fetch continuation was 764.8 / 3,240.2 / 4,580.6 / 3,547.2 respectively. These intervals include delayed browser task execution and must not be called server latency. The large gap from actual network/server timing, plus the post-assignment delay, identifies substantial browser-side work still to explain. JSON parse medians were 34.0–60.1. All samples produced 40 cards without reported errors. [Scalar summary](performance-2026-10-14/navigation-summary.json).

## 9. Cached article critical path

Live unsampled Chromium runs, 16 per theme, valid cached content in every sample:

| Theme | Readable-frame median / p75 / p95 / max | Open-method median / p75 / p95 / max |
|---|---:|---:|
| Classic | 558.7 / 773.3 / 1,222.1 / 1,222.1 | 105.5 / 128.1 / 240.2 / 240.2 |
| Glass | 430.5 / 658.5 / 1,220.4 / 1,220.4 | 72.2 / 90.7 / 160.1 / 160.1 |

All samples retained feed card nodes. Six Classic and three Glass article-content requests came from the preserved background VOZ freshness path (`checkVozNewPostsInBackground → fetchThreadPage`), not a foreground fetch required to show cached content. No `saveState` occurred before the measured checkpoint.

Median synchronous Classic/Glass stages: overlay application 16.3/12.3; source-time markup 6.5/3.8; speech preparation 7.7/3.6; recently-read recording 9.1/5.4; route update 12.2/8.9; VOZ position check 0.1/7.4; Twitter hydration 1.9/2.1. Nested stages overlap and cannot be summed. Much of the delay lies between method completion and readable rendering. No new cached-article optimization was shipped; the 400 ms goal remains unmet.

## 10. Observer callbacks

Separate instrumented feed-revalidation probe, confirmed non-Top mode, eight cards:

| Observer | Before callbacks / total cost / rect reads | After callbacks / total cost / rect reads |
|---|---:|---:|
| Mutation | 9 / 127.6 / 64 | 4 / 16.5 / 64 |
| Resize | 1 / 51.5 / 64 | 0 / 0 / 0 |
| Intersection | 2 / 30.8 / 128 | 0 / 0 / 0 |

Total rectangle reads fell 256 → 64. These instrumented costs are diagnostic evidence, not ordinary navigation timings. Remaining mutation measurement work exists.

## 11–12. CPU, event loop, memory and stability

The existing collector was allowed to finish without interruption: 12.294 hours, 1,464 rows, 1,460 complete resource rows, 735 unique resource samples, two actual process generations. Deduplication matters because the endpoint reuses minute samples. Restart detection based only on adjacent collector rows missed the restart across an error row; grouping by actual PID exposed it. [Summary](performance-2026-10-14/collector-summary.json).

For the original PID over 11.991 hours:

| Quantity | Median / p75 / p95 / max |
|---|---:|
| Heap used, MiB | 1,321.7 / 1,914.1 / 2,486.8 / 2,696.5 |
| RSS, MiB | 3,000.9 / 3,385.3 / 3,876.9 / 4,076.5 |
| External, MiB | 432.6 / 489.6 / 556.8 / 652.6 |
| Array buffers, MiB | 320.6 / 327.0 / 366.1 / 413.6 |
| Process CPU, percent | 12 / 29 / 65 / 143 |
| Interval event-loop p95, ms | 21.45 / 22.09 / 53.97 / 244.45 |
| Interval maximum stall, ms | 1,791.49 / 4,024.43 / 6,232.74 / 18,136.17 |
| Service-cgroup swap, MiB | 1,120.2 / 1,344.5 / 1,590.8 / 1,713.6 |

At **14 October 01:07:41 Vietnam time** (13 October 18:07:41 UTC), natural major GC reduced 2,634.3 → 2,609.9 MB, with about 1,933 ms mark-compact time plus incremental work, followed by fatal heap allocation failure. Systemd automatically restarted the reader; `NRestarts=1`. No manual restart, live heap snapshot, forced production GC, or heap-limit change was used.

Eight deduplicated idle-candidate samples showed rising heap bands around 1,494–1,639, then 2,168–2,251, then 2,378–2,394 MiB. Missing RSS-job activity prevents calling these fully quiescent retained-heap samples. Seven Smart completion markers also overlapped other work. The specific remaining retaining owner is **not proven**. Previously repaired owners must not be blamed again without new evidence. External/buffer memory is reported separately and does not itself explain the retained JavaScript heap.

Final health check after roughly 9h22 uptime on the replacement PID reported RSS 3,217.3 MB and heap 1,886.5 MB. Health success is availability evidence, not memory stability. Shared host/browser contention remains a measurement limitation; unrelated processes were not changed.

## 13. Disk attribution

Original-PID `/proc` physical write counter rose **48.701 GiB over 11.991 hours, 4.061 GiB/hour**. This is not a matched before/after result and is not wholly source-attributed; process accounting can include reaped children. The replacement segment was only about 17 minutes and cannot establish durable improvement.

A separate 60-second file-revision watcher observed a 112,695,556-byte database snapshot, a 40,371,078-byte ledger revision, and three fetch-statistics revisions totaling 1,406,433 bytes. File sizes are not physical write measurements. No embedding-manifest rewrite occurred in that sample; its absence does not prove elimination.

A bounded 45-second payload-suppressed syscall trace on the reader and its threads/new descendants attributed successful file writes as follows:

| Destination | Bytes | File revisions/files |
|---|---:|---:|
| Article cache | 2,258,033 | 20 |
| User preferences | 2,101,011 | 6 |
| Fetch strategy statistics | 1,880,616 | 4 |
| Cache members | 617,288 | 2 |
| Recently read | 139,497 | 1 |
| Read states | 61,121 | 1 |

These are syscall bytes, not storage-device bytes, and pre-existing child processes were not comprehensively traced. The short trace does not explain the twelve-hour total. It identifies repeated approximately 350 KB preference and 470 KB statistics writes for subsequent caller attribution. `src/articles/fetch-policy.js` persists the latter; multiple Board/settings callers persist preferences, so this trace alone cannot select a culpable caller. No persistence policy was changed without recovery/semantics evidence. [Trace summary](performance-2026-10-14/write-summary.json).

## 14–17. Chromium, WebKit and regression validation

Chromium covered both themes, live feed/Top navigation, cached articles, card identity, fresh text/images, geometry, settled visual comparisons and observer/style/layout probes.

Linux WebKit used installed WebKit 2311 with an iPhone 13 viewport/user agent. This is **not physical iPhone/iOS Safari validation**. Both themes passed feed/Top, first and cached article, ten open/back cycles, long scrolling, delayed API, deliberate offline failure and recovery. No JavaScript errors; DOM count remained 2,006 across the checked loop. Expected offline request failures were not suppressed.

WebKit live Classic first-feed/Top/next-feed: 1,294 / 1,071 / 994. Cached article, nine samples: median 1,393, p75 1,476, p95/max 1,928. Glass first feed/Top: 4,947 / 8,287; cached median 2,116, p75 2,317, p95/max 3,498. Responsive behavior passes; numeric latency goals do not.

WebKit matched eight-card revalidation, eight samples per variant/theme:

| Theme | Before median / p75 / p95 / max | After median / p75 / p95 / max |
|---|---:|---:|
| Classic | 1,002.5 / 1,090 / 1,797 / 1,797 | 592 / 676 / 1,548 / 1,548 |
| Glass | 4,489.5 / 6,995 / 11,027 / 11,027 | 2,249.5 / 2,510 / 3,757 / 3,757 |

All fresh-field assertions passed, DOM reuse rose 0/8 → 8/8, card geometry remained identical, and final before/after screenshots for both themes were pixel-identical. Pending offscreen decode differed in some early Classic snapshots; final visual comparisons waited for readiness.

Host focused tests: **30 passed**. Full host `npm test`: **777 passed, 0 failed, 0 skipped**, 223.757 seconds. Syntax checks passed for the request module and changed diagnostic modules. Full suite ran after the production logic change; subsequent app edit was only the script cachebuster. Sandbox file-level test counts were not substituted for host case counts. Persistence was not modified; no new persistence recovery claim is made.

## 18. Activation and rollback

The live UI asset assembler reads changed modules without a backend restart. Final HTTP checks confirmed `/health` success, the new script version in served HTML, and `Object.assign(existing, refreshed)` in served JavaScript. Service was active/running, PID 2776321, restart count 1 from the OOM. Existing open tabs need reload to receive the new code.

Rollback only the matched-object update to `{ ...existing, ...refreshed }` and revert the script version from `20261014_revalidation_1` to `20261004_pagination_1`. Do not restore whole files over unrelated work. Original copies and raw evidence are under `/tmp/rss-observer-20261013/`; temporary evidence is not guaranteed durable. Scalar summaries and four comparison images are saved beside this report.

## 19–20. Remaining acceptance and next targets

1. **Memory first:** identify retained ownership in a representative isolated process with natural-GC checkpoints and explicit job completion/overlap. The live OOM proves failure; snapshots or GC on production are not warranted by the current authorization. Distinguish JavaScript retainers, buffer backing stores, subprocesses and cgroup swap.
2. **Browser scheduling/rendering:** trace the long gap between network completion and fetch continuation, then state assignment and stable cards, with fixed content and matched background state. Preserve exact Glass appearance and image focus. The revalidation fix does not solve full navigation.
3. **Cached article paint:** profile post-method rendering/overlay work; synchronous formatting alone cannot explain the measured delay. Preserve background VOZ freshness and all readable cached content.
4. **Persistence attribution:** capture representative refresh phases with concurrent physical counters, tracing relevant child writers separately. Identify preference-write callers and compare content revisions before changing batching or durability. Quantify database/ledger/manifest/provider-history shares before claiming total reduction.
5. **CPU and mobile:** compare equivalent idle and active-refresh workloads without disabling features; obtain actual iOS device evidence when available. Linux WebKit remains useful but insufficient for device-specific assurance.

No claim is made that the overall optimization request is complete, that memory is stable, that physical writes decreased, or that the 300 ms feed / 400 ms article goals were achieved.
