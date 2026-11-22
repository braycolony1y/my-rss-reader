// History events may overlap a list download. Only the current route may
// decide which article is open after that download completes.
const ReaderRouteTransition = {
    generations: new WeakMap(),
    async apply(app) {
        const generation = (this.generations.get(app.__readerOwner || app) || 0) + 1;
        this.generations.set(app.__readerOwner || app, generation);
        app.hideTooltip();
        const hash = window.location.hash;
        const route = app.getFilterFromHash();
        if (!route) return;
        if (route.type !== app.selectedFilterType || route.value !== app.selectedFilterValue) {
            app.selectedFilterType = route.type;
            app.selectedFilterValue = route.value;
            if (route.type === 'smart') app.smartRegion = String(route.value).endsWith('_vietnam') ? 'vietnam' : 'global';
            app.currentPage = 1;
            app.hasMore = false;
            app.articles = [];
            await app.fetchData();
        }
        // Smart aliases may have been canonicalized by fetchData(). Compare
        // parsed destinations too, rather than rejecting that valid rewrite.
        const current = app.getFilterFromHash();
        if (this.generations.get(app.__readerOwner || app) !== generation) return;
        if (window.location.hash !== hash && (!current || current.type !== route.type
            || current.value !== route.value || current.articleUrl !== route.articleUrl)) return;
        if (route.articleUrl) await app.openArticleFromRoute(route.articleUrl);
        else if (app.articleOverlayOpen) app.closeArticleOverlay({ updateHistory: false, closeAll: true });
    }
};
