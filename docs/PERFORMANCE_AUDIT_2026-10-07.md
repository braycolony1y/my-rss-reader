# Second performance and bug audit — 6–7 October 2026

## Status and evidence boundaries

The audit found and fixed duplicate speculative work, an undefined ingestion callback, repeated corpus cloning, equivalent-request extraction overlap, unnecessary image/layout work, and unnecessary hidden card rendering. Changes are modular. Existing unrelated working-tree changes were preserved; this checkout already contained hundreds of changes, so a repository-wide diff is not an audit-only patch.

**The original success condition is not yet met.** An actual V8 out-of-memory crash occurred on 6 October at 18:52 UTC. The replacement process subsequently retained 2.47 GB of main-thread heap after nearly seven hours and one diagnostic garbage collection. Its dominant retaining owner remains unidentified. Restart-related memory reductions must not be credited to these fixes. Real iPhone/WebKit, production-edge transport, and a controlled cold-extraction comparison are also outstanding.

Evidence is in `/tmp/rss-audit-20261006/`; reproducible drivers are in `tools/experiments/performance-audit/`. Temporary captures include user article metadata and are not committed to this report. Timing values below are observations, not guarantees.

## Bugs found and fixes

| Priority | Root cause and symptom | Change and proof |
|---|---|---|
| P0, unresolved | Main Node process exhausted its roughly 3 GB V8 heap; long GC pauses and swap preceded the crash. The restarted process grew again over hours. | Preserved crash context, CPU/allocation profiles and live memory samples. A single diagnostic collection reduced heap only from 2.572 to 2.468 GB (decimal), taking 7 seconds. No periodic forced GC or arbitrary heap-limit change introduced. |
| P1 | OpenCLI ingestion called `fetchParsedP3`, which was undefined. Background article preparation failed rather than following the configured source strategy. | Wire that callback through the existing P3 lane and configured extractor. Regression test checks invocation and lane. |
| P1 | Prefetch requests incremented the foreground-reader count and could initiate another next-five prefetch pass. This misclassified speculation as interactive work. | Foreground accounting now follows the existing request classifier. Next-five expansion only starts in P0; tests prove speculative lanes neither claim foreground priority nor scan the article corpus. |
| P1 | Concurrent equivalent article API requests could independently enter full extraction. | In-flight response sharing around the existing article handler; eight equivalent requests invoke one handler. Request policy, page, resume and prefetch distinctions remain in the key. Explicit refresh/reject/strategy requests bypass sharing. Failures release the entry. This does not merge every background pipeline or the separate Board Cache handler. |
| P1/P2 | Switching feeds left queued and delayed speculative work from the old feed. Active prefetch could also be enqueued again. | Drop obsolete queued work, check navigation generation before delayed prefetch, and skip the currently prefetched URL. Already-running work may finish to populate cache; no unsafe shared extraction cancellation. |
| P2 | Board membership reconciliation cloned both article corpora even when every member already had metadata. | Lazy shared reads only when a new member needs hydration; clone just that member's metadata. Regression test proves zero corpus reads for unchanged membership and metadata isolation for new members. |
| P2 | Image focus observed style writes made by the image routines themselves and repeatedly scanned inserted subtrees. Hero eligibility forced layout before cheap mode checks. | A mutation classifier ignores owned photo styles, coalesces subtree scans and preserves source/layout/content triggers. Cheap hero eligibility checks precede width measurement. |
| P2 | Hidden Smart panels were mounted/reactive in ordinary feed cards. | Extract the panel into a partial and instantiate it under its existing visibility condition. Visible geometry and headlines match before/after across desktop/mobile, both themes, normal feeds and Top. No list virtualization or article removal. |
| P2 | A new date formatter was constructed for each presentation call. | Reuse the same Vietnam-time formatter. Formatting semantics remain unchanged. |
| P2 | Large list JSON was sent uncompressed by Node. | Asynchronous gzip for negotiated `/api/data` JSON above 16 KiB, including pre-serialized Smart responses. Honors disabled gzip, existing encodings and `no-transform`; no new dynamic-response caching. Tests cover negotiation and both response paths. |
| P2 | Clustering request listeners lacked complete terminal cleanup for worker exit/error/post failure. | A dedicated worker-request module settles and removes listeners on all terminal paths. This is failure-path hardening, not proof of the live OOM cause; the existing worker owner also handles fatal worker failure. |

