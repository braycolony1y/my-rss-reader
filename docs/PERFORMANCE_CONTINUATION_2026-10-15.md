# RSS Reader continuation — October 15, 2026 (Vietnam)

Overall acceptance is **incomplete**. This continuation implements a specific ranking-input ownership fix. It does not establish that the service's heap OOM, disk-write rate, navigation latency, or intermittent visual issues are solved. Measurements below ran October 14 UTC / October 15 Vietnam. The preceding browser evidence is in `FLICKER_INVESTIGATION_2026-10-14.md` and is explicitly historical unless stated otherwise.

## Implemented change and evidence

**CONFIRMED AND FIXED:** `lastInputFingerprint` kept the full decoded cluster publication and raw article strings after ranking. Production database storage uses immutable UTF-8 `StoredJson` buffers for large values. The old equality check decoded them on every scheduled check, even when the worker would not run.

The replacement computes full SHA-256 digests directly over those immutable bytes. A WeakMap memoizes only each digest against its stored owner. A request-scoped handle captures the exact stored generation and decodes it only after the ranking signature misses and worker headroom is available. Handles are not stored on the snapshot service. Replacing a database value naturally changes the owner/digest; in-flight readers retain their captured generation. Small plain strings are hashed directly. The combined digest includes two fixed-length hashes, preserving input boundaries. There is no length/suffix shortcut and no corpus serialization added on the production path.

The outer ranking signature still includes prefilter identity, policy, configuration, publication version, progressive revision, source configuration and the existing time bucket. The 60-second default is unchanged. The new digest format causes one signature miss when first used with an older persisted signature. No durable format changes are made.

Modules: `src/articles/ranking-input.js`, `src/database/stored-value.js`, `src/database/access.js`; minimal integration in `src/articles/top-stories-snapshot.js`. Existing untracked modules and unrelated dirty changes remain intact.

### Isolated ownership measurement

Read-only snapshot input: 46,492,479 cluster-publication characters and 2,253,677 raw-article characters. Node 24.20.0; separate processes; five completed checks, with explicit GC only in these diagnostic processes. The production writer was never opened. Only scalar measurements are committed in `performance-2026-10-15/retention-*.json`.

| Measurement | Before | After |
|---|---:|---:|
| Post-check external memory | 143.05 MiB | 50.07 MiB |
| External memory after releasing only fingerprint owner | 50.07 MiB | 50.07 MiB |
| Post-check V8 heap used | 3.58 MiB | 3.60 MiB |
| Warm fingerprint check median (4 checks) | 122.24 ms | 0.21 ms |
| Warm check maximum | 128.08 ms | 0.46 ms |
| First check, including initial hashing/materialization | 292.17 ms | 99.81 ms |

The causal release experiment attributes **92.98 MiB of external memory** to this owner on this dataset. It does **not** demonstrate a 93 MiB reduction in V8 heap. Decoding these inputs produced externally accounted strings in this runtime. This correction matters: removing this owner alone cannot explain or establish a fix for heap exhaustion. The microbenchmark is a targeted diagnostic, not whole-service latency or CPU acceptance. It excludes ranking, embeddings, AI calls and persistence.

## Cache ownership and scheduling

Repository call graph: `presentation.releaseTransientCaches()` clears `_smartClustersHistory`, `smartApiViewCache`, `freshViewCache`, `classicRankedViews`, `filteredTopViews`, `storyViews`, then invokes `topSnapshots.releaseInputCache()`. `database.releaseParsedCache()` clears the parsed cache. Searches across application entry points and source found no external caller of either public release method. Startup/RSS lifecycle receives `http.gcAndLogMemory` directly. No blanket cache-clearing wrapper was added.

`releaseInputCache()` remains API-compatible but has no work: snapshot-level input retention no longer exists. Weak digest memoization follows immutable database ownership, not memory logging or a job timer. Parsed cache clearing does not invalidate the authoritative bytes or pending input handles.

