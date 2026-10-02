import { fileURLToPath } from 'node:url';

// Synchronous browser modules, in dependency order. They are served in the
// existing /script.js response so rssApp exists before deferred Alpine starts.
// No browser imports, extra requests, transpilation or build step are involved.
export const READER_CLIENT_MODULES = [
    'app/component.js',
    'ui/layout.js',
    'feeds/management.js',
    'app/bootstrap.js',
    'feeds/navigation.js',
    'feeds/list.js',
    'smart/top-stories.js',
    'smart/navigation.js',
    'app/server-events.js',
    'feeds/reading-state.js',
    'app/persistence.js',
    'board/cache.js',
    'article/presentation.js',
    'feeds/content-filter.js',
    'ai/status.js',
    'smart/sources.js',
    'ui/diagnostics.js',
    'board/folders.js',
    'article/overlay.js',
    'article/export.js',
    'article/speech.js',
    'article/summary.js',
    'sources/voz-thread.js',
    'ui/tooltips.js',
    'article/embeds.js',
    'article/navigation.js',
    'article/prefetch.js',
    'sources/tinhte.js',
    'sources/ground-news.js',
    'board/view-heartbeat.js',
    'smart/focus-lease.js',
    'smart/viewport-priority.js',
    'sources/voz-lease.js'
].map(name => fileURLToPath(new URL(`../../public/js/${name}`, import.meta.url)));