## Measured bottlenecks

**CPU and responsiveness.** A 45-second server sample was predominantly idle but included expensive forum parsing, snapshot writing and Board Cache work. The client profile across three feed switches attributed about 1,052 ms to hero measurement, 1,035 ms to GC, 235 ms to image mutation handling, 191 ms to local-storage writes, and roughly 290 ms to date formatting. These observations motivated the frontend changes. Existing Smart filtering and snapshot construction remain substantial: approximately 194–222 ms and 85–209 ms respectively in the initial warm samples.

**RAM and swap.** Baseline Node RSS was roughly 3.6 GiB, with about 2.38 GB heap as displayed by health; the service cgroup held about 600 MiB swap. Before the crash, heap approached its limit, service swap rose to roughly 1.3 GB, and the longest recorded event-loop delay reached 26.7 seconds. A two-minute allocation sample on the replacement process decreased rather than grew; that short observation was insufficient, as the seven-hour check demonstrated. Parsed JSON caching is bounded by a 192 MiB source-size estimate, which is not a true retained-object size limit. Smart presentation views and previous generations can retain additional graphs. The article client cache is count-bounded (60), not byte-bounded; large forum articles remain a mobile-memory concern.

**Disk.** The original process had written about 34.7 GB over 3.5 hours. This is a cumulative counter, not an idle I/O rate. Main and Smart snapshots were approximately 116 MB and 203 MB. Major components included published stories, clusters, Top state and the permanent cache-identity ledger. Rewriting and parsing large snapshots remains expensive. The ledger preserves dismissal/identity behavior and was not truncated. Article metadata lookup can still read a complete cache file; cache initialization also deserves a separate concurrency review.

**Network.** The captured normal list was 501,758 bytes; much of it was shared preferences/read history rather than article bodies. Gzip level 4 produced 117,728 bytes: **76.5% smaller for the exact same content**. This proves origin transfer reduction, not an additional 76.5% improvement behind an edge that might already compress. Dynamic state and source coverage were preserved.

**Chromium.** One main RSS service process was found. Article fetching uses existing bounded lane/browser infrastructure; no second browser pool was introduced. The desktop Chrome instance is shared with unrelated tabs and AI browser sessions. Whole-browser process/RSS totals cannot be honestly attributed to the RSS reader. Reader fetch pages and provider sessions must be considered separately; persistent provider tabs are not by themselves proof of a leak.

**Frontend and mobile.** Live baseline initial loads contained 8,355 DOM elements on desktop and 5,404 in mobile emulation. Removing hidden panel instances reduced the fixed eight-card replay from 2,262 to 1,902 elements. The replay uses Chromium at 390px with touch/mobile settings; it is not Safari, WebKit, physical iPhone CPU/memory pressure, or cellular networking.

## Before/after: controlled component replay

Same eight articles, production renderer and components, fixed viewport/theme, five list-refresh samples per case. The before variant reconstructs the modified observer/formatter/hero logic and uses the captured pre-panel HTML. It is a scoped comparison, not a checkout of the original entire working tree. Medians include list request and double-animation-frame rendering. Other host activity remains a source of variance.

