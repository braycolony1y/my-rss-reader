# RSS reader CPU and RAM optimization — 6 October 2026

The safe P0/P1 changes are implemented and running in `rss-reader.service`. All 723 tests pass. The Node heap limit remains 3072 MB. Source coverage, providers, persistent state and existing publication behavior are preserved.

The initial live server used about 3,845–4,003 MiB RSS in the profiling window. After activation, the quiet profiling window used 2,230–2,269 MiB. After warming the live list APIs and another feed cycle, RSS was about 2,626 MiB, with 1,336 MiB main-isolate heap used. Ranking/clustering bursts reached approximately 3 GiB. This is a shorter observation than the baseline process lifetime, not proof of long-term stability.

## A. Process findings

| Process | PID / PPID | Owner | Start, Saigon time | Launcher / relationship |
|---|---|---|---|---|
| Baseline RSS server | 1946323 / 1 | ubuntu | Oct 6, 07:24:05 | systemd `rss-reader.service`; port 3000 |
| Baseline OpenCLI daemon | 1946436 / 1946323 | ubuntu | Oct 6, 07:24:16 | Intentional RSS child in the service cgroup; about 74 MiB |
| Shared desktop Chromium | 3458817 / 41353 | ubuntu | Sep 24, 19:21:48 | LXQt desktop session; outside the RSS service cgroup |
| Orphan headless Chromium | 3080053 / 1 | ubuntu | Oct 3, 01:36:37 | Desktop Chromium scope; two targets: local card demo and blank page |
| First activated RSS server | 2008312 / 1 | ubuntu | Oct 6, 08:42:08 | Same systemd service; port 3000; zero restarts during observation |

Only one RSS server instance was found. A thread listing showed the main thread, V8 workers, libuv workers, Node workers and libvips workers all sharing PID 1946323 and the same RSS. Identical memory figures on multiple htop rows must not be summed. The screenshot's historical PIDs were not provided, so those historical rows cannot be proven to be threads solely from the screenshot.

Systemd already uses `KillMode=control-group`, a 20-second stop timeout, a 120-second watchdog and restart protection. The database writer lock already rejects a second live database owner. No duplicate lock or broad process-kill mechanism was added. Journals showed two earlier watchdog terminations; their exact blocking stacks were not captured. No surviving older RSS server was present.

## B. CPU findings

A live inspector CPU profile and sampled allocation profile were collected without first restarting the baseline process. The profiler was subsequently closed.

| Baseline consumer | Sampled time | Interpretation |
|---|---:|---|
| Garbage collection | 14.0 s | Largest self-time consumer in an approximately 62.5-second profile |
| Article HTML parsing | 9.46 s inclusive | Includes source parsing, sanitation and media normalization |
| VOZ parsing | 8.37 s inclusive | Includes repeated post rendering/sanitation |
| Post sanitation | 5.64 s inclusive | DOMPurify/jsdom processing of post markup |
| Card blend generation | 4.45 s inclusive | Pixel color conversion and gamut mapping allocate heavily |
| Database snapshot writing | 3.28 s inclusive | Encoding and filesystem writes |

Inclusive rows overlap and must not be added. The allocation sample attributed about 1,647 MiB to one `rgbToOklab` call path, about 801 MiB to gamut mapping, and substantial additional allocation to generator iteration, parsing and encoding. These are sampled allocations, including objects later collected, not retained-heap sizes.

Source-policy lookup also repeatedly filtered the complete article array and normalized up to three aliases per article for each lookup.

## C. Memory findings

The baseline main-isolate heap used 1,730–1,946 MiB; its heap total was roughly 1,863–2,064 MiB. External memory varied from 30–125 MiB. Process RSS includes all worker isolates and native allocations, so the difference is not automatically a leak or entirely attributable to one native library. `/proc` showed predominantly private anonymous memory and approximately 98 MiB process swap in one sample; the service cgroup included about 190 MiB swap in another sample.

Important data sizes found on disk:

| Value | Serialized string size | Cardinality |
|---|---:|---:|
| Published Top cards | 71.6 MiB | Publication object containing full cards |
| Smart clusters | 53.8 MiB | 25,703 clusters |
| Top ranking state | 51.2 MiB | 16,781 states |
| Cache identity ledger | 30.5 MiB | Durable user/cache history |
| Editorial assessments | 23.7 MiB | 52,404 assessments |
| Embedding cache file | About 299 MiB | 148,098 vectors at first optimized load |

