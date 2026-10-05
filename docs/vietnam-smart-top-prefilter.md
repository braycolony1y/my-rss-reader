# Vietnam Smart Top early filtering

Implemented for `news_vietnam` and `tech_vietnam`. The feature is enabled by default. Set `SMART_TOP_VN_PREFILTER_ENABLED=false` in the service environment and restart `rss-reader` to restore the prior pipeline. The disabled engine is checked against the original full runtime/progressive-publication golden contracts.

## Actual pipeline and hooks

Smart RSS discovery (`sources/fetch.js`) parses title, link, GUID and feed metadata, then `articles/normalize.js` assigns the existing category/region, articleKey and contentHash. Ordinary feeds reach Smart through the normal article database. Source configuration, not language, determines Top destination eligibility; a generic Tech feed can serve both Vietnam and Global.

The new source-work hook runs after existing normalization and before publisher-link resolution or Smart-specific speculative article warming. The complete raw RSS arrays are retained. The later candidate hook runs after the existing source/article merge and content-filter gate, before embedding-text hashing, embeddings and HNSW. Both use the same state owner and do not repeat an already-completed deterministic decision for the same revision.

Surviving candidates follow the original path: embeddings/HNSW → optional event-verification AI → progressive/final cluster snapshots → existing editorial AI → Top ranking worker → published cards → briefing/source acquisition. There is no generative AI stage before embeddings in this pipeline. The shared work needed by another eligible destination continues even if Vietnam is excluded.

## Reuse and authoritative state

`src/smart/prefilter/state.js` owns one versioned decision per article revision and section. State is persisted as `smartTopPrefilterState` through the existing Smart state overlay. Derived candidate stamps transport this state through workers and snapshots; ordinary articles are not deleted. Concurrent readers share one store, and writes are serialized.

Decision fields include status, final, section, policyScope, reasonCode, reason, signals, materialitySignals, decisionSource, filterVersion, evaluatedAt, decisionId and reusedFrom. Terminal exclusions are checked before rule evaluation. KEEP means only that early exclusion was not established; it is not an inclusion whitelist. A nonterminal deterministic KEEP can receive one existing-AI opportunity.

Safe lookup methods:

- Existing stable articleKey, or source-scoped GUID when available.
- Existing publisher URL cleanup plus canonical URL normalization, including tracking/fragment differences. Content-bearing query IDs remain distinct.
- Exact NFC/whitespace/case-normalized title, preserving accents, words, numbers and negation.
- Explicit host-bound publisher suffixes: VnExpress, VOV.VN and CafeF. Arbitrary suffix removal and the existing aggressive scoring-title cleaner are deliberately not used.
- Existing contentHash, guarded by the same exact title/evidence revision.

Every reuse method also requires the same section, policy version and evidence revision. Changed title or available excerpt blocks blind reuse even at the same URL. Funding, new investment, changed status/scope/date/casualties, correction, denial, court action or arbitrary extra words are not fuzzy-matched. Exact title reuse across differing excerpts fails open. No embeddings, browser work, network fetch or AI request establishes identity.

The state cache is bounded to 20,000 revisions and discards records older than 30 days on load. A policy version change invalidates prior decisions. Decision indexes are process-local to the application's single production DB; workers receive the terminal state explicitly.

## Policies

Ordinary product/app/feature updates, opinion or potential without a concrete development, and routine sports are allowed in both sections. These three exclusion classes were removed on 2026-10-05. Saved exclusions with those reason codes are removed when state loads; stale published metadata and old AI output cannot restore them. Other editorial classes still apply when independently supported.

News is deliberately broad. Only pure one-place vanity ranking, ceremonial aspiration and routine ceremony cases are deterministic exclusions. Courts, health, education, environment, disasters, safety, governance, diplomacy, consequential statistics and uncertain developments survive. More nuanced low-value cases are left to an already-required AI task.

