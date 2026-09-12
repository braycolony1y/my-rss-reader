# Per-tab Top stories

Smart uses the existing sources, categories, 72-hour candidate window, multilingual
E5 embeddings, HNSW matching, event-conflict gates, and AI verification. No sources
are added by this change.

## Refresh recovery

Status polling no longer resets the foreground HTTP idle clock. Background waits
have a 30-second ceiling so an open reader cannot starve ingestion or clustering.
Before embedding, a conservative lexical pass publishes current clusters using
existing memberships and strict event gates. Multilingual matching and AI review
then refine that snapshot. Only active historical clusters enter the matching
worker. Embeddings checkpoint every 30 seconds and the cache accommodates the
active candidate set, allowing interrupted refreshes to resume.

## Ranking and presentation

Each existing Smart tab has an independent Top stories / Classic switch, saved
under `userPreferences.smartTabModes`. Top stories is the default; Classic shows
the same ranked cluster feed with compact source excerpts. Every story in Top
stories uses the shared article card with a cluster briefing. There is no top-five
split or secondary More stories feed. Mode changes render immediately; preference
writes run in order in the background. Briefings are prepared for each viewed page,
with cached results and clearly labelled source excerpts available immediately.
No mixed global briefing is produced.
Rankings combine importance (36%), tab relevance (12%), freshness (22%), material
developments (12%), source authority (10%), and capped corroboration (8%), with
repeat/minor-content penalties and age decay. Identical headline reprints do not
renew freshness. There is no single-source ceiling. Publisher counts estimate
independence; they do not establish separate ownership or reporting provenance.

A bounded background assessment of 48 candidate clusters per viewed tab refines
importance, materiality, and repetition using the existing summary model. The
heuristic ranking is available immediately if that provider fails. Generated
scores and briefings are cached in `storyBriefings` in the existing Smart store.
No new service or schema migration is required.

Top cards include source links, citations, available images, score, publisher
count, and latest coverage time. The AI receives only cluster articles, with
publisher-balanced context limited to 16 articles. It must omit unsupported
analysis. Citation IDs and exact supporting excerpts are validated; figures must
occur in those excerpts. This validation does not independently prove every
semantic inference. Provider errors or rejected output show clearly labelled
source excerpts, never fabricated fallback analysis.

Revisions include member links, titles and content. Changed evidence invalidates
cached prose. Overlapping clusters retain identity across refreshes; splits cannot
reuse the same ID twice. Read state does not hide an unread development in an
otherwise read cluster. Hidden/blocked sources are removed from briefing evidence.

Each cluster appears once; member articles remain inside its coverage.
A bounded 30-minute view snapshot keeps pagination stable while AI
scores or ingestion change. A refresh opens a new view. Background briefing polls
update only briefing content, preserving membership and order. Existing Saved, Recently Read and Board hydration remains intact.

## Validation

Run `npm test` (the HTTP smoke test requires local socket access), then
`npm run build:css`. Update the stylesheet/script cache version after UI changes.
Restart `rss-reader.service` after backend changes. Tests cover idle starvation,
early grouping, scoring, citation rejection, evidence updates, stable identity,
per-tab modes, source filtering, and pagination without duplicate clusters.

## Primary AI provider

Antigravity CLI (`~/.local/bin/agy-real`, installed version 1.2.2) is the primary
provider for ranking, briefings, summaries, source assessment, and cluster AI
verification. The default CLI model is `gemini-3.8-flash-low`, confirmed against
its authenticated model list. Direct Gemini API keys are the backup; existing
Gemini model preferences control that backup order. Local embedding/HNSW work
continues independently.

Override `ANTIGRAVITY_CLI_PATH` or `ANTIGRAVITY_MODEL` if needed; setting
`ANTIGRAVITY_ENABLED=false` immediately selects the API path after restart. The
CLI uses a fresh temporary directory, bounded execution time, sandbox mode, no
slash-command expansion, and no auto-approval flags. Application API keys are
not forwarded to the CLI subprocess. Failures, invalid JSON, cooldowns, and busy
CLI capacity fall back to Gemini. The existing AI activity report records the
actual provider and token usage without prompts or credentials.
