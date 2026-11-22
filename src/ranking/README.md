# Deterministic story ranker (Classic / Stories view)

No generative AI, no network, no I/O in the scoring path. Inputs: rules and EN+VI lexicons over headlines and leads,
stored source weights, corroboration/velocity of independent outlets, and the multilingual-e5-small vectors the
clustering already computed (read-only, `vector-store.js`).

| file | role |
| --- | --- |
| `score.js` | `scoreStories()`: three linear heads (`model.json`) -> score, routine damper, hot-news floor |
| `features.js`, `lexicons.js` | pure feature extraction; lexicons reuse `smart/prefilter/policy.js` guards |
| `routine.js` | routine multi-outlet patterns (sports results, festivals, anniversaries, awards, digests, state-media reposts) |
| `hot-floor.js` | graded floor over distinct outlets: tier 1 (3+, Hot, top 3), tier 2 (8+, pinned #1, Breaking, fresh only) |
| `outlets.js` | distinct real outlets: aggregators dropped, same publisher and syndicated reposts collapsed |
| `config.js` | all tunables: `HOT_FLOOR`, `ROUTINE_DAMPER`, env switches |
| `classic.js` | adapter for the Classic view, display scale 1..10, `hotnessLabel()` |
| `vector-store.js` | lazy read of cached e5 vectors; a missing vector makes the e5 features neutral for that story |
| `centroids.json` | FROZEN section "AI-top"/"AI-excluded" centroids |

## Frozen assets
`model.json` (weights) and `centroids.json` were produced once, offline, against the last AI "Top stories" publication.
They are **not refreshed by any job**; no AI writes to them. `scripts/build-ranking-centroids.mjs` rebuilds the centroids
reproducibly (read-only sqlite + embedding cache; `--check` compares with the shipped file without writing) but only works
while the AI labels (`topStoriesPublished`) still exist.

## Operations
- `CLASSIC_RANKING=legacy` restores the old `rankStory()` ordering (read per request, no restart of the clustering needed).
- `RANKING_HOT_MIN_OUTLETS`, `RANKING_HOT_WINDOW_HOURS`, `RANKING_HOT_ACTIVE_HOURS`, `RANKING_HOT_MAX_RANK`, `RANKING_ROUTINE_DAMPER`
  override the constants in `config.js`; `RANKING_VECTORS=off` disables vector loading; `RANKING_VECTOR_WAIT_MS` bounds the cold-start wait.
- Tests: `test/ranking-signals.test.js`, `test/classic-ranking-wiring.test.js` (pure, fast).
