# Board Cache

Each folder has a URL of the form `#board/<encoded folder name>`. Cache is
`#board/cache`; article links retain the folder route.

The Cache rule editor supports enabled/disabled rules, source selection and
editable keyword chips. Any chip can match the title; the source must also
match. Spaces stay inside a phrase. Saving rules never backfills existing
articles. Both RSS and Smart ingestion call the cache observer before publishing
new feed results.

The first rollout seeds `cacheIdentityLedger` with existing article identities.
For an unseen XenForo thread, automatic caching requires the first post's
creation timestamp to be after the ledger's initialization. A feed's bumped
publication date is insufficient. Unknown creation dates are handled
conservatively: the thread is not automatically added. Temporary fetch failures
retain a pending capture for retry. Disabling/deleting its matching rule cancels
that pending capture.

`cacheIdentityLedger.articles` is the discovery ledger, separate from the bounded
`dismissals` collection. Dismissals default to 30 days after last observation;
activity renews that period without making the identity new. The minute job
purges expired dismissals. Set `CACHE_DISMISSAL_RETENTION_DAYS` internally to
change retention. Invalid/non-positive values fall back to 30 days. Known
identities stay known after a dismissal expires, preventing old activity from
being misclassified as a new article.

`cacheMembers` stores membership, article metadata, active caching and auto-add
state. Folder updates atomically preserve unrelated mappings. Turning active
caching off leaves membership and all archives intact. Turning it on schedules
an immediate synchronization. In-flight scans stop before requesting further
pages when paused. Threads do not overlap their next minute job.

Permanent archives live in `article_cache/threads/<sha256(identity)>.json` and
are outside the ordinary page-cache expiration index. Startup imports available
legacy post IDs, original page snapshots and capture timestamps before the
first synchronization. A legacy post without a permanent ID remains in its
original snapshot; no position-derived ID is invented.

Every thread scan freshly discovers pagination and fetches every current page.
Posts are reconciled by canonical thread identity plus permanent post ID. Page,
position and visible number are layout metadata. Missing IDs, failed pages,
changing pagination and unexpected cross-page duplicate IDs make a scan
incomplete: observed edits/new posts are retained, but missing posts are not
marked removed. A complete scan records removal events without deleting posts.
Reappearance restores activity and retains presence history. Content versions
include content, capture/edit timestamps, hash and sequence number. Rendering
sanitizes stored HTML, and comparisons escape content before highlighting.

The ordinary reader serves the permanent archive while the article belongs to
Cache, including paused and removed-source posts. After leaving Cache, the
reader returns to normal source fetching; retained history remains available
through the archive endpoint. Board source links for VOZ open `/unread`, while
archive scans always start from the canonical first page. Version controls appear only for posts with history.
Historical page snapshots remain available separately. No routine cleanup job
removes permanent archives.

Validation: `npm test` includes state-transition, ingestion, migration, routing,
keyword editing, HTTP integration and sanitization checks.

Preference updates share the Cache membership lock so reading-position or theme
saves cannot overwrite auto-added folder mappings. Legacy whole-map saves only
add missing assignments; explicit moves/removals use the folder endpoint.
Reconciliation repairs missing mappings for still-pinned Cache members without
changing their pause state. Missing preferences alone never create dismissals.

Folder mutations accept `compact: true` to return only the changed association
and member status. Unchanged selections do not write or restart a scan. Existing
folder moves preserve Board order and update preferences alone when possible.
Small mutations commit atomically to `database-state.json`; startup replays them
and a later full database write checkpoints them using a revision to prevent
stale replay. Save acknowledgement never waits for article fetching or list
hydration. Cache scans start in the background after a new membership is saved.
The browser applies the association locally, removes rows from the current
Board folder when necessary, and retains loaded pages and scroll position.

Minute scheduling dispatches eligible threads independently. Two shared fetch
slots rotate between pages, rather than being held for a whole thread. A slow
scan cannot block the next tick from refreshing already-completed threads.
The displayed successful-cache time advances only when a complete scan finishes;
network failures or long scans can still make it older than one minute.
