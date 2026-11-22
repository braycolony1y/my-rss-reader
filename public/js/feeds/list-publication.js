// Retain only a publication for the exact filter context. A refresh still
// applies authoritative membership/order, reusing unambiguous article objects.
const ReaderListPublication = {
    contexts: new WeakMap(),
    context(app) {
        return JSON.stringify([app.selectedFilterType, app.selectedFilterValue || '',
            Boolean(app.hideRead), app.searchQuery || '']);
    },
    retains(app) {
        return app.articles.length > 0 && this.contexts.get(app.__readerOwner || app) === this.context(app);
    },
    commit(app) { this.contexts.set(app.__readerOwner || app, this.context(app)); this.remember(app); },
    // Re-entering a tab paints its first page immediately. The normal request
    // then applies authoritative membership/order while retaining row identity.
    snapshots: new Map(),
    snapshotContext(app) {
        return JSON.stringify([this.context(app), app.selectedFilterType === 'smart' ? app.smartRegion || '' : '', Boolean(app.isMobile)]);
    },
    stateSignature(app) {
        // Read/hidden Sets are mutated locally, so identity alone is insufficient.
        // Keep global state out of snapshots and reject any changed filter state.
        return JSON.stringify([
            [...(app.readStates || [])], [...(app.pendingReadLinks || [])], [...(app.pendingUnreadLinks || [])],
            [...(app.hiddenStates || [])], [...(app.savedStates || [])], [...(app.boardStates || [])],
            app.blockedKeywords || [], app.feeds || [], app.recentReadAt || {},
            app.userPreferences?.boardFolderMappings || {}
        ]);
    },
    remember(app) {
        if (app.currentPage !== 1 || !app.articles.length) return;
        const key = this.snapshotContext(app);
        this.snapshots.delete(key);
        this.snapshots.set(key, { at: Date.now(), state: this.stateSignature(app),
            articles: app.articles.slice(0, app.isMobile ? 15 : 40), hasMore: app.hasMore });
        while (this.snapshots.size > 8) this.snapshots.delete(this.snapshots.keys().next().value);
    },
    restore(app) {
        const key = this.snapshotContext(app), snapshot = this.snapshots.get(key);
        if (!snapshot || Date.now() - snapshot.at > 60000 || snapshot.state !== this.stateSignature(app)) return false;
        app.articles = snapshot.articles.slice();
        app.hasMore = snapshot.hasMore;
        this.contexts.set(app.__readerOwner || app, this.context(app));
        return true;
    },
    reconcile(current, incoming) {
        const identity = article => article.clusterId ? `cluster:${article.clusterId}`
            : article.link ? `link:${article.link}` : null;
        const previous = new Map(), counts = new Map();
        for (const article of current) {
            const key = identity(article);
            previous.set(key, previous.has(key) ? null : article);
        }
        for (const article of incoming) {
            const key = identity(article);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        return incoming.map(article => {
            const key = identity(article), existing = key && counts.get(key) === 1 && previous.get(key);
            if (!existing) return article;
            for (const field of Object.keys(existing)) {
                if (!Object.prototype.hasOwnProperty.call(article, field)) delete existing[field];
            }
            return Object.assign(existing, article);
        });
    }
};