| Cache | Existing bound / ownership | Decision |
|---|---|---|
| Parsed JSON | 192 MiB source-size proxy, 64 entries; bounded weak recovery | Preserve; proxy is not measured graph size |
| Cluster history | Current/previous publication handling | Preserve; full-service retained ownership still needs attribution |
| Smart API and fresh views | At most 7 each | Preserve navigation reuse |
| Classic ranked views | At most 6 | Preserve |
| Filtered Top views | At most 12 | Preserve |
| Pinned story views | At most 8, expiry cleanup on requests | Preserve pinned membership/order |
| Ranking input digest | Weakly keyed immutable stored values | Full strings removed from persistent fingerprint owner |

Top API responses register scheduling on response finish. Scheduler coalesces pending/timed work; rebuild evaluates identity before invoking a worker. A schedule call is not evidence of worker execution. Tests verify unchanged inputs avoid another publication and same-length internal content changes cause ranking. Time-sensitive freshness still invalidates at the original bucket. No reduction in legitimate worker frequency or publication writes is claimed.

## Production reliability

At the initial check: PID **3629472**, active/running, `NRestarts=3`, started **2026-10-14 14:25:56 UTC**, health OK, heap **1901.9 MB**, RSS **3668.9 MB**, external **411.1 MB**. These are active-runtime observations, not completed-job floors.

A third production heap OOM is confirmed in the journal at **2026-10-14 14:25:46 UTC** (21:25:46 Vietnam), followed by ABRT and automatic restart. The previous PID was 3303765. The dominant live V8 retaining owner remains **CONFIRMED BUT UNRESOLVED**. No production GC, heap snapshot, heap-limit increase, corpus deletion or blanket cache flush was performed by this continuation. Existing application GC callbacks were inspected but not invoked as a diagnostic.

## Proposed visual patches and existing fixes

The three proposals were not assumed applied. Source inspection found the described palette-before-focus-deferral behavior, `state.shown` tied to settled presentation, unconditional source reset in the mutation handler, and soft-layer readiness based on `complete`/`naturalWidth`. Those mechanisms warrant testing; existence alone does not prove the user's intermittent event.

The proposed approximate fingerprint is **REJECTED**. The blanket cache-release wrapper is **REJECTED**. A 15-minute reranking interval is **REJECTED**. Broad CSS-container observer exclusions and treating a decoded old image as proof of new-image readiness are **REJECTED**. No such patch was installed.

The existing normal-feed identity reuse, Smart Top reconciliation, authoritative membership/order, and delayed briefing ownership checks remain in source. New regression tests exercise the backend change; prior production-component browser results retained 8/8 cards across revalidation. No visual styling or layout was changed in this continuation.

Opt-in recorder overhead from the completed earlier alternating experiment (8 checks per variant/theme): Classic median 54.8 ms off / 54.4 ms on, maxima 64.8 / 77.2 ms; Glass median 64.75 / 80.45 ms, maxima 78.5 / 350.7 ms. Instrumentation can affect timing, particularly tails. It remains disabled by default; it must be enabled before reproduction. No continuous production screenshots are introduced.

## Required acceptance inventory

