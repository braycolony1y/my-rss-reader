// Cache deletion may finish after the reader closes or changes article. Keep
// the requested deletion, but only its original reader can render the result.
const ReaderOverlayCacheRefresh = {
    async run(app) {
        if (!app.overlayArticle || !app.overlayFetchedFromCache) return;
        if (app.overlayArticle.sourceDeleted) {
            app.overlayMethodError = 'Deleted-source snapshots are protected and cannot be refreshed.';
            return;
        }
        const targetUrl = app.articleReaderUrl(app.overlayArticle);
        if (!targetUrl) return;
        const generation = ReaderOverlayLifecycle.generation(app);
        const current = () => app.articleOverlayOpen && ReaderOverlayLifecycle.generation(app) === generation
            && app.articleReaderUrl(app.overlayArticle) === targetUrl;
        try {
            const response = await fetch('/api/clear-article-cache', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({url: targetUrl})
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw Error(data.error || 'Failed to clear cache.');
            app.articleContentCache?.delete(targetUrl);
            if (!current()) return;
            app.overlayArticle.isCached = false;
            return app.openArticleOverlay(app.overlayArticle);
        } catch (error) {
            if (current()) app.overlayMethodError = error.message;
        }
    }
};
