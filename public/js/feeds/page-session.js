// One sequence per mobile filter context. Only accepted responses commit seen
// identities; page revisits request their original membership in original order.
const ReaderFeedPageSession = {
    sessions: new WeakMap(),
    owner(app) { return app.__readerOwner || app; },
    context(app) {
        return JSON.stringify([app.selectedFilterType, app.selectedFilterValue || '', Boolean(app.hideRead), app.searchQuery || '', 15]);
    },
    enabled(app) { return app.isMobile && ['category', 'feed'].includes(app.selectedFilterType); },
    key(article) {
        if (article.feedPageKey) return article.feedPageKey;
        const link = article.link || article.originalLink || '';
        // Migration for pre-protocol cached cards; new cards use server keys.
        try {
            const url = new URL(link);
            const thread = /^(?:www\.)?voz\.vn$/i.test(url.hostname)
                && url.pathname.match(/^\/(?:t|threads)\/(?:[^/]*\.)?(\d+)(?:\/|$)/i);
            if (thread) return `voz:${thread[1]}`;
        } catch {}
        return `link:${link}`;
    },
    session(app) {
        const session = this.sessions.get(this.owner(app));
        return session?.context === this.context(app) ? session : null;
    },
    capture(app) {
        if (!this.enabled(app) || !app.articles.length) return;
        let session = this.session(app);
        if (!session) {
            session = { context: this.context(app), pages: new Map() };
            this.sessions.set(this.owner(app), session);
        }
        // Capture legacy/restored pages before goToPage advances the cursor.
        if (!session.pages.get(app.currentPage)?.length) {
            session.pages.set(app.currentPage, app.articles.map(article => this.key(article)));
        }
    },
    begin(app, isLoadMore, skipPageReset, keepVisible) {
        if (!this.enabled(app) || isLoadMore) {
            this.sessions.delete(this.owner(app));
            return null;
        }
        if (keepVisible) this.capture(app);
        const reset = !skipPageReset && !keepVisible;
        const session = !reset && this.session(app) || { context: this.context(app), pages: new Map() };
        const page = reset ? 1 : app.currentPage;
        const storedKeys = session.pages.get(page);
        const keys = storedKeys?.length ? storedKeys : undefined;
        return { session, page, reset, previousPage: app.currentPage, previousArticles: app.articles, previousHasMore: app.hasMore,
            keepVisible: keepVisible && app.articles.length > 0, keys,
            body: { seenArticleKeys: [...new Set([...session.pages.values()].flat())],
                ...(keys ? { pageArticleKeys: keys } : {}) } };
    },
    request(params, transaction, options) {
        if (!transaction) return options;
        params.set('feedPageMode', 'unseen');
        return { ...options, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(transaction.body) };
    },
    accept(app, transaction, data) {
        if (!transaction || data.feedPageMode !== 'unseen') return;
        const { session, page } = transaction;
        if (!transaction.keepVisible && !transaction.keys) {
            session.pages.set(page, app.articles.map(article => this.key(article)));
        }
        this.sessions.set(this.owner(app), session);
        app.hasMore = session.pages.has(page + 1) || data.hasMore === true;
    },
    exhausted(app, transaction, data) {
        if (!transaction || transaction.keys || transaction.page <= 1 || data.feedPageMode !== 'unseen'
            || data.articles?.length || data.hasMore) return false;
        app.hasMore = false;
        return true;
    },
    rollback(app, transaction) {
        if (!transaction?.reset) return;
        app.currentPage = transaction.previousPage;
        app.articles = transaction.previousArticles;
        app.hasMore = transaction.previousHasMore;
    },
    snapshot(app) {
        const session = this.enabled(app) && this.session(app);
        return session ? { version: 1, context: session.context, pages: [...session.pages] } : undefined;
    },
    restore(app, saved) {
        if (!this.enabled(app) || saved?.version !== 1 || saved.context !== this.context(app) || !Array.isArray(saved.pages)) return;
        const pages = new Map();
        for (const entry of saved.pages) {
            if (!Array.isArray(entry) || !Number.isInteger(entry[0]) || entry[0] < 1 || !Array.isArray(entry[1])
                || entry[1].length > 15 || entry[1].some(key => typeof key !== 'string')) return;
            pages.set(entry[0], entry[1]);
        }
        this.sessions.set(this.owner(app), { context: saved.context, pages });
    }
};