| Requested area | Status and evidence / next action |
|---|---|
| Repository and patch status | Verified dirty baseline; exact touched files backed up under `/tmp/rss-oct15/rollback`; no reset/clean/staging |
| Retained JSON and fingerprint | CONFIRMED AND FIXED for this owner; complete-content regression tests and causal isolated release measurement above |
| Cache lifecycle and concurrent reads | Focused tests cover replacement, parsed-cache release and failed persistence; blanket release rejected |
| Other dominant retainers / heap OOM | CONFIRMED BUT UNRESOLVED; need representative completed RSS/Smart/embedding/extraction cycles and isolated retaining-path attribution |
| CPU / event loop | Targeted fingerprint costs measured; full-service CPU and event-loop improvement NOT TESTED |
| Reranking / worker executions | Default freshness preserved; unchanged-input and changed-input worker tests; production frequency reduction NOT CLAIMED |
| Persistence / physical writes | No persistence changes; matched physical write reduction NOT TESTED; previous hourly figures remain unmatched |
| Focus completion / blend / observers | Source mechanisms verified; no speculative lifecycle patch applied; delayed-response experiment recorded separately below |
| DOM identity / idle-page stability | Earlier controlled reproduction fixed; previous idle and out-of-order scenarios documented in October 14 report; original user incident not conclusively reproduced |
| Feed / Smart Top / cached article latency | No new matched navigation improvement claimed; existing warm cached-article tail remains unresolved |
| Desktop / mobile Chromium / Linux WebKit | Prior production-component results recorded in October 14 report; current replay results below |
| Physical iPhone | NOT TESTED; Linux WebKit is not physical Safari |
| VOZ and persistence recovery | Existing full suite required; no VOZ/persistence implementation changed |
| Rapid same-turn transitions | Earlier artificial stress rejection remains unresolved; no new transition machinery |
| Source fallback on reused cards | SUSPECTED: fallback counter may survive a changed primary source; requires controlled image-failure reproduction before changing ownership |
| Long-run acceptance | INCOMPLETE; successful tests or restart do not establish stable completed-job floors |

## Tests and rollback

Added `test/ranking-input.test.js`: equal-length/equal-suffix changed payloads, ordered/boundary-aware input identity, lazy decoding, immutable pending readers across replacement and cache release, failed-persistence rollback. Expanded real-worker memory regression to change internal content without changing length and verify release does not trigger an unchanged publication. Focused run: 27 passed, 0 failures before the final expanded worker assertion; full suite result below is authoritative for final code.

Rollback must reverse only this continuation's patch, then restart once and verify health. Do not restore the entire tree or overwrite unrelated edits. Durable targeted patch and final activation evidence are recorded below.

### Final regression suite

`npm test`: **792 passed, 0 failed, 0 skipped**, 258.252 seconds; server/feed-worker syntax checks passed. This includes the expanded real-worker assertion, all existing six-destination, progressive publication, briefing, VOZ, persistence and image tests. Individual early sandbox test-runner output counted files rather than subtests; the authoritative full run was outside those restrictions.

`performance-2026-10-15/implementation.patch` is the exact production-only change. `git apply --reverse --check` succeeded against the current dirty tree. Reversing it restores only the four production files touched by this continuation; tests and diagnostic reports can remain. Recheck applicability if later edits touch those lines. No runtime data is included.

### New delayed-focus reproduction (CONFIRMED BUT UNRESOLVED)

Ran the production page/card components in desktop Chromium for both Classic and Glass with controlled 100, 500, 1000, 2400 and 3000 ms responses. Diagnostics were installed before navigation; request routing was used deliberately for this timing experiment, not for a navigation benchmark. All ten runs had no page errors. Captured per-frame focus/deferred/shown/settled/palette and CSS state plus actual Chromium screencast frames. Scalar transitions are in `performance-2026-10-15/focus-transitions.json`.

For Classic at 1000 ms, the decoded image's focus Y changed from 59.426% to 0.000% after the delayed response. These CSS coordinates establish a change in positioning state; they do not alone prove a visible photographic crop jump. Inspected actual frames (`focus-before.png` / `focus-after.png`) show the card background changing from white to a tinted gradient while text and card geometry remain fixed. The fixture uses local default image bytes and a controlled focus/palette response, not an actual user's photograph.

At 3000 ms in **both themes**, the timeout first marks the image shown/settled. The correct returned focus is then stored in `deferred`, while `state.focus` remains center and `state.palette` becomes the new response palette. That mismatch remains through the end of the approximately 4.8-second observation; source logic waits for the card to leave the screen. This confirms the possibility of indefinite deferral while it stays visible. At shorter delays, focus is applied. Glass's sampled hero-position/tint variables did not change in this fixture, so a Glass hero jump was **not reproduced**.

No speculative focus fix is activated. A correct candidate must commit focus, palette, tint and prepared blend coherently, accept only the matching source generation, and demonstrably finish focus while the card stays visible. It must then pass cached/uncached, failed decode, source replacement, responsive currentSrc, removed/reused cards, and intermediate-frame tests. Freezing fallback indefinitely fails the requirement; blindly applying late updates would preserve a visible jump. The complete lifecycle matrix remains incomplete.

