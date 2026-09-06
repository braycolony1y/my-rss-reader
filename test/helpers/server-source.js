import { readFileSync } from 'node:fs';

// Existing source guards span responsibilities that formerly lived in server.js.
// Read the actual modules; behavioral tests cover the injected service interfaces.
const modulePaths = [
    "server.js",
    "src/app.js",
    "src/utils/article-utils.js",
    "src/articles/markup.js",
    "src/articles/reader-markdown.js",
    "src/feeds/source-parsers.js",
    "src/articles/source-results.js",
    "src/config.js",
    "src/process-lifecycle.js",
    "src/http.js",
    "src/feeds/parser-worker.js",
    "src/database/store.js",
    "src/observability/logs.js",
    "src/ai/settings.js",
    "src/articles/cache.js",
    "src/articles/readers.js",
    "src/articles/images.js",
    "src/feeds/sync.js",
    "src/filters/content-filter.js",
    "src/routes/content-filter-routes.js",
    "src/articles/google-news.js",
    "src/articles/presentation.js",
    "src/articles/fetch-policy.js",
    "src/articles/progress.js",
    "src/articles/pipeline.js",
    "src/feeds/prefetch.js",
    "src/middleware/auth.js",
    "src/routes/diagnostic-routes.js",
    "src/routes/smart-routes.js",
    "src/routes/data-routes.js",
    "src/routes/feed-routes.js",
    "src/routes/ai-routes.js",
    "src/routes/settings-routes.js",
    "src/routes/summary-routes.js",
    "src/routes/media-routes.js",
    "src/routes/page-routes.js",
    "src/articles/search-destination.js",
    "src/routes/article-routes.js",
    "src/articles/archives.js",
    "src/articles/parser.js",
    "src/jobs/startup.js"
];

export function readServerSource() {
    return modulePaths.map(file => readFileSync(new URL('../../' + file, import.meta.url), 'utf8')
        .replace(/^ {4}/gm, '')).join('\n');
}