Tech has ten exclusion classes: rankings, adoption surveys, generic ambitions, events/exhibitions, awards, non-binding partnerships, minor pilots, minor training/research, corporate tech PR and local digitization. A negative signal is never sufficient without checking available metadata for materiality. Potential factories, funded investment, binding action, important infrastructure/capability, serious outages/security consequences and substantial industrial developments survive. The 500 kV examples survive; the mining-robot pilot and low-altitude industry story are retained conservatively.

No publisher blacklist or current-article/title/URL allowlist exists. Source/category assignment, ranking weights, recency, clustering rules, diversity and quotas are unchanged.

## Existing AI side task and cost

`prefilter/ai.js` extends the optional root schema of the already-required event partition/component-verification request. For candidates that do not receive that task, the existing editorial request provides the opportunity. Original primary prompts and response fields remain intact. All provider adapters use the same extension; there is no new provider invocation.

The side input references titles whose evidence is already in the primary task; it does not duplicate article bodies. Output is a bounded optional list of at most four high-confidence exclusions, with omitted rows treated as KEEP. This intentionally permits some low-value survivors rather than enlarging the request or creating another call. Missing, duplicated, malformed, low/medium-confidence, unknown-reason or materiality-conflicting rows fail open. A complete primary JSON object with a truncated optional trailing field is recovered without a side-task repair. After a valid primary response, all offered candidates have consumed their one side-task opportunity.

Measured with mocked provider HTTP in the complete existing refresh:

- Baseline: **3 AI requests**.
- Feature enabled: **3 AI requests**.
- Event verification with an accepted terminal side exclusion: **1 existing request**, no extra request.
- Missing/malformed/truncated side output: no additional repair request.
- New AI requests solely for filtering: **0**.

These are deterministic integration tests, not a production provider-cost benchmark. Optional added instructions still consume tokens in the existing call. No paid/live model calls were launched for corpus validation.

## Terminal boundaries and resource savings

Final EXCLUDE prevents that section from being offered to later filter/AI side checks. All-destination exclusions skip source resolution/warming, embedding input, HNSW input and subsequent event/editorial/ranking work. Section-only exclusions preserve work required by another configured destination.

AI event-verification exclusions are applied before subsequent publication/editorial processing. Embeddings already computed before that call cannot be recovered. Publication removes excluded members using the existing cluster builder; the ranking worker receives persisted exclusions so raw overlays cannot reintroduce them. Retained historical clusters are rebound to exact decision state. Cached stale cards containing excluded evidence are withheld until normal rebuilding. Briefing entry and queued execution guards prevent excluded evidence from causing later source fetches or AI generation. Requests already in flight cannot be undone.

Counters use the existing refresh metrics: `{section}_candidates_seen`, `{section}_reused_exclusions`, `{section}_deterministic_evaluations`, `{section}_deterministic_exclusions`, `{section}_existing_ai_exclusions`, `prefilterExcludedByReason`, `prefilterEmbeddingsAvoided`, and `prefilterClusterInputsAvoided`. The last two count input items removed, not measured CPU time or guaranteed uncached embedding executions. No speculative exact production fetch/AI savings are claimed.

## Corpus validation

The supplied 83-row Tech TSV was found at `/tmp/tech-vietnam-smart-top.tsv` and copied into maintained test fixtures. The News corpus is a captured 265-item `news_vietnam` subset of the repository's real `smartRawArticles`, including available excerpts. This offline replay performs no fetching or AI generation.

| Corpus | Total | Kept | Excluded | Reused | Deterministic exclusions | Existing-AI exclusions | Ambiguous keeps |
|---|---:|---:|---:|---:|---:|---:|---:|
| Tech Vietnam TSV | 83 | 56 | 27 | 0 | 27 | 0 | 27 |
| News Vietnam snapshot | 265 | 265 | 0 | 0 | 0 | 0 | 207 |

Tech exclusion distribution: events/exhibitions 5; awards 4; rankings 3; minor training/research 3; ordinary features/products 3; generic ambition 2; surveys 2; minor local digitization 2; corporate PR 2; minor demonstration 1. No News production-corpus exclusions remained after the academic-Olympiad correction. Synthetic tests separately prove the requested conservative News exclusions.

