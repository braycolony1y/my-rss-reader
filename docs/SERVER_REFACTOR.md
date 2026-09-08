# Server responsibility refactor

The previous `server.js` contained 8,244 lines spanning 142 named functions and 56 HTTP endpoints. Persistence, article extraction, archives, feed ingestion, HTTP handlers, and startup timing shared one lexical scope. Changes to any subsystem required navigating unrelated code and reasoning about state scattered throughout the file.

`server.js` is now a 22-line entry point. It preserves the 15 existing parsing exports, detects direct execution using the same entry-file comparison, constructs the application, and binds HTTP before starting background work. `src/app.js` constructs and connects one instance of each service. Existing source adapters, Smart News, summary engine, feed worker, and media normalization modules remain in place.

## File ownership

| File or directory | Responsibility |
| --- | --- |
| `server.js` | Compatibility exports, direct-execution detection, HTTP binding, startup handoff. |
| `src/app.js` | Explicit service construction, dependency wiring, route registration. |
| `src/config.js` | The same dotenv order and Gemini override, port, proxy/header defaults, clustering-model configuration, child-process helper. |
| `src/http.js` | Express setup, JSON/static middleware, API cache headers, HTTP activity timestamp, idle waiting and idle-aware GC logging. |
| `src/process-lifecycle.js` | Original process start timestamp, fatal-error logging, delayed exit on uncaught exception, rejection logging. |
| `src/database/store.js` | Writer lock and exit release, in-memory database, parsed-value cache, serialized mutations, atomic writes, migrations, Smart-data separation, backups and recovery. |
| `src/observability/logs.js` | Console capture, 24-hour log/fetch history buffers, pruning. |
| `src/ai/settings.js` | Journal/report fallback, Gemini key validation, private atomic key writes, serialized activation. |
| `src/utils/article-utils.js` | Article/state URL identity, normalized collections, bounded mapping, HTML escaping, image metadata and publisher icons. |
| `src/articles/source-results.js` | Source-specific cache cleanup/enhancement and result validation. |
| `src/articles/markup.js` | HTML candidate selection/scoring, balanced extraction, markup cleanup and challenge detection. |
| `src/articles/reader-markdown.js` | Jina/OpenCLI Markdown parsing, metadata extraction, navigation trimming and HTML rendering. |
| `src/articles/search-destination.js` | Pure Google News URL predicates and OpenCLI search-result parsing. |
| `src/articles/google-news.js` | Decoder instance, destination cache, pending lookups, persistence timer, lookup fallbacks and Smart destination preparation. |
| `src/articles/cache.js` | Article files/index, TTL/version checks, archive retention, validation before replacement, cleanup. |
| `src/articles/readers.js` | Direct/cookie, proxy, Jina and OpenCLI transport, verification-session callback, response-body disposal. |
| `src/articles/images.js` | Best-image fallback, bounded eager image queue and PDF creation-date fetching. |
| `src/articles/fetch-policy.js` | Strict source policies, adaptive scores/preferences, score persistence and feed/Smart policy reconciliation. |
| `src/articles/progress.js` | Reader sessions, progress records and the foreground-request count shared with prefetch. |
| `src/articles/parser.js` | HTML-to-article pipeline, audio discovery, source hooks, extraction fallback, media placement and sanitization. |
| `src/articles/pipeline.js` | Background strategy dispatch and aggregate/primary-article expansion. |
| `src/articles/presentation.js` | Client-card preparation, Smart view/version history, unavailable-source mutation chain and Smart response preparation. |
| `src/articles/archives.js` | Deleted-source snapshots, independent deletion evidence rules, VOZ page inventory, crawling, next-page prefetch and background refresh state. |
| `src/feeds/parser-worker.js` | One lazy parser worker, request IDs, pending requests and worker failure handling. |
| `src/feeds/source-parsers.js` | Existing Morningstar, UOB, Techcombank and Bao Moi parsers. The existing root RSS parser remains shared with the worker. |
| `src/feeds/sync.js` | Feed ingestion and reconciliation, source-specific feed fetching, VOZ view scraping, manual progress, pause state and sequential sync loop. |
| `src/feeds/prefetch.js` | Serialized OpenCLI ingestion prefetch, next-five cancellation identity, universal target computation and prefetch guard. |
| `src/filters/content-filter.js` | Keyword normalization, matching and preview identity/detail helpers. |
| `src/middleware/auth.js` | Original cookie-based authentication middleware. |
| `src/jobs/startup.js` | Original policy initialization timer, staggered boot, cache/prefetch intervals and VOZ cron registration. |
| `src/routes/article-routes.js` | Reader/content, progress/session, preference, cache-clear and debug HTTP endpoints. |
| `src/routes/data-routes.js` | Feed/list filtering, pagination, saved/read/board hydration and Smart dispatch. |
| `src/routes/feed-routes.js` | Manual sync, feed management and category ordering. |
| `src/routes/smart-routes.js` | Smart source management, discovery, settings, status and manual sync. |
| `src/routes/ai-routes.js` | Gemini status/key addition and online-AI usage responses. |
| `src/routes/summary-routes.js` | Summary/analysis endpoints and VOZ summary job state. |
| `src/routes/settings-routes.js` | Preferences and individual/batch state changes. |
| `src/routes/content-filter-routes.js` | Keyword settings and preview responses, including the existing 30-second preview cache. |
| `src/routes/diagnostic-routes.js` | Health/login/ping, logs/history, sync progress and pause/status. |
| `src/routes/media-routes.js` | Image proxy, X profile images and article-image redirects. |
| `src/routes/page-routes.js` | HTML shell and frontend script serving with existing cache headers. |

