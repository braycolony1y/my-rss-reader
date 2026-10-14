// Smart publication identity and asynchronous polling ownership. Membership
// remains server-authoritative; only unambiguous matching cards are reused.
const ReaderSmartRefresh = {
    identity(article) {
        return article.clusterId ? `cluster:${article.clusterId}` : article.link ? `link:${article.link}` : null;
    },
    reconcile(current, incoming) {
        const previous = new Map(), counts = new Map();
        for (const article of current) {
            const key = this.identity(article);
            previous.set(key, previous.has(key) ? null : article);
        }
        for (const article of incoming) {
            const key = this.identity(article);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        return incoming.map(article => {
            const key = this.identity(article), existing = key && counts.get(key) === 1 && previous.get(key);
            return existing ? this.merge(existing, article, false, true) : article;
        });
    },
    merge(article, updated, pushedDuringRequest = false, authoritative = false) {
        const sameMaterial = article.topStory?.material_version === updated.topStory?.material_version;
        const preserve = sameMaterial && (pushedDuringRequest
            || (article.briefing?.analysisStatus === 'evaluated' && updated.briefing?.analysisStatus !== 'evaluated'));
        // Full publications previously replaced the object. Preserve that
        // field-removal behavior (e.g. a removed thumbnail), while polling
        // remains a partial metadata merge.
        if (authoritative) for (const key of Object.keys(article)) {
            if (!Object.prototype.hasOwnProperty.call(updated, key) && !(key === 'briefing' && preserve)) delete article[key];
        }
        return Object.assign(article, preserve ? {...updated, briefing: article.briefing} : updated);
    },
    schedule(app, attempt = 0, delay = 300000) {
        if (app.briefingRefreshTimer) clearTimeout(app.briefingRefreshTimer);
        if (!app.usesTopStories) return;
        const tab = app.selectedFilterValue, token = app.smartViewToken;
        const generation = app.articleRequestGeneration;
        const context = JSON.stringify([app.smartRegion, app.hideRead, app.searchQuery]);
        const current = () => app.usesTopStories && app.selectedFilterValue === tab && app.smartViewToken === token
            && app.articleRequestGeneration === generation && JSON.stringify([app.smartRegion, app.hideRead, app.searchQuery]) === context;
        app.briefingRefreshTimer = setTimeout(async () => {
            if (!current()) return;
            if (document.hidden) { this.schedule(app, attempt, 60000); return; }
            // Compare references after await: a pushed briefing may complete
            // while this older HTTP response is downloading.
            const briefings = new Map(app.articles.map(article => [this.identity(article), article.briefing]));
            try {
                const page = (attempt % Math.max(1, app.currentPage)) + 1;
                const response = await fetch('/api/data?' + new URLSearchParams({filterType: 'smart', filterValue: tab,
                    smartMode: 'top', smartRegion: app.smartRegion, smartView: token, briefingRefresh: '1', page,
                    limit: app.isMobile ? 15 : 40, hideRead: app.hideRead, searchQuery: app.searchQuery || ''}));
                if (!response.ok) throw new Error('Briefing refresh unavailable');
                const latest = await response.json();
                if (!current()) return;
                if (latest.viewReset) app.topUpdatesAvailable = true;
                else {
                    app.rankingPending = latest.rankingPending;
                    app.topUpdatesAvailable = latest.updatesAvailable === true;
                    const byId = new Map((latest.articles || []).map(article => [this.identity(article), article]));
                    for (const article of app.articles) {
                        const key = this.identity(article), updated = byId.get(key);
                        if (!key || !updated) continue;
                        this.merge(article, updated, article.briefing !== briefings.get(key));
                    }
                }
            } catch { /* A failed poll leaves the currently published cards intact. */ }
            // An obsolete completion must not cancel the next destination's timer.
            if (current()) this.schedule(app, attempt + 1);
        }, delay);
    }
};
