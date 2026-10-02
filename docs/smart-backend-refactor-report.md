# Smart Stories backend refactor

`smart-news.js` is now a **28-line compatibility facade**, down from 14,370 lines. All **52 exports** and **14 public engine methods** retain their names, parameters and import path. The implementation lives in **55 feature modules** under `src/smart/`; the largest is 902 lines.

The extraction preserves the existing algorithms and policies. It does not change clustering thresholds, provider priorities/models/thinking levels, cache identities, DB schemas or refresh behavior.

## Ownership and module tree

```text
src/smart/
  config.js
  text/normalize.js
  dates/publication-time.js
  articles/
    identity.js                 stable/article/group IDs
    language.js                 language detection
    categories.js               refinement and inference
    normalize.js                normalized fields and content hashes
  sources/
    identity.js                 URLs, publishers, policy identity, exclusions
    normalize.js                source fields, methods and counts
    settings.js                 publisher-shared policies and source CRUD
    discovery.js                discovery pool and deduplication
    fetch.js                    RSS batches and configured prefetch behavior
    wrappers.js                 Google News wrapper deduplication
  embeddings/
    config.js                   model/cache identity, path and batch size
    index.js                    persistent worker, protocol, cache, preparation
  clustering/
    event-evidence.js           actions, sports/airline/numeric conflicts
    similarity.js               scope, destinations, thresholds and decisions
    components.js               deterministic candidate/component pipeline
    auto-merge.js               medoid splitting and direct-link partitions
    representative.js          representative selection
    relationships.js           related developments and broader-story metadata
    cluster.js                 cluster construction, hotness, legacy cleanup
    review-groups.js            incremental review/reconciliation/fallbacks
    review.js                   ambiguous-group sequencing and memory deferral
    worker-client.js            persistent clustering-worker lifecycle
    execute.js                  worker protocol and canonical article rebinding
    publication-snapshot.js     membership checks, active corpus, retained IDs
  verification/
    schemas.js                  partition and component schemas
    prompts.js                  inputs, prompts and component units
    validation.js               structural and event-safety validation
    diagnostics.js              error properties and safe diagnostic fields
    provider-config.js          enabled order, preferred model and review limits
    providers.js                transport adapters and local availability cache
    provider-health.js          health persistence and serialized writes
    cache.js                    partition/component identities and shared writer
    attempt.js                  partition attempt, repair and result handling
    component-review.js         component attempts and fallback routing
    review.js                   verification chain and failure reuse
  editorial/assessment.js       editorial planning, routing, cache and application
  persistence/
    settings.js                 Smart settings reads/writes
    smart-state.js              existing bulk-write/fallback behavior
    publication.js              editorial, atomic final snapshot and graph release
  refresh/
    engine.js                   instance initialization and module wiring
    run.js                      foreground orchestration and failure/finally paths
    candidates.js               source ingestion, signatures and change detection
    progressive.js              per-refresh baseline/resolved publication state
    review-publication.js       reviewed snapshot and pre-editorial graph release
    review-progress.js          provider/group progress callbacks
    status.js                   existing public status shape
    metrics.js                  original counters and cumulative persistence
    coordination.js             private foreground lease count
    scheduling.js               shared asynchronous waits
    schedule.js                 original startup and recurring refresh timing
  background/
    source-sync.js              idle/headroom gates, duplicate dropping, fetch loop
    source-evaluation.js        original monthly evaluation and hourly checks
```

The [pre-extraction inventory](smart-backend-module-map.md) lists every original declaration, its lexical dependencies, every DB operation/environment reference/timer, all facade consumers, and implementation-source test references. The final owners above refine that initial plan around the actual dependencies and refresh stages.

Existing owners remain in place: destination canonicalization, the global AI scheduler, local-compute coordination, Smart editorial policy, clustering JSON parsing/repair, Antigravity, Gemini Web, Gemini key availability, story ranking, content filtering, source-state normalization and response-body disposal. Their implementations were not duplicated into Smart modules.

## API and import compatibility

