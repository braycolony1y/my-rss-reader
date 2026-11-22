// Own cancellation, not scheduling: the existing prefetch queue keeps its order.
// Foreground navigation must release speculative connections, including bodies
// still downloading after their response headers have arrived.
const ReaderPrefetchLifecycle = (() => {
    const active = new WeakMap();
    const owner = app => globalThis.Alpine?.raw ? Alpine.raw(app) : app;
    return {
        async read(app, url) {
            if (app.isLoadingArticles || (app.articleOverlayOpen && app.isLoadingOverlay)) return null;
            const key = owner(app), controller = new AbortController();
            let requests = active.get(key);
            if (!requests) { requests = new Set(); active.set(key, requests); }
            requests.add(controller);
            try {
                const response = await fetch(url, { signal: controller.signal, priority: 'low' });
                const result = response.ok ? await response.json() : null;
                return controller.signal.aborted ? null : result;
            } finally {
                requests.delete(controller);
                if (!requests.size) active.delete(key);
            }
        },
        cancel(app) {
            const key = owner(app);
            for (const request of active.get(key) || []) request.abort();
            app.prefetchQueue = [];
            app.hoveredArticleUrl = null;
            for (const timer of Object.values(app.hoverPrefetchTimeouts || {})) clearTimeout(timer);
            app.hoverPrefetchTimeouts = {};
        }
    };
})();