| View | Before median | After median | Result |
|---|---:|---:|---|
| Desktop Classic, normal feed | 475 ms | 251 ms | 47% faster |
| Desktop Glass, normal feed | 857 ms | 706 ms | 18% faster |
| Mobile Classic, normal feed | 373 ms | 239 ms | 36% faster |
| Mobile Glass, normal feed | 637 ms | 564 ms | 11% faster |
| Desktop Classic, Top | 264 ms | 388 ms | 47% slower in this run |
| Desktop Glass, Top | 1,699 ms | 1,216 ms | 28% faster |
| Mobile Classic, Top | 404 ms | 304 ms | 25% faster |
| Mobile Glass, Top | 621 ms | 576 ms | 7% faster |

All eight before/after card-geometry/headline comparisons matched exactly. Normal-feed long-task counts decreased in each comparison. Top timing is mixed; a universal Top speedup is not established. Screenshots accompany the raw replay report.

## Live baseline and comparison limitations

Initial local API sample, eight requests per view:

| Metric | Before | After / interpretation |
|---|---:|---|
| Normal feed median API TTFB | 38.2 ms | Post-activation sample recorded separately below |
| Today median API TTFB | 57.2 ms | Same |
| Smart Top median API TTFB | 523.9 ms | Same; first request took about 4.6 seconds total |
| Normal list payload | 501,758 bytes | 117,728 bytes when gzip-compressing the identical captured body |
| Main server count | 1 | Verify again after activation |
| Idle/peak RSS and CPU | Not isolated idle/peak experiments | Do not substitute restart or short samples |
| Event-loop p95 | Not exposed initially | Added beside existing mean/p99/max diagnostics |
| Chromium aggregate RSS | Shared desktop scope | Not equivalent to reader-owned RSS |
| Article extraction duration | Not separated from fetch in initial live test | No before/after claim |

Exploratory live desktop baseline: initial useful content 6,654 ms; six feed switches 1,058–5,692 ms; first forum article 10,404 ms; two client-cached opens 1,048/966 ms; back navigation 264–934 ms; Smart Top 11,587 ms. Mobile emulation: initial 4,812 ms; feed switches 1,818–29,780 ms; first article 9,666 ms; cached opens 389/782 ms; back 321–469 ms; Smart Top 3,227 ms. These sparse samples and changing background work cannot establish reliable p95 UX improvement. The first post-change live run overlapped the full test suite and is classified as a stress run, not a valid speed comparison.

## Critical paths and remaining tradeoffs

Feed navigation enters `setFilter` and the generation-controlled list request. The server filters/pages persisted data, serializes or reuses a Smart response, then the browser parses it and Alpine updates cards. Warm normal API latency was small compared with multi-second live rendering; optimization therefore addressed both transfer and client work.

Article navigation checks client content, requests the server when necessary, resolves Board Cache or persistent article state, follows the source-specific extraction policy when needed, sanitizes/renders and restores the reader. In-memory reopening was faster than the first server request but still often exceeded the requested 200–400 ms target.

An automatically idle-paused archived forum thread deliberately verifies its first/latest source pages before returning newly captured posts. That network wait is part of an existing tested freshness contract. It was not silently removed. A future stale-while-revalidate presentation would need an explicit update path so readers receive newly verified posts rather than indefinitely seeing the old page.

Client abort/generation guards protect newer navigation. In-flight shared or cache-useful extraction is allowed to finish. Coalescing an HTTP handler does not yet provide one universal lease across every background ingestion and foreground pipeline. Existing transport sharing and lane limits remain authoritative.

## Scheduling and configuration

| Work | Existing behavior / audit decision |
|---|---|
| RSS refresh | Sequential loop, approximately ten-minute start-to-start cadence with cooldown on long cycles; preserve source coverage. |
| Smart refresh | Existing coalesced refresh and worker/AI schedulers; preserve ranking, progressive publication and AI quality. Long provider waits remain a concern. |
| Board archive scan | Minute cron with existing active-run guard and bounded thread work. Idle reactivation is event-triggered and throttled. |
| Universal prefetch | Startup delay and thirty-minute timer, existing active-run guard; article-next speculation is separately lane-gated. |
| Article cleanup | Startup and hourly interval; full production worst-case duration not measured. |
| Startup | Existing phased delays for Smart engine, source loop and prefetch retained. |

