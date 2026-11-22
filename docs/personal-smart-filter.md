# Personal Smart filters

Implemented for Classic Smart and Smart Top, using the existing article-card template. Ordinary RSS cards have no dislike action. The button is an overlay and does not move the image, headline, fact card, or analysis controls.

## Picker and confirmation

Opening the picker creates an in-memory session only. No request, feedback event, rule, exclusion or filter-log entry is written. Cancel, outside-click, Escape, view changes and abandoned selections discard that session.

The first batch uses a shared deterministic semantic module: cached feedback traits, structured entities, title/excerpt/content already present on the card, and source/category metadata. It generates a larger candidate pool and displays up to six reasons. `None of these` clears selections and rejects the displayed semantic rule identities for that session. Unused candidates replace the previous batch. There is no retry-count limit. Other and None remain available.

When the supported local pool is exhausted, an interactive request may use an existing configured Gemini API or local provider, using only stored article information. Browser/OpenCLI acquisition, embeddings, ranking, and full reprocessing are not invoked. Rejected semantic rules are included in that request. If the provider is unavailable or cannot propose another supported reason, the picker explains this and retains Other, retry and Cancel; it does not manufacture endless reasons or recycle rejected labels. Provider-generated expansion itself has not been live-provider validated; its request/validation path is implemented, while browser tests deliberately avoid external AI calls.

Other first interprets recognized narrow combinations locally, then may use the interactive provider for ambiguity. The displayed interpretation must be explicitly checked before Apply. Unknown interpretations cannot be applied. An explicit “hide all” command is distinct from the default routine-only entity rule.

Only `/api/smart-feedback/apply`, with `confirmed: true` and at least one valid selected rule, creates feedback. It resolves the article from local Smart snapshots. Persistence is serialized, and in-memory state changes only after the durable write succeeds. The picker hides the card only after that response succeeds. Request IDs make Apply retries idempotent.

## Preferences and Undo

The existing `database-state.json` storage owns the `smartPersonalFilters` key; there is no separate database. Version 1 stores:

- Individual confirmed events, selected reasons, rule IDs, exact evidence identities, surface, timestamp, reversal status.
- Compatible merged rules with conjunctive criteria, section scope, strength, active state, contributing event IDs and feedback count.
- Terminal user decisions, with reason, rule, stage, confidence, evidence identity and audit status.
- Compact traits from normal existing AI work, bounded to 20,000 entries.

Dimensions remain separate: entity, topic, story type, angle/quality, source, materiality and same-event repetition. Narrow rules keep materially major developments. Explicit `hide_all_entity` rules honor the deliberately broader command. Source rules affect Smart only. Already-seen feedback uses exact evidence identity, not topic similarity. Changed cluster evidence and changed material versions do not blindly inherit an old exclusion.

Undo removes that event's rule contribution and exact exclusion, disables rules with no remaining evidence, restores the local card when available, and marks affected log decisions inactive. Disabling/deleting a preference similarly invalidates its terminal decisions. Smart view/cache signatures include rule changes so cached filtered views do not defeat reversal.

## Filter pipeline and AI cost

Personal matching is separate from the unchanged `news_vietnam` and `tech_vietnam` editorial policies. It runs at source-work, pre-embedding, pre-ranking, cached-view, publication and briefing boundaries. Known terminal decisions are indexed; later stages bind/read terminal state rather than repeating rule evaluation. Exact evidence reuses confirmed feedback without fuzzy-title or containment heuristics. Candidate batches persist decisions per section. Raw article stores remain available.

Normal verification/editorial requests may append compact `feedbackTraits` and `userPreferenceMatch` output. No new automatic request is scheduled. Personal AI matches require high confidence and validated rule constraints/materiality; missing, ambiguous, or malformed optional output fails open. A complete primary response survives a truncated optional tail without a repair request caused by that tail.

The full-refresh fixture measured **3 automatic requests before and 3 after**. Surviving clusters/ranking data are unchanged in that comparison. This is controlled runtime evidence, not a claim about an observed production-wide billing window.

## System Monitor

Source Stats, Fetch History, Error Log, Pause/Resume Sync, Refresh, Close and the existing status footer remain. The modal uses the existing Edit Source light-glass visual palette: near-white translucency, blur, saturation, white inner edge, soft separators and shadows. Tabs scroll horizontally on small screens; tables scroll internally.