Deliberate ambiguous keeps include the semiconductor-support proposal, Hanoi flying-taxi trial proposal, Vietnam–Australia technology-cooperation results, lab-investment policy discussion, education/public-policy stories, and broad News reports lacking proof of a defined exclusion class. Override keeps include both 500 kV headlines, widespread website outages, the large industrial mining pilot and potential low-altitude industrial development.

The complete title + decision + reason output is in `docs/validation/vietnam-prefilter-corpus.tsv`; the JSON report includes all counts and URLs. `tools/experiments/vietnam-prefilter-report.mjs` regenerates the report using the current local News snapshot (and updates its fixture).

## Logging and operation

Look for `[smart-top-filter]` in existing operational logs or `journalctl -u rss-reader`. Each new section exclusion emits one event containing timestamp, source/feed, article identity, canonical URL, title, reason/signals/overrides, version, stage and reuse origin. Repeated terminal gates do not emit a second exclusion event. `SMART_TOP_VN_PREFILTER_DEBUG=true` also logs KEEP/override decisions.

## Files

New feature modules: `src/smart/prefilter/{policy,identity,state,boundaries,source-work,ai,publication}.js`.

Extracted touched routing modules: `src/articles/top-story-destinations.js`, `src/ai/smart-editorial-destinations.js`.

Small integration changes: candidate preparation, background source sync, verification adapters/acceptance, event-review boundary, publication snapshots, editorial assessment, database state-key registration, Top ranking/worker/snapshot and briefing entry points. Existing long-file routing implementations were moved into modules; unrelated legacy code was not split.

Tests: `test/smart-top-prefilter.test.js`, `test/smart-top-prefilter-runtime.test.js`; original runtime golden tests use `test/helpers/without-vietnam-prefilter.js` to prove disabled equivalence. No golden expected output was rewritten.

## Validation and activation results

- Syntax validation passed for all 29 modified/new JavaScript modules, tests and diagnostics; the package's `server.js` and `feed-worker.js` checks also passed.
- 87 focused policy/state/reuse tests passed. They include changed-evidence guards, terminal non-reevaluation, section isolation, mixed-cluster eligibility, academic Olympiads, serialized persistence, disabled behavior, optional-AI failure handling and stable survivor inputs.
- 4 integration tests passed: complete-refresh request-count equality (3 → 3), excluded raw items bypassing the worker/AI, accepted exclusion through the real verification adapter with mocked HTTP, and persisted-state protection for cached cards/worker overlays/briefings.
- Original runtime/progressive golden contracts pass with the feature disabled; the import graph remains acyclic. Existing component-review, editorial-ranking, clustering, article and snapshot tests were exercised.
- Final full `npm test` run: **674/676 passed**. The two failures occurred under concurrent load: the isolated HTTP smoke test exceeded its 30-second limit, and the material-update snapshot test did not finish its asynchronous update within its polling window. Both passed when rerun alone against the completed implementation: HTTP **1/1**, snapshot suite **13/13**. This is not claimed as a completely green concurrent full-suite run. Test time limits were not loosened.
- Backend restarted successfully. Post-restart verification: `ActiveState=active`, `SubState=running`, `NRestarts=0`, and `/health` returned `status: ok`.
- Production provider-cost/latency savings have not been benchmarked. Offline corpora and mocked-provider integration results are distinct from the live service health check.

The corpus artifacts below predate this policy change and retain the original historical results. The allowed-class regression tests cover the updated policy, persisted-state retirement, published metadata, and old AI output.

### Allowed-class activation verification (2026-10-05)

Focused policy, persistence, AI acceptance and personal-filter tests passed 103/103. After the approved service restart, the live system-editorial log dropped from 309 rows to 93 and contained none of the retired labels. The persisted prefilter state contained zero exclusions with the retired reason codes. The service was active/running and health returned OK.

Full suite after the policy change: 700/702 passed. The two failures were the previously observed HTTP runtime startup timeout and material-update snapshot timing assertion. The snapshot file passed 13/13 when rerun in isolation. Production health passed; syntax checks for both server entry points passed.
