# Smart Top Stories refresh: implementation and measurements

Scope: Smart → Top stories only. The ranking policy, dynamic Top/More cutoff, original headlines, and website localization are unchanged. Classic keeps its prior request and rendering behavior.

## What blocked the first render

Measurements were added before changing the performance path. On the stored dataset (8,460 cluster records and 1,735 raw articles), the original request took **2,592 ms** with an uninitialized ranking index and **191–212 ms** on subsequent requests using an in-memory database fixture. These were real articles, with online AI and publisher requests replaced by offline stubs.

The request built the Classic-style hotness/candidate view even for Top Stories, then collected candidates again for the Top index. A missing in-memory rank cache required reconciliation, relevance/evidence/signal computation, sorting, cutoff calculation, and an awaited editorial-state write. The cache expired at minute boundaries and did not survive process restart. Filtering still scanned the selected feed on every request. The request also queued visible/look-ahead briefings before responding, although it did not await completion of online generation.

The initial measured costs were 506 ms for candidate/view construction, 1,879 ms for the ranking path, and 168 ms for filtering. The later disk-backed comparison below additionally measured the awaited persistence cost.

## Disk-backed comparison

This isolated comparison copied the existing database files into a temporary directory and used the real database store. The original request path was replayed with instrumentation. The new path was seeded with a completed publication of the same ranked dataset. **Every response contained 40 cards.** Provisional live clustering state was not promoted into production. No live data files were written, and no real AI calls were made.

| Phase, milliseconds | Before, cold database/index | After, cold database | After, warm refresh |
|---|---:|---:|---:|
| Request received marker | 0.155 | 0.018 | 0.009 |
| Persisted Smart data and user metadata read | 1,672.981 | 2,136.279 | 2.498 |
| Candidate collection / feed selection | 442.382 | 4.337 | 2.017 |
| Existing editorial state read | 376.331 | 0 | 0 |
| Cluster reconciliation | 415.604 | 0 | 0 |
| Relevance computation | 222.124 | 0 | 0 |
| Signal computation | 432.588 | 0 | 0 |
| Coverage attachment and sorting/ranking | 179.933 | 0 | 0 |
| Top cutoff | 44.532 | 0 | 0 |
| Rank persistence | 1,979.520 | 0 | 0 |
| Entire ranking path (includes subphases above) | 3,731.362 | 0.040 | 0.012 |
| Filtering | 204.534 | 211.321 | 0.959 |
| Reading snapshot construction | 4.456 | 1.076 | 1.034 |
| Card preparation / cached briefing lookup | 50.024 | 9.642 | 4.082 |
| Serialization | 8.178 | 5.104 | 5.063 |
| Response handed to transport | 0.130 | 0.319 | 0.040 |
| **Whole request** | **6,116.248** | **2,371.021** | **15.881** |

The original warm request in this comparison took **224.319 ms**, versus **15.881 ms** after the change. Timings are individual local observations, not production latency guarantees. Ranking subphases overlap the “entire ranking path” total and must not be added to it again.

Cold database startup remains a limitation: the shared database loader reads, validates, and repairs the existing files. The durable display snapshot also adds bytes to load. This is distinct from ranking/reconciliation, which is absent from the persisted-snapshot request. Normal requests against an initialized service do not repeat that full database load. No shared database startup behavior was changed for Classic.

## Browser measurements

A separate final headless-Chromium run used the real app shell and Alpine rendering with the same 40-card dataset. The browser requested an isolated HTTP server; publisher/image requests and real AI were disabled. This run did not run alongside the disk benchmark.

| Browser phase | Before | After |
|---|---:|---:|
| Network fetch, including response body | 2,799.3 ms | 513.3 ms |
| Frontend fetch/parse interval | 2,658.6 ms | 555.2 ms |
| Frontend update through Alpine/animation frame | 1,126.6 ms | 855.6 ms |
| Rendered cards | 40 | 40 |

The earlier network request starts during HTML parsing, so its resource duration differs from the later `fetchData` interval. DOM initialization/rendering remains a material cost; this work does not claim instant end-to-end paint or eliminate the app's existing 40-card rendering cost.

## Serving and publication

- `topStoriesPublished` is a durable display envelope around the existing Top index, stored through the database's atomic Smart-data persistence. It contains ordered full cards, cluster membership, representative sources, ranking/editorial state, Top/More cutoff, timelines, coverage, image candidates, and source content. Briefings continue using the existing durable `storyBriefings` cache.
- On startup, a valid publication is loaded before attempting a rank rebuild. A legacy `topStoriesState` can be migrated without reranking only when all necessary source evidence is present and matches its saved hashes, with valid ranks and cutoff. Otherwise it is not presented as a complete snapshot.
- Existing publications are returned without awaiting reconciliation. After the response finishes, a background check examines source/configuration changes, article/cluster changes, and one-minute freshness boundaries.
- The existing deterministic ranking code runs in a worker thread. Its evidence/signal cache remains revision-based: unaffected stories retain their prior material versions and cached signals. The current implementation still walks candidates and sorts the complete deterministic result during reconciliation; it is **not** a newly implemented fully incremental ordered index. It does not AI-rerank the feed.
- The worker's complete result must pass identity, rank, score, contiguous Top prefix, and cutoff validation. One durable write succeeds before the current in-memory publication is swapped. Errors, empty/invalid results, and failed writes retain the old publication; failures are logged and retried with backoff.
- Reconciliation refuses upstream state marked refreshing, provisional, or early. The last completed Top publication remains available throughout RSS processing and reclustering. Classic can continue consuming its existing upstream states.
- A hard refresh may paint the existing client cache while fetching, then installs the complete authoritative server ordering atomically. It does not merge new rank labels into an old client order.
- Active reading tokens retain their ordering and Top/More boundary. Completed card updates and analysis can refresh without changing that ordering. Changed membership, ordering, material version, or cutoff sets `updatesAvailable`, which drives the existing “New updates available” control.
- Filtering is cached against the publication and the relevant user/search/filter inputs. Read/hidden/content-filter changes invalidate that filtered view. They do not launch a full rank rebuild.