Production application, routes, storage, presentation, prefetch and worker consumers continue importing `smart-news.js`. Its export list matches the original golden fixture exactly.

The one production caller change is the three imports at the top of `smart-hnsw-clustering.js`: `classifyE5Match`, `isPairWithinComparisonScope` and `MatchDecision` now import their `similarity.js` owner. This removes the old facade/HNSW cycle without changing the HNSW implementation.

Implementation-source tests read the feature owners through `test/helpers/smart-source.js`. Cache-busting a facade URL no longer creates another copy of private owner state: embedding tests explicitly clear/reload the owner cache and test environment capture through the configuration owner. Ordinary production imports still initialize configuration once.

The public engine methods remain `getStatus`, `getSources`, `getSourceSettings`, `addSource`, `removeSource`, `setSourceEnabled`, `setSourceFetchMethods`, `setSourceFetchMethodsByIdentity`, `discoverSources`, `resetSources`, `sync`, `start`, `getSettings`, and `updateSettings`.

## State, workers and memory

| State | Private owner and exposed behavior |
| --- | --- |
| Embedding cache/pipeline/worker/message IDs/pending promises | `embeddings/index.js`; preparation, import/export/load/save/clear/prune operations |
| Clustering worker | `clustering/worker-client.js`; the existing singleton getter and unchanged process-exit handlers |
| Batch stop tokens | `text/normalize.js`; batch update and token operations |
| Local-model availability cache | `verification/providers.js`; original availability checks and TTL |
| Preferred clustering model | `verification/provider-config.js`; setter and provider selection |
| Provider-health write chain | `verification/provider-health.js`; serialized health operations |
| Verification write chain | `verification/cache.js`; one shared writer for partition and component entries |
| Active foreground refresh count | `refresh/coordination.js`; begin/end/active operations used by foreground and background paths |
| Running/progress state | Each `createSmartRefresh` instance; sync and status getters |
| Schedule timer | Each `createSmartSchedule` instance |
| Progressive revision/baseline/resolved maps | Each `createProgressivePublication` instance; publish/record/release operations |

Private singleton objects are not exported. Only the two original worker owners construct production workers. Worker URLs and the default embedding-cache file still resolve to repository-root files after moving. Monthly evaluation retains its original dynamic import target.

Embedding disposal remains a no-op during normal refreshes. Clustering fatal error/exit still schedules whole-process exit; no replacement worker/pool was introduced. Real probes used the same clustering worker for two cached-vector jobs (native incremental HNSW and deterministic modes), and one embedding worker for two protocol pings: **zero replacements, zero online AI calls**. Model inference was not rerun by these probes; cached-vector and initialization/protocol paths were exercised.

Candidate preparation retains its original explicit array/map/reference cleanup before clustering. Review publication clears input graphs before editorial. Progressive release additionally drops its extracted closure's graph references so extraction does not retain those graphs. Orchestration clears its temporary input/result wrappers before the corresponding explicit collections. Final persistence retains the original cleanup before the ready status and notification. No refresh graph is stored at module scope.

Golden refreshes still use one worker job; an unchanged second refresh starts no worker job or AI request. Editorial uses the same three mocked local batches for the representative fixture. The progressive case preserves deterministic publication, verified publication, activation-write ordering, revision numbers, final atomic retirement, and notifications.

## Persistence and identity

Structural comparison confirms the same **54 direct DB operation sites**, the same bulk publication keys, the same **31 environment variable names and all their reference sites**, and the same timer constructors. Defaults, bounds, parsing and call-time versus module-time evaluation remain unchanged.

All original keys remain: `articles`, `blockedArticleKeywords`, `feeds`, `lastSourceEvalTime`, `smartAiConfig`, `smartAiProviderHealth`, `smartCandidateLinks`, `smartCandidateSignature`, `smartClusterState`, `smartClusterVersion`, `smartClusteringAlgorithmVersion`, `smartClusteringCounters`, `smartClusteringFailedAttempt`, `smartClusteringInputs`, `smartClusters`, `smartDeferredReviewGroups`, `smartEditorialAssessmentCache`, `smartEmbeddingIdentity`, `smartEventVerificationCache`, `smartProgressiveClusterState`, `smartProgressivePublication`, `smartRawArticles`, `smartSettings`, `smartSourceScores`, `smartSources`, `smartStatus`, and `smartVerificationFailures`. The dynamic bulk-write fallback is preserved too.