These are serialized sizes, not estimates of object-graph retained size. Shared parses, pinned reader views and temporary pipeline copies can add substantial heap overhead. A full multi-GB heap snapshot was avoided under the existing memory pressure; exact native ownership and all retainer paths remain unverified.

The old memory-pressure timer cleared shared parsed/presentation caches and forced a full GC about once per minute. Many samples recovered only a few MiB, while later readers rebuilt the discarded graphs. It has been removed from the application and replaced by bounded cache ownership and monitoring.

## D. Chromium findings

The baseline process listing contained 39 Chromium processes across two browser roots. The post-cleanup snapshot contained 26 processes under one shared desktop root, totaling about 3.37 GiB RSS summed across processes. That sum double-counts some shared pages and is not PSS.

The two identified Gemini slots contained about 186 MB and 104 MB JavaScript heap, approximately 1,200 DOM nodes each, and one/zero response elements. That snapshot did not establish a DOM leak. The large desktop renderer's complete ownership was not proven; unrelated desktop tabs were not closed.

The orphan headless browser was closed only after confirming its two targets remained the old local demo and a blank page. Current PDF and browser review tools already use browser cleanup in `finally`.

OpenCLI fetch queues reuse exact origin targets with local 60-second idle cleanup; pinned viewer leases extend useful lifetime. Reader workers also close after 60 seconds idle, with a finite one-hour bridge fallback lease. Gemini defaults to persistent slot reuse. Its explicit/optional cleanup previously called `closeWindow` and dropped the page reference before knowing closure succeeded. Cleanup now closes the owned tab and retains the reference after failure, permitting recovery without losing ownership.

## E. Job overlap audit

| Job | Trigger / frequency | Runtime evidence | Overlap / resources |
|---|---|---|---|
| RSS refresh | Startup, manual, minimum 10-minute loop | Completed three feed cycles during observation | Existing single-flight; bounded feed batches; network/parser/browser work |
| Smart refresh | Startup, manual, 30-minute schedule | Clustering completed; 106-group AI review still active during the earlier observation | Existing running guard; new pending requests coalesce into one next refresh |
| Progressive publication | Inline review updates | Existing large-corpus guard activated at 11,361 candidates | Owned by the Smart run; no separate concurrent generation |
| Background Smart source fetch | Minimum 15-minute loop | Defers while Smart is active | Three-source batches; can race a foreground refresh and discard the fetched batch |
| Top ranking | Initial/load/update, configured 15-minute age interval | Live API load and ranking/list bursts observed | Existing pending/scheduled guard; bounded ranking worker |
| Universal prefetch | Startup, 30-minute timer, post-feed cycle | Sequential cache checks/fetches | Existing running guard |
| OpenCLI source prefetch | Feed/Smart ingestion | Functional tests and live fetch completion | Now bounded to two source producers by default |
| Board scans | Every minute | Repeated VOZ sanitation/cache hits observed | Existing per-thread single-flight and page slots; different thread scans may overlap |
| Idle-thread reactivation | New feed activity | Behavior tests pass | Previously created every probe promise; now two lazy workers by default |
| Article/AI processing | Reads, prefetch, analysis prewarm | Existing provider errors/cooldowns and active local inference | Provider/global scheduler and local-compute mutex retained |
| Cache cleanup | Startup/hourly; PDF expiry lifecycle | Existing protected-state tests pass | Disk retention/protection preserved |
| Source evaluation | Defined monthly scheduler; no active call site found | No completed evaluation profiled | Existing provider scheduler; separate scheduler overlap remains an audit item |

Complete average/maximum runtime distributions were not collected for every job. START/FINISH, durations, approximate RSS/heap deltas and coalesced requests are now logged for Smart refreshes. Existing feed, embedding, prefetch and provider lifecycle logs remain. New 60-second resource logs expose important queue and activity states without forcing collection.

## F. Concurrency findings and changes

Network/feed and Smart source batches were already bounded. The new limits address the unbounded foreground lane and producer fan-out rather than lowering feed coverage:

- Foreground article network work: four active tasks by default on this two-core host.
- Browser fetch transport: two active tasks across origins, preserving existing per-origin navigation isolation and priorities.
- Idle-thread probes and Smart OpenCLI source producers: two workers each; every selected item is processed.
- Existing AI scheduling and the local-compute mutex remain authoritative.

Source-specific BaoMoi redirect enrichment still uses all-item fan-out. It was not a measured active hotspot and remains a P2 follow-up. Browser reader process pools remain per origin; their normal idle cleanup is preserved. Incoming requests can still wait in queues; producer work no longer constructs all heavy payloads at once in the changed paths.