## What still runs on a refresh

User-state reads, publication lookup, feed selection, current visibility/search filtering when its cache is invalid, stable-reading-token handling, page-sized card preparation, cached briefing lookup, and response serialization remain synchronous. Initial database loading is also necessary if the database has not been initialized.

Candidate reconciliation, relevance/signals, sorting, Top cutoff, rank persistence, look-ahead enqueueing, and online briefing generation are outside the persisted-snapshot response path. Background checks are triggered after responses; the existing Top reader polling continues to detect completed updates and freshness changes.

A plain refresh can enqueue **story briefing generation only for a genuine cache miss or relevant material/scope/analysis-policy invalidation**, after the response. It does not request embeddings or cluster AI verification. Valid current briefings—including a usable current latest entry whose historical cache key was evicted—are cache hits. The cached News → Finance → News test produces **zero AI calls**.

## Previous briefing safety

A completed previous scoped briefing remains available during generation, partial output, provider failure, or persistence failure. Incomplete analysis cannot replace a completed cache entry. Concurrent completions merge inside the persistence queue, and an older job cannot move the latest-version pointer backward.

Usable old analysis stays marked evaluated for display, with staleness tracked separately; otherwise the existing UI would hide its analysis tabs. Explicit corrections suppress unsafe old prose. Where a cited source changes a factual count, or prior prose no longer safely describes current conflicting counts, affected sections are removed while unaffected analysis remains. The factual excerpt then falls back to the current source content. A completed material update refreshes safe card content while preserving the reader's token, ordering, and cutoff.

## UI and Classic verification

The repeated Smart context/title node is no longer created in Top mode. The existing main header and the Top stories / Classic toggle remain. No replacement banner was added. Browser inspection confirmed 40 rendered cards, both toggle buttons, and no duplicate kicker. Classic retains its original heading.

Full Classic response payloads (excluding the generated reading token and with a fixed clock) were compared against the original path for News Vietnam, Finance Global, and Tech: **all three were identical, 40 cards each**. Existing Classic cache-only briefing tests also pass. No translation or language selection logic was changed.

## Acceptance coverage

Final validation: **375 tests passed, zero failures** via `npm test`, including 13 snapshot/client/fallback regressions. Syntax checks and the required CSS build also passed.

| Scenario | Verification |
|---|---|
| A. Unchanged refresh | Cached publication returned without rank computation; unchanged revalidation skips work; ready analysis makes no AI call. |
| B. RSS processing | Both refreshing status and provisional cluster publication retain the old ranked snapshot. |
| C. New article | Existing index tests cover retained material versions for duplicates; background publication tests cover changed candidates and completed replacement. No ranking AI is called. |
| D. Material update | Actual ranking-worker test changes a factual count, preserves the reading token/cutoff, publishes the completed new version, and falls back to safe source content. |
| E. News → Finance → News | Cached cards and briefings are reused during RSS processing, with zero AI calls. |
| F. Hard refresh | Isolated headless browser renders 40 cards from the persisted publication; AI/provider and image network requests are disabled. |
| G. Ranking failure | In-flight work, computation failure, invalid/empty output, and persistence failure all retain the prior view. |
| H. Briefing failure | Previous complete analysis survives provider failure and partial generation; unsafe factual portions are withheld. |
| I. Restart | A new service reads the durable publication without reading candidates or invoking ranking; the real-store cold-load experiment also renders all 40 persisted cards. |

Detailed timings remain available through `Server-Timing`. `SMART_REFRESH_PROFILE=1` logs request phase timings, including transport handoff. The Top frontend records `smart-top-fetch`, `smart-top-render`, and `window.__smartRefreshTiming` after Alpine has updated the DOM and reached an animation frame. Browser fetch timing includes the response body; render timing is separate and is not an image-download completion measurement.

## Activation

After explicit user authorization, `rss-reader` was restarted successfully. Systemd reports `active/running`, and the local `/health` endpoint returned `status: ok`. The changes are activated.

### Memory-pressure recovery

Top ranking reads the canonical cluster, raw-article, and editorial-state JSON
strings and parses them in the bounded ranking worker. It no longer materializes
another full candidate graph in the HTTP server. The production worker path
reserves the greater of 512 MiB or 15% of the main V8 heap for publication; genuine
pressure preserves the current snapshot and retries automatically after 15 seconds.
Compute/persistence failures retry after 30 seconds. The legacy
`TOP_STORIES_MAIN_HEAP_MAX_MB` / `TOP_STORIES_PROGRESSIVE_HEAP_MAX_MB` thresholds
apply only to the object-based custom compute path. The worker's own
`TOP_STORIES_WORKER_HEAP_MB` limit remains in force.

The input signature hashes the existing JSON strings, so fresh raw articles
invalidate Top even within a reranking time bucket. Progressive publications must
match both version and revision. Split stories receive unique IDs before editorial
state is assigned, and an invalid replacement cannot overwrite editorial state.