Clustering, embedding, verification prompt/rules/schema, component-review and editorial version strings are unchanged. Golden tests compare article/content hashes, embedding identities, partition and component cache keys, editorial cache identities, and complete persisted refresh output. Existing stored Smart data stays readable; no migration or cache invalidation was added.

AST comparison found **190 original named functions/callbacks unchanged**, allowing only necessary root-relative path adjustment. Five original functions have integration changes: deterministic grouping delegates medoid/direct-link splitting; background sync reads the private refresh counter through behavior; the engine wires owners; status reads private instance getters; sync delegates stages. Their algorithms/stage output are covered by the golden and focused tests.

## Validation and activation

| Check | Result |
| --- | --- |
| Baseline full suite before extraction | 88/90 test files; existing layout and sandbox HTTP failures |
| Final full `npm test` | 92/94 test files; the same two failure names |
| Focused Smart/provider/source/UI compatibility suite after final formatting | 19/19 test files |
| Original six-destination golden fixture | Exact meaningful output match; 14 articles, duplicate/bilingual/related/ambiguous cases and unreliable publication time |
| Complete refresh/editorial/persistence golden | Exact stored values, requests, metrics, notifications and unchanged reuse |
| Progressive golden | Exact deterministic/verified publications and final retirement |
| Concurrent partition/component cache writes and provider-health writes | Passed; no lost updates |
| Private ownership, facade/module bounds and background coordination/timers | Passed |
| Import-cycle checks after extraction phases | Passed; final facade and 55 owners are acyclic |
| Import every Smart module; server/feed-worker syntax | Passed |
| Golden tests with explicit GC enabled | Passed |
| Real worker probe | Two clustering jobs, two embedding pings, no replacement or online AI call |
| Clustering-worker fatal error and exit handlers | Each isolated probe exited the whole process with status 1, preserving recovery semantics |
| HTTP integration rerun outside sandbox | Passed in 5.2 seconds |
| Activation | `sudo systemctl restart rss-reader`; active/running, health `ok`, no automatic restart |
| Live Smart APIs | Status and source endpoints returned HTTP 200; existing snapshot/source data remained readable; expected provider order and foreground/background deferral logged |

The remaining pre-existing failure is `test/project-layout.test.js`, which rejects the existing `.aws` directory. The full-suite HTTP failure is a sandbox limitation; its isolated rerun passed. These are reported separately from refactor validation rather than counted as a fully green sandbox suite.

The live startup refresh was still fetching sources at verification time. Health, module loading, existing snapshot reads and coordination were checked live; completion of a new production AI refresh was not claimed. This is a structural refactor, so no speed or memory improvement is claimed.

## Change scope and review

The task adds the 55 Smart modules, four maintained test modules, five test helpers, three baseline fixture files, and this documentation/inventory. It replaces the old implementation with the facade, changes the HNSW import wiring, and updates eight existing tests for module ownership. No production file was deleted and no unrelated legacy implementation was split.

[Scoped before/after diff statistics](smart-backend-task-stat.txt) exclude pre-existing workspace changes. [Raw `git diff --stat`](smart-backend-git-stat.txt) includes earlier work in this already-modified workspace and omits untracked files; it is not this task's change count.

The scoped comparison covers 79 files: 69 created, 10 modified, and none deleted. The two diff-stat text artifacts are additional documentation and are excluded from that comparison.

No implementation remains inline in the facade. Cohesive policy/state-machine blocks remain within their owners: provider execution (902 lines), verification attempts (873), deterministic component orchestration (780), editorial assessment (756), and candidate preparation (715). They were moved rather than rewritten or artificially fragmented. Future changes have feature owners without reopening the original monolith.