## G. Cache findings and changes

The shared parsed cache now has count, age and estimated source-byte bounds, with generation invalidation and mutable-read cloning preserved. Its byte metric is a source-string proxy, not a precise object-graph size.

The exact post-markup cache owns strings only, with a 16 MiB budget, 1,000-entry ceiling and ten-minute TTL. Changed markup is always independently sanitized. No DOM trees are cached.

The clustering worker now streams historical embedding entries and decodes only keys required for the current corpus. Atomic streaming merges preserve all other historical vectors on disk. Its JS vectors and run graphs are released at completion/error boundaries; the native model worker stays alive. The first real run loaded 10,756 matching vectors out of 148,098 historical entries and generated 36 missing vectors.

Other cache ownership found: focal results are capped at 1,000 memory entries with a 40-job pending bound; story briefings have a 1,600-entry limit; image metadata is capped; presentation views/history have count/generation limits; in-flight maps release completed work; model availability has a TTL. Durable editorial/verification caches, URL history, ledger and ranking state can still grow on disk. Their removal would affect useful history/reuse, so they were not purged. Selective disk access for those histories is a possible follow-up.

## H. Priorities and implementation

| Priority | Change | CPU / RAM effect | Risk / complexity |
|---|---|---|---|
| P0 | Adaptive AI-review guard and service-cap correction | Restores review instead of falsely deferring every remaining group at ordinary heap occupancy; collection only under real pressure | Moderate / moderate |
| P0 | Scratch color buffers and byte-channel lookup | Removes most per-pixel allocation; exact output preserved | Low / moderate |
| P0 | Remove pressure timer clearing/GC; bounded parses | Avoids repeated graph rebuilding and full-heap scans | Moderate / moderate |
| P1 | Stream required embedding vectors and merge updates | Large worker peak-memory reduction; a small CPU tradeoff in the isolated serializer benchmark | Moderate / moderate |
| P1 | Exact repeated post sanitation cache | Avoids repeated DOM work without bypassing sanitation for new/edited input | Low / moderate |
| P1 | Weak generation source-policy index | Avoids repeated whole-array normalization/scanning | Low / low |
| P1 | Bounded foreground/browser/probe/source work | Bounds active expensive work and preserves all selected tasks | Moderate / moderate |
| P1 | Coalesced Smart refreshes | Prevents requested updates being discarded or running concurrently; covers merged categories and forced rebuilds | Moderate / moderate |
| P1 | Exact-tab cleanup and resource metrics | Preserves ownership on errors; exposes queues, memory and responsiveness | Low / moderate |
| P2 | Smaller progressive publications for large corpora | Existing guard still suppresses intermediate views above 6,000 candidates | Requires separate quality/memory validation |
| P2 | Reduce persistent-history access/write amplification | Remaining 30–70 MiB values are useful durable state | Requires preserving durability and cache compatibility |
| P2 | Restore healthy online-provider availability | Reduces reliance on expensive local inference | External provider/account state |

### Controlled comparisons

| Same-input work | Before | After | Validation / tradeoff |
|---|---:|---:|---|
| Image colors/blends, CPU | 1,737 ms | 822 ms | 53% lower; identical output checksum |
| Image colors, sampled allocations | 1,381 MiB | 203 MiB | 85% lower |
| Source policies, 80 lookups over 5,000 records | 566 ms CPU | 22 ms CPU | Identical ordered source results |
| 200 repeated post sanitations | 660 ms CPU | 1.7 ms CPU | Identical safe output; edited/oversized inputs tested separately |
| 12,000-vector history, 875 required keys | 241 MiB peak RSS | 84 MiB peak RSS | All 12,000 durable entries preserved; about 16% more CPU for streaming I/O in this small benchmark |

Wall times were affected by host contention, so CPU time and memory are the primary controlled comparisons. The vector benchmark isolates cache loading/persistence, not model inference.

### Live comparisons and limits