Filtered shows real user and system exclusions, newest first, with All/User/System filters, search, paging, human-readable reasons, source, section, stage and expandable rule/evidence details. Reverted decisions are visibly inactive. Personal preferences can be inspected, disabled or deleted; user controls cannot alter system editorial policy. Picker browsing and rejected suggestions do not enter this log. System rows use the existing persisted terminal records, including older records where only title/URL are available. User decision history is bounded to 20,000 rows; existing system history retains its existing 30-day/20,000-record policy.

## Validation

- Latest focused checks: 24/24 (16 personal-filter tests, four original module contracts, four full-runtime prefilter tests).
- Combined personal/editorial policy checks: 100/100 before the final three personal edge-case tests were added.
- Full `npm test` run: 688/690. The HTTP isolation timeout and snapshot material-update assertion both passed in a separate 14/14 rerun. The full suite was not rerun after the last small hardening changes; focused checks cover those changes.
- Browser fixture uses the composed production HTML, client modules and styles, plus actual Apply/Undo/log routes backed by an isolated in-memory database. Verified open-only, Cancel, Escape, outside-click, selection without Apply, None five times, Apply, hide and Undo.
- Chromium picker bounds verified at 320, 375, 390, 430, 844 and 1440px without horizontal overflow. Desktop and mobile monitor previews captured. No browser JavaScript errors in this run. WebKit was not exercised.
- CSS rebuilt and stylesheet cache buster updated. JavaScript syntax and import graph checks run.
- Production restart completed after explicit user approval. The service is active/running; health, reader page and client script return HTTP 200. No production feedback was created during browser verification.

## Files

New implementation modules:

- `src/smart/feedback/semantics.js`, `store.js`, `terminal.js`, `pipeline.js`, `ai.js`, `interactive.js`, `log-metadata.js`, `log.js`, `routes.js`
- `public/js/smart/feedback-semantics.js`, `feedback-picker.js`
- `public/js/ui/filter-log.js`
- `public/components/smart/feedback-button.html`, `feedback-picker.html`
- `public/components/modals/filter-log.html`
- `public/styles/smart/feedback.css`

Scoped integration changes:

- `src/app.js`, `src/database/store.js`, `src/routes/data-routes.js`, `src/articles/presentation.js`
- `src/smart/articles/normalize.js`, `src/smart/prefilter/{state,boundaries,source-work,publication,ai}.js`
- `src/ui/{reader-partials,reader-assets,client-modules}.js`
- `script.js`, `index.html`, compiled `public/styles.css`
- `public/components/article-card.html`, `public/components/modals/logs.html`, `public/js/ui/diagnostics.js`

Tests: `test/smart-personal-filter.test.js`, `test/helpers/personal-filter-browser.mjs`; existing snapshot/prefilter contracts updated for the independent personal state/side task. The root-layout test recognizes the environment-provided read-only `.aws` directory.

Previews and measurements: `test/fixtures/generated/personal-filter/`.

## Regeneration recovery (2026-10-05)

The reported Hồ Quốc Dũng story exhausted its four local reasons. The optional AI path had a provider timeout but no overall deadline covering the global queue, allowing the picker to remain busy indefinitely. A live reproduction returned no response within 12 seconds.

- `src/smart/feedback/request-budget.js` bounds queue and provider work together to eight seconds. Expired or cancelled queued callbacks cannot start provider requests. Busy local compute and cooling API keys are skipped; provider deferrals do not requeue an interactive picker.
- The client has a separate 12-second transport deadline. Other and Cancel remain available during suggestions; opening Other cancels the request, and stale responses cannot overwrite the user's text. These operations do not persist feedback.
- Suggestions return a clear retry/Other fallback when unavailable or exhausted. An in-flight provider operation may finish under its existing internal timeout; this does not keep the picker waiting or save a preference.
- After the approved service restart, the exact reported live request returned HTTP 200 with the timeout fallback in 8.03 seconds. Health, page, and composed client script passed live checks.
- Focused feedback tests: 25/25 passed. Chromium verified stalled transport recovery, Other/Cancel, Apply/Undo, and layout at 320, 375, 390, 430, 844, and 1440 pixels, with no overflow or page errors. Recovery screenshots are in `test/fixtures/generated/personal-filter/`.
- Full suite: 700/702 passed. The HTTP runtime startup test exceeded its 30-second limit both in the suite and in isolation; the live service remains healthy. The other failure concerns material-update snapshot timing; its isolated test file subsequently passed 13/13.