### Current browser regressions

Desktop/mobile Chromium: eight combinations (two themes × two viewports × feed/Top), all retained **8/8** cards in every recorded frame, **zero removals/insertions**, no page errors. Linux WebKit/iPhone viewport: four combinations, same result. Scalar summaries are `performance-2026-10-15/chromium.json` and `webkit.json`. These revalidation checks do not establish the entire requested lifecycle matrix or physical iPhone acceptance.

### Activation

One planned manual restart at **2026-10-14 19:53:43 UTC** (October 15, 02:53:43 Vietnam) activated the backend modules. New PID **3849854**, active/running. `NRestarts` reset to 0 on the manual restart; the three previously confirmed automatic crash restarts remain part of the reliability record. Immediately before activation, Smart was idle and local compute was idle, but the resource snapshot showed an active RSS persistence transaction and one queued transaction. Therefore this was not a proven all-jobs-completed boundary. Startup loaded the database successfully; health and cached prewarm continued. No corruption/recovery error appeared in the inspected startup journal.

The health `feedCount` initially reported 8 because that metric counts feeds in the new process's fetch history (`src/routes/diagnostic-routes.js`), not durable subscription count. Do not interpret it as lost subscriptions. Served frontend hash equals the local assembled hash, `80e8420adbef862ff7fe2bafce4c6faaf8b5a126e628aa62bf1f35e09f14bb3f`; unchanged cachebuster **20261014_flicker_1** is correct because this continuation changed no frontend production asset. `activation.json` contains the check. Restart-time memory is not presented as a saving.

A bounded read-only 12-hour collector runs as `rss-reader-audit-20261015.service`, writing `/tmp/rss-oct15/soak.jsonl`. It samples process identity, resources, Smart lifecycle and I/O every 30 seconds without forced GC or snapshots. Its `observedIdleCandidate` flag is not proof of complete RSS quiescence. Review completed-job boundaries, natural-GC floors, process changes and writes before claiming long-run acceptance. The collector does not send messages or modify application data.

Warm-check diagnostic distribution (four samples only; nearest-rank percentiles): before median/p75/p95/max **122.24/127.89/128.08/128.08 ms**; after **0.21/0.32/0.46/0.46 ms**. Median process CPU consumed per check: **98.40 ms before / 0.141 ms after**. This is too small a sample to characterize service tails; it demonstrates eliminated repeated decoding work. No production CPU percentage, event-loop or physical-write improvement is inferred.

Live post-activation Chromium initialized both Classic and Glass without page errors. Normal-feed navigation returned **23 cards** and Smart Top returned **40 cards** in each theme; image-focus initialization was active. A separate Top API check returned **8 requested articles, 50 subscriptions, no error**, with background ranking pending. These are functional smoke checks, not matched latency measurements. The first smoke's cached-open selector used a card flag that is not guaranteed on list cards, so its 'not tested' outcome does not prove the cache was empty; a follow-up uses the actual article-content cache.

Next priorities: (1) analyze the 12-hour collector and reproduce remaining heap owners in isolated completed RSS/Smart/embedding cycles; (2) implement and compare a coherent, source-owned focus/blend commit lifecycle against the recorded delayed-response baseline; (3) reproduce fallback-counter reuse and responsive source changes before observer optimizations; (4) attribute writes over matched completed workloads before persistence edits; (5) repeat T0–T17 navigation/cached-open comparisons under equivalent load. Physical iPhone validation remains an external test gap. No broad navigation, disk, or whole-service memory acceptance is claimed.

Follow-up live cached-article verification succeeded in both Classic and Glass: actual content-cache entry selected, `readable=true`, `cached=true`, no overlay error and no page errors. Results are in `performance-2026-10-15/live-cached-browser.json`. The collector's first six samples contained one unchanged PID (3849854) and no collection errors; this short interval is not stability acceptance.