| Metric | Baseline | Optimized observation |
|---|---|---|
| RSS server count | 1 | 1 |
| Main RSS in profile window | 3,845–4,003 MiB | 2,230–2,269 MiB |
| Main heap used in profile | 1,730–1,946 MiB | 969–1,002 MiB |
| Sampled Node CPU | 90.7% of one core | 3.8% during a quiet minute |
| GC sampled time | 14.0 seconds | 0.107 seconds |
| Later warmed Node RSS | About 4 GiB baseline | About 2,626 MiB in the earlier observation; bursts near 3 GiB |
| Later main heap | Baseline above | About 1,336 MiB after warmed list work |
| Event-loop delay | No comparable histogram | Quiet p99 about 25 ms; later p99 about 70 ms; burst maxima above 1 second observed |
| Fetch queues | No complete baseline queue metric | Zero pending article/browser fetch work at latest check |
| Service restarts | Two prior watchdog restarts | Zero since activation |
| Chromium roots / processes | 2 / 39 | 1 / 26 in sampled post-cleanup inventory |
| Host swap | 3,313 MiB | 3,715 MiB in a later busy sample |
| Host load | 10.54 / 7.50 / 4.56 | 10.03 / 9.66 / 7.64 in a later busy sample |

The live CPU windows had different job mixes and are not a controlled 96% whole-application speedup. A later three-second sample caught a real Node burst at 91% CPU and approximately 2,960 MiB RSS. This returned to a quieter 15% one-minute interval; expensive bursts were not eliminated.

Host swap/load did not meet the requested settled targets during this observation. Full-suite runs, the ongoing local-model process (about 2.3 GiB) and shared desktop Chromium remained significant consumers. The service's sampled swap fell to single-digit MiB, but that does not establish a system-wide swap reduction. No swap reset was performed.

Before the final guard correction, two complete refreshes finished, including the coalesced request, and published 25,760 clusters. Their metrics exposed false memory deferrals; completion alone did not mean all AI review had run. A full post-correction verification cycle and multi-hour/day soak remain unverified. The existing progressive large-corpus guard remains; tests verify progressive behavior on supported fixtures, but this real 11,361-candidate run did not publish intermediate snapshots. These are explicit remaining limits, not claimed completed milestones.

## Verification quality correction discovered during the longer run

The second completed refresh deferred **81/81 ambiguous groups** for memory pressure, with no provider attempts. At that boundary the heap was about **1,419 MiB**, RSS about **3,123 MiB**, the V8 limit about 3 GiB and the service high limit 5 GiB. The unit's fixed `SMART_AI_REVIEW_HEAP_DEFER_MB=1400` setting was lower than normal retained corpus occupancy. The old guard also latched a single pressure observation for all remaining groups.

This was corrected in `src/smart/verification/memory-policy.js`, with minimal integration in `src/smart/clustering/review.js`. Review now checks remaining V8 and cgroup capacity using 256/512 MiB reserves. It collects only when a real limit is close, rate-limits collection/reporting, and rechecks each group after capacity recovers. The unused per-ten-group forced collections were removed; progress reporting remains. Deliberate operator hard caps remain supported.

The original loaded review module and original systemd drop-in were backed up. The live drop-in was changed to the reserve settings and reloaded. Existing deferred review data is retained for retry. A second related fix prevents an unchanged-input signature from treating memory-deferred review groups as completed: `src/smart/refresh/reuse-policy.js` delegates that decision from the candidates module, while retaining the algorithm/embedding identity checks for completed work. Provider failures/uncertainty remain explicit, and partitions are not marked verified merely to reduce work. Restoring review can increase legitimate provider CPU work; it is required to preserve editorial quality.

## Validation and settings

`npm test`: **723/723 passed**, including the command's server/feed syntax checks. All 46 changed/new JS modules/tools/tests passed `node --check`. Task-added whitespace checks passed against the pre-task source backups; the broader dirty worktree has unrelated pre-existing whitespace warnings.

The worker probe passed two clustering jobs and two embedding-worker pings with no worker replacement and no online AI calls. The HTTP fixture now isolates its child process from real Gemini Web/local-model services and rejects unexpected localhost provider fetches; production providers remain enabled. New tests cover coalescing/category merging, failure recovery, priority/concurrency bounds, cache eviction/expiry, exact color outputs, sanitation and browser cleanup, and atomic embedding-history preservation.

Live normal, Smart Top and Smart Classic APIs returned HTTP 200 with 40 articles. Top and Classic retained reader tokens. The cold requests took about 0.7, 8.0 and 5.9 seconds while other work was active; these are functional checks, not latency improvement claims. Three feed cycles completed with 49 feeds during the activated observation. Health remained OK, and the temporary inspector was closed.

Recommended settings on this two-core host are below. The review reserves were installed in the service drop-in, replacing its stale hard cap:

```dotenv
RSS_FOREGROUND_FETCH_CONCURRENCY=4
RSS_BROWSER_FETCH_CONCURRENCY=2
RSS_IDLE_CHECK_CONCURRENCY=2
RSS_SOURCE_PREFETCH_CONCURRENCY=2
RSS_PARSED_CACHE_MAX_MB=192
RSS_POST_MARKUP_CACHE_MB=16
RSS_RESOURCE_INTERVAL_MS=60000
SMART_AI_REVIEW_HEAP_RESERVE_MB=256
SMART_AI_REVIEW_MEMORY_RESERVE_MB=512
```

Leave `SMART_AI_REVIEW_HEAP_DEFER_MB` unset for the adaptive policy. An intentionally configured hard cap is still honored.

Keep `--max-old-space-size=3072` unchanged. Lowering it would not control external browsers/native memory and is unnecessary before a full-run/longer soak validates the new working set. Existing bounded worker heaps and last-valid-publication recovery remain in place. The frequent pressure GC timer is gone; existing lifecycle/headroom collection points remain.

Use authenticated `/api/resources` and `[RESOURCES]` service logs to follow RSS, heap, external/ArrayBuffers, CPU, event-loop delay, jobs, queues, browser references and cache counts. The maintained `tools/experiments/profile-running-server.mjs` records local inspector CPU/allocation profiles; `benchmark-image-colors.mjs` repeats the deterministic color workload.

## Files changed

The complete task inventory is in [changed-files.json](/home/ubuntu/my-rss-reader/docs/resource-optimization-2026-10-06/changed-files.json). Principal implementation ownership:

| Modules | Purpose / integration |
|---|---|
| `public/card-blend/color-conversion.js`, `color.js`, `public/liquid-tint.js`, `src/images/card-blend/melt.js` | Shared exact color arithmetic with reusable outputs |
| `src/database/parsed-cache.js`, `store.js` | Bounded canonical shared parses; disk format and cloning contracts preserved |
| `src/cache/string-cache.js`, `src/articles/post-markup-sanitizer.js`, `voz-post-renderer.js` | Bounded exact-input sanitation reuse |
| `src/articles/source-policy-index.js`, `fetch-policy.js` | Weakly owned article-source aliases |
| `src/runtime/concurrency-limiter.js`, `src/articles/fetch-lanes.js`, `src/browser/work-budget.js` | Resource-derived configurable active-work budgets |
| `src/board/idle-reactivation.js`, `src/smart/sources/prefetch.js`, `fetch.js` | Lazy bounded producers |
| `src/smart/embeddings/disk-cache.js`, `src/smart/clustering/worker-runner.js`, `smart-cluster-worker.js` | Selective vector loading, streaming atomic persistence and per-job cleanup; worker entry point is wiring only |
| `src/smart/verification/memory-policy.js`, `src/smart/clustering/review.js`, `src/smart/refresh/reuse-policy.js`, `candidates.js`, `ops/systemd/rss-reader.service.d/ai-review-memory.conf` | Real-capacity review guard, recovery after pressure and removal of the stale service cap |
| `src/runtime/coalesced-job.js`, `src/smart/refresh/coalescing.js`, `run.js` | One active refresh plus one merged next request |
| `src/browser/slot-lifecycle.js`, `resource-state.js`, `src/opencli-reader.js`, `src/ai/gemini-web.js` | Exact-tab cleanup, preserved failure ownership, transport budgeting and resource getters |
| `src/observability/resource-monitor.js`, `memory-budget.js`, `src/app.js`, `src/routes/diagnostic-routes.js` | Monitoring/integration; removes the old pressure maintenance loop |
| Five new test modules, golden fixture, completion-wait helper and the existing Top snapshot test | Behavior/compatibility regression coverage; replaces an overloaded-host five-second race with a bounded observed-completion check |
| Two diagnostic tools | Repeatable profiling and color comparison |

Large legacy files received imports, delegating calls and resource getters. Only the touched worker/sanitation/slot logic was moved; unrelated legacy implementation was left in place. All persistent keys and public list/reader APIs remain compatible. Historical vectors were preserved rather than evicted.

Source and pre-activation data backups are retained in `/tmp/rss-optimization-backup`. Measurements, raw profiles, the passing full-suite log and worker-probe log are alongside this report. No repository-wide commit, database purge or broad process kill was performed.

Final activation: PID **2073922**, active/running with zero restarts. Health is OK, 49 feeds are present and the stale heap cap is absent. Its 70-second startup sample was 1,417 MiB RSS / 943 MiB heap; this startup sample is not the mature-memory comparison. The last corrected verification run was observed making successful Gemini Web verification requests, with local fallback for uncertain results. The final retry-policy deployment is healthy; its complete AI-review cycle remains pending.