Keep the observed Node heap setting (3,072 MiB) pending retained-heap diagnosis; neither raising it nor lowering it is an evidence-backed repair. Preserve observed browser budget 2 and foreground article budget 4. Do not increase network/Smart concurrency under the measured swap and heap pressure. Preserve current cache limits and scheduler intervals until task-duration and byte-retention measurements justify a specific adjustment. No arbitrary tuning was applied.

## Changed modules

- `src/articles/request-flight.js`: equivalent in-flight API response sharing.
- `src/articles/request-priority.js`: idempotent foreground accounting using existing lane classification.
- `src/routes/article-routes.js`: minimal integration of those modules.
- `src/feeds/next-articles-prefetch.js`: extracted next-five implementation and P0-only expansion.
- `src/feeds/prefetch.js`: module wiring and missing P3 extraction callback repair.
- `src/board/membership.js`: extracted membership reconciliation with lazy corpus hydration.
- `src/board/cache-service.js`: membership factory wiring.
- `src/middleware/json-compression.js`, `src/http.js`: negotiated list compression and route wiring.
- `src/smart/clustering/worker-request.js`, `src/smart/clustering/execute.js`: terminal-safe worker request and integration.
- `src/observability/resource-monitor.js`: event-loop p50/p95 alongside existing diagnostics.
- `public/image-focus-mutations.js`, `public/image-focus.js`: mutation classification and observer integration.
- `public/top-story-card/hero-extent.js`: cheap eligibility checks before layout reads.
- `public/js/article/presentation.js`: formatter reuse.
- `public/js/article/prefetch.js`, `public/js/feeds/requests.js`: stale queue/generation and duplicate-active-prefetch safeguards.
- `public/components/article/card-panel.html`: extracted conditional panel component.
- `public/components/article-card.html`, `src/ui/reader-partials.js`: conditional inclusion and allowlist wiring.
- `public/styles.css`, `index.html`: required CSS build and stylesheet version update.
- `test/performance-audit.test.js`: concurrent requests, priority, prefetch, membership, compression, worker terminal paths and ingestion regression cases.
- `test/image-focus-mutations.test.js`: meaningful observer triggers and subtree deduplication.
- `test/helpers/server-source.js`: include extracted prefetch source in compatibility checks.
- `tools/experiments/performance-audit/`: API, live browser, client CPU, component replay, allocation/resource and one-off GC diagnostic drivers.
- This report records audit-only changes; it does not claim ownership of the many pre-existing modifications.

## Validation matrix

| Area | Evidence / limit |
|---|---|
| Backend regression | Full suite passed 734/734 before final panel extraction; final rerun recorded below. Initial sandbox socket failures passed when rerun with local networking available. |
| Normal/Top visual preservation | Eight paired desktop/mobile/theme cases, identical card bounds and headlines. |
| Desktop navigation | Live Chromium initial/feed/forum article/cache/back/Top flows; no page errors in the initial captures. |
| Mobile navigation | Same flows under Chromium mobile emulation; no real iPhone claim. |
| Extraction correctness | Existing full-suite VOZ page identity, source policy, deletion/retention and source parser tests. No controlled new live uncached TechRadar before/after measurement. |
| Busy-server responsiveness | Observed during production background work and a separate test-suite stress run; no matched-load causal speedup established. |
| Slow/intermittent network | Not completed; gzip payload reduction is measured, cellular interaction is not. |
| Long stability | A real crash and subsequent seven-hour retained-heap growth were observed. Short decreasing samples do not clear the issue. |
| Production transport | Origin measured; public Cloudflare/TLS/edge behavior not independently profiled. |

## Activation and final observations

Backend changes were activated at approximately 01:54 UTC on 7 October; new PID 3029999 reported active/running and `/health` returned OK. The restart closed the diagnostic inspector. Final service verification and resource data accompany the captures.

