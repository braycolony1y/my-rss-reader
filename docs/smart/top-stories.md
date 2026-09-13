# Smart Top Stories

Only requests selecting Top Stories use `src/articles/top-stories.js`. Classic retains `story-ranking.js`, its cards, and its existing sort. The shared navigation and article actions remain in place. Tech has a Vietnam/World selector within Top Stories.

The existing embedding/event clustering remains the primary clustering system. Top Stories reconciles shared articles and exact headlines across its candidates, enforces configured feed URLs and language destinations, chooses one eligible primary destination, and scores every eligible story before pagination. Source weights, attributed wire origins, identical headlines, and opinion flags provide observable estimates of evidence independence. These are conservative heuristics, not verified provenance. Undisclosed rewrites cannot always be identified. Numeric death-toll differences are flagged; other conflicts rely on explicit source wording and the source-grounded briefing.

`TOP_STORIES_CONFIG` accepts a JSON object overriding `TOP_STORIES_DEFAULTS` in the module, including signal weights, freshness decay, representative improvement, material similarity, cutoff quality/deviation/hysteresis, substantial rank movement, and enrichment look-ahead size. Restart the service after changing it. Ranking components are impact, relevance, novelty, confidence, attention, and independent corroboration. Semantic keywords are signals, not additive topic bonuses or navigation categories. Weights are applied once per component. Impact estimation is deterministic and intentionally does not wait for an AI response.

`topStoriesState` persists cluster identity, membership, representative choice/reason, evidence paths, conflicts, material timeline, evidence/material versions, timestamps, and substantial rank history. API `topStory` data additionally exposes rank, cutoff state/reason and components for inspection in developer tools; normal cards do not render these diagnostics. Briefing responses include generation status and the material version represented. Material matching is conservative lexical overlap; it does not guarantee detection of every development or correction. Timeline entries retain source headlines and links rather than inventing event descriptions.

The Top boundary is a contiguous quality prefix relative to the feed score distribution with hysteresis. There is no count quota or upper limit. More stories continue the same ranked order. Duplicate evidence does not automatically renew the material clock or invalidate prose. Material corrections invalidate the briefing and keep timeline history. Cached prose remains available while regeneration runs; stale key facts are suppressed for detected conflicts.

Ranking snapshots freeze the reader's order. Polling can complete briefings in place and announce new ranking/material updates. Tapping the notice, refreshing, switching mode, or revisiting the feed obtains a new snapshot. Enrichment prepares the current page plus configurable look-ahead batches; provider failures fall back to source excerpts.

The representative's headline is always displayed; AI output cannot replace it. Image fallback tries the representative, other cluster images, the source icon, then the existing default thumbnail. Key facts are optional and must occur in an attributed source quote. Analysis is optional, collapsed, and shown one section at a time. Analysis and coverage rails scroll horizontally on both desktop and mobile.

Validation: `npm test`, `npm run build:css`, and an isolated Chromium fixture using the actual page and application code. Screenshots are saved under `test/fixtures/generated/`. The focused regression suites are `test/top-stories.test.js` and `test/story-briefing.test.js`.

## Roundups and digests

`story-roundups.js` detects explicit English/Vietnamese multi-headline bulletins and structurally separated unrelated developments. A single-event live page, explainer, podcast or newsletter is not excluded just for its format. Detection is conservative and cannot reliably identify every unlabeled multi-topic page from a short RSS excerpt.

Containers are separated before Top Stories cluster reconciliation, cannot connect otherwise unrelated event clusters, and receive no event ranking signals. Their original article remains in More Stories with source text, without AI event enrichment. Short digest items never create new standalone stories. If existing clusters match an item confidently, the original roundup appears as supporting coverage, using only that bounded item in the briefing context. Matching respects configured source destinations, rejects ambiguity, and uses configurable `roundupMatchSimilarity`, `roundupMinSharedTokens` and `roundupMatchMargin`. Supporting excerpts do not change impact, novelty, independent confirmation or the material clock.

Previously contaminated clusters receive a new briefing scope so their old mixed-event prose cannot be reused. The container's old AI briefing is bypassed entirely. Tests in `test/story-roundups.test.js` cover the reported Vietnamese morning bulletin, event isolation, restricted destinations, ambiguous/short items, and cache migration.

## Analysis evaluation and delivery

Briefing schema version 2 requires an explicit usefulness review for Why it matters, What changed, Timeline, What to watch, Market impact, Who is affected, What to do, and Background / Context. Additional story-specific sections are allowed. Useful sections must have supported content, while omitted sections carry an internal editorial reason. Zero useful sections is valid only after evaluation. Timeline can use existing material events and appears once in the same rail.

Old excerpt-only caches remain readable while their analysis is reevaluated under the versioned schema. Unsupported optional key facts are dropped individually; they no longer discard valid prose. Missing evaluations or invalid selected sections receive one repair attempt, then an observable unavailable/partial state with retry backoff. Existing cached full article text is used when available, without fetching publishers or exposing the whole contents of roundup containers.

Current-page jobs take priority over look-ahead jobs. Generation runs through a bounded number of workers (two by default), with `analysisStatus`, `generationState`, `analysisReview`, and validation diagnostics on each card's briefing. Completed evaluation is cached for its material state. Mobile and desktop both poll every loaded page so earlier cards can receive completed analysis without reordering the list.

The tab rail is shared by Top and More cards, starts collapsed, allows one open section per card, and scrolls horizontally. Pending/unavailable analysis is distinguished from evaluated stories with no useful additional sections. Verify behavior with `node test/helpers/story-analysis-browser.mjs`; it uses synthetic cards and the real page/application code.
