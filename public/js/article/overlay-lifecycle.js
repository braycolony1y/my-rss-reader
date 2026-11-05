// The rendered reader belongs to its exit transition until Alpine hides the
// root. Closing invalidates work immediately; only visual state waits.
const ReaderOverlayLifecycle = {
    pending: new WeakMap(),
    generations: new WeakMap(),
    generation(app) { return this.generations.get(app.__readerOwner || app) || 0; },
    cancel(app) {
        ReaderOverlayRequest.cancel(app);
        if (app.overlayProgressInterval) clearInterval(app.overlayProgressInterval);
        app.overlayProgressInterval = null;
        this.pending.get(app.__readerOwner || app)?.disconnect();
        this.pending.delete(app.__readerOwner || app);
        this.generations.set(app.__readerOwner || app, this.generation(app) + 1);
        app.articleOverlayClosing = false;
    },
    close(app, options = {}) {
        if (Object.keys(app.pendingPreferences || {}).some(key => key.startsWith('voz_last_read_post_'))) {
            app.flushUserPreferences().catch(() => {});
        }
        app.releaseArticleReaderSession();
        const closeOptions = options && options.constructor === Object ? options : {};
        if (app.articlePdfState === 'preparing') app.cancelArticlePdf({ silent: true });
        app.stopArticleSpeech();
        if (app.vozScrollRaf) cancelAnimationFrame(app.vozScrollRaf);
        app.vozScrollRaf = 0;
        app.lastVozMeasureAt = 0;
        app.lastTrackedVozPost = '';
        for (const name of ['overlayProgressInterval', 'vozPollingInterval', 'aiSummaryPollTimer', 'vozSummaryPollTimer']) {
            if (app[name]) clearInterval(app[name]);
            app[name] = null;
        }
        app.overlayRequestId = '';
        if (app.articleOverlayStack.length && closeOptions.closeAll !== true) {
            app.restoreArticleOverlay(app.articleOverlayStack.pop(), closeOptions.updateHistory !== false);
            return;
        }
        this.cancel(app);
        ReaderPrefetchLifecycle.cancel(app);
        const generation = this.generation(app);
        const root = document.querySelector?.('.article-overlay-root');
        const panel = root?.querySelector?.('.article-overlay-panel');
        const backdrop = root?.querySelector?.('.article-overlay-backdrop');
        let renderCommitted = !root || typeof app.$nextTick !== 'function';
        const hidden = () => !root || !root.isConnected || (root.style.display === 'none'
            && (!panel || panel.style.display === 'none') && (!backdrop || backdrop.style.display === 'none'));
        const finish = () => {
            if (!renderCommitted || this.generation(app) !== generation || app.articleOverlayOpen || !hidden()) return;
            this.cancel(app);
            this.clear(app);
        };
        if (root && typeof MutationObserver === 'function') {
            const observer = new MutationObserver(finish);
            this.pending.set(app.__readerOwner || app, observer);
            observer.observe(root, { attributes: true, attributeFilter: ['style'] });
            if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['style'] });
            if (backdrop) observer.observe(backdrop, { attributes: true, attributeFilter: ['style'] });
        }
        app.articleOverlayClosing = Boolean(root);
        app.articleOverlayOpen = false;
        app.articleOverlayStack = [];
        if (closeOptions.updateHistory !== false) app.clearArticleRoute(true);
        if (!renderCommitted) app.$nextTick(() => requestAnimationFrame(() => {
            renderCommitted = true;
            finish();
        }));
        finish();
    },
    clear(app) {
        app.overlayContent = null;
        app.overlayPagination = null;
        app.overlayError = null;
        app.overlayFetchStrategy = '';
        app.overlayFetchedFromCache = false;
        app.overlayHasNativeAudio = false;
        app.overlayMethodResults = {};
        app.overlayAttemptedStrategies = [];
        app.overlayRejectedStrategies = [];
        app.overlayMethodPreferences = {};
        app.overlayTryingMethod = false;
        app.overlayMethodError = '';
        app.setArticleCopyState('idle');
        app.overlayProgress = { message: '' };
        app.overlayArticle = null;
        app.isLoadingOverlay = false;
        app.aiSummary = null;
        app.aiSummaryLoading = false;
        app.aiSummaryExpanded = false;
        app.aiSummaryError = null;
        app.vozSummaryProgress = null;
        document.body.style.overflow = app.geminiStatusOpen ? 'hidden' : '';
    },
    restorePosition(app, snapshot) {
        const generation = this.generation(app);
        app.$nextTick(() => {
            if (!app.articleOverlayOpen || this.generation(app) !== generation) return;
            const scroller = document.getElementById('overlay-scroll-container');
            app.hydrateTwitterEmbeds(scroller);
            if (scroller) scroller.scrollTop = snapshot.scrollTop || 0;
        });
    }
};