## Dependency and state decisions

Pure modules import other pure modules and existing adapters. Stateful services receive the database, functions, and necessary owner objects explicitly; no service imports `server.js` or `src/app.js`. A single deferred callback connects Smart News ingestion to the prefetch service created later in application construction. This avoids circular imports without introducing a generic state container.

Mutable primitive values that cross boundaries remain accessor-backed properties of their responsible service: HTTP activity, foreground reader count, sync pause/completion time, destination-cache initialization, cache-index initialization, and Smart version history. Consumers therefore see current values instead of capturing stale destructured copies. Existing `summaryQueue`, `geminiKeyManager`, and source-registry singletons are reused.

Construct one application per process, as the entry point does. Console/process handlers and the existing summary/Smart singletons retain their process lifetime. Small service factories support isolated tests; they do not imply support for multiple production application instances in one process.

## Preserved operational behavior

HTTP still binds before heavy background work. The zero-delay source-policy reconciliation remains part of construction, as before. After binding:

| Phase | Delay from listening |
| --- | --- |
| Cache housekeeping, preference loading, sequential RSS loop | Immediate |
| Smart News engine start | 30 seconds |
| Smart source sync loop | 45 seconds |
| Universal prefetch | 60 seconds |
| Summary queue | 90 seconds |

The Smart engine's own internal 2.5-second initial delay remains unchanged. Hourly article-cache cleanup, 30-minute universal prefetch, every-minute VOZ cron, ten-minute minimum RSS cycles, HTTP-idle checks and all crawl/reader delays remain unchanged.

Article cache version remains **54**, with seven-day normal reads and 14-day last-known retention cleanup. Saved/board snapshots remain protected except that confirmed-deleted snapshots expire 14 days after detection. Dedicated Cache archives expire 14 days after leaving Cache. Ordinary article deletion still requires independent reader confirmation; VOZ preserves page-specific archives. Strict per-source methods, challenge detection, reader fallback order, response-body handling, authentication, status codes and database string/JSON formats are unchanged. No dependency was added.

Shutdown retains the original process/systemd behavior and database lock-release handler. The existing Smart source loops expose no complete cancellation API. Adding one would require a separate lifecycle change; this refactor does not claim graceful cancellation or flushing that the original implementation did not provide.

## Verification

- Baseline existing suite passed before extraction.
- Focused feed/parser/publisher tests passed after the independent parsing extraction.
- Syntax checks cover the entry point and every extracted module; no configured lint/type-check command exists.
- AST comparison against the pre-refactor snapshot confirmed all 142 named function implementations and all 56 endpoint handlers match after normalizing explicit state-owner access and object shorthand.
- The extracted ESM dependency graph has no circular imports; relative imports and worker URL resolution were checked.
- Existing source guards now read the extracted modules through `test/helpers/server-source.js`; the original assertions remain, with two assertions adapted to the explicit Smart helper wiring.
- `test/server-services.test.js` exercises concurrent persistence, clone isolation, destructive-write rejection, invalid atomic writes, recovery, Smart-data separation, cache reuse/expiry, archive protection and exact startup schedules.
- `test/server-http.test.js` starts a real HTTP listener with an isolated temporary database and mocked publisher transport. It exercises authentication, Feed/Smart data, saved raw Smart hydration, full reader fetching, cache reuse, content filtering, RSS worker sync/progress, shared pause state and disk persistence.
- Full suite: **194 tests passed**, with no failures. The HTTP test requires permission to bind a localhost socket in restricted sandboxes.
- A live article cache read returned HTTP 200; a real publisher refresh through its configured Cloudflare method returned article content, and the following request was served from cache.
- With explicit user approval, restarted `rss-reader.service`; it bound port 3000, remained active, and logged all five startup phases through the 90-second summary phase. Its first real RSS cycle processed 47 feeds and completed in 35 seconds. Live health, Feed data, Smart data/status, content-filter settings and sync-status endpoints returned HTTP 200; startup showed no fatal exception or unhandled rejection.

## Git preservation

The live checkout was on `main` at `96df55b` with 29 tracked modifications, 404 tracked deletions and new source/tests/documentation. Its historical tracked key file differs from the sanitized public backup history. No original working-tree change or local history was reset, cleaned or discarded.

The verified remote `main` was `3ec710b35d37ff7d072a6fa7de52d6b137a524a2`. A separate checkout based on that sanitized history captured all 124 current source/configuration/test files while excluding credentials and runtime data. Backup commit **`3b2a1fa85f3df367325e3cde8509e42d54afb27e`**, titled `backup before server.js refactor`, was pushed and verified on **`codex/server-responsibility-refactor`** before any project file was modified. The refactor is recorded separately from that backup; neither remote `main` nor the original backup is overwritten.

## Deliberately deferred work

Some HTTP handlers still contain substantial orchestration, especially article-content and list filtering. Feed synchronization retains its large, tightly coupled source-fetch/merge flow. Moving those algorithms mechanically preserves behavior; redesigning them into smaller operations should be a separately tested change.

The original Google News fallback references `decodeGoogleNewsOriginalUrl`, which is not defined in this project; that failure remains caught before later fallbacks. Existing unused helpers, including recovery/lookup helpers, were retained rather than silently removed. Importing `server.js` still constructs the application and schedules policy reconciliation, matching its prior behavior; integrations needing only parsers can import the pure parsing modules directly.