The final full-suite rerun had **729 passes and one failed test file** after the existing `antigravity.test.js` hung and its child process was terminated. Its isolated rerun also hit a 35-second timeout. The earlier run passed **734/734**. The mock test matches concurrent callbacks by arrival order and waits without a test timeout; the exact provider/test interaction remains unresolved. Neither that earlier success nor the focused successes imply a clean final suite. Server and feed-worker syntax checks passed separately; CSS rebuilt successfully. Repository-wide whitespace checking reports existing issues in unrelated source modules and `summary-engine.js`.

Post-restart API results (eight samples): normal-feed TTFB median **51.7 ms**, p75 **59.8 ms**, p95 **87.5 ms**; Today **77.8/110.5/506.9 ms**; Smart Top **563.8/603.7/4,590.5 ms**. These are slower medians than the initial sample, with changed data and startup/background load; no API latency improvement is claimed. Gzip was verified on the live normal and Smart responses. The benchmark's byte field is decoded JSON size, not compressed wire size.

The serial live browser run exposed continuing performance failures:

| Action | Desktop after | Mobile emulation after |
|---|---:|---:|
| Initial useful content | 8,166 ms | 3,679 ms |
| Initial card count / DOM elements | 40 / 6,433 | 15 / 4,749 |
| Feed switches, six samples | 3,041–22,819 ms | 714–3,782 ms |
| First forum article in this run | 1,621 ms | 544 ms |
| Client-cached reopens, two samples | 1,509 / 1,353 ms | 619 / 724 ms |
| Back navigation, three samples | 120–2,389 ms | 107–436 ms |
| Smart Top | 11,914 ms, 40 cards | **30,068 ms, zero cards: timeout/failure** |

No JavaScript page errors were recorded, but that does **not** turn the zero-card timeout into a pass. The first article was already locally available, so it is not an uncached-extraction benchmark. The desktop waterfall included 70 thumbnail endpoint requests, some lasting over a minute, and list request wait times up to 18 seconds. Local HTTP/1 connection waiting and server processing were not separated in this capture; production-edge behavior may differ. Thumbnail contention, busy-server feed latency and the mobile Smart timeout remain open P1 findings. The final run is more useful as evidence of these failures than as proof of overall acceleration.

An additional isolated mobile fixture check passed at **4x CPU slowdown, 150 ms latency, 1.5 Mbps download**: three rapid feed selections settled on the final feed with all eight cards (1,427 ms), article content became readable (662 ms), and a simulated 503 exited loading with a visible error. It produced no page errors. The error text remained generic (`Failed to load article content.`), so the requested distinction among network, timeout, extraction and backend errors is not fully delivered.

**Remaining acceptance blockers:** retained-heap/OOM root cause; busy-server/thumbnail contention and mobile Smart timeout; reproducible final AI-provider test hang; physical iPhone/WebKit and production-edge validation; controlled cold-extraction and longer post-fix stability proof. The safe fixes are active, but this is an incomplete outcome against the original comprehensive success condition.

## Post-activation resource observation

31 samples over 312 seconds, during startup, background processing and browser checks; not an idle benchmark. One service PID throughout.

| Metric | Observed |
|---|---|
| Node RSS | 1928–3091 MiB; final 2120 MiB |
| Main heap used | 944–2084 MiB |
| CPU, available monitor windows | 4–86% of one core |
| Process swap | 0 throughout |
| Event-loop p95 by monitor window | 22.0–178.7 ms |
| Process disk reads / writes | 12.6 MiB / 2514.5 MiB |
| Shared desktop Chromium | 25–31 processes; 3062–4382 MiB aggregate RSS |
| Host load at start / end | 2.54 / 4.92 (one minute) |

The short window recovered memory after bursts but still wrote gigabytes and showed substantial event-loop delay under load. These observations do not establish lower steady-state CPU, reduced sustained I/O, or leak freedom. Host network counters were captured, but they include unrelated shared-host traffic and are not an application-specific bandwidth measurement.
