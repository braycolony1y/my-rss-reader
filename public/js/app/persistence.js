// Owns app / persistence on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderAppPersistence = {
    create() {
        return {
                pendingPreferences: {}, 
                userPreferences: {},
                lastSavedScrollY: 0,
                saveState() {
                    // Persistence is a read-only snapshot, not a reactive consumer.
                    // Walking thousands of history/preferences fields through Alpine
                    // proxies adds tracking and wrapper work to every article click.
                    const raw = value => window.Alpine?.raw?.(value) || value;
                    const app = this;
                    if (!app.isLoggedIn || !app.articles.length) return;

                    const sc = document.getElementById('scroll-container');
                    if (sc) app.lastSavedScrollY = sc.scrollTop;

                    const compactArticle = (article, includeRelated = true) => {
                        const compact = {};
                        const fields = [
                            'id', 'guid', 'articleKey', 'title', 'link', 'originalLink',
                            'pubDate', 'createDate', 'publicationTimeReliable', 'description',
                            'image', 'imageUrl', 'feedTitle', 'feedIcon', 'feedUrl',
                            'feedCategory', 'smartCategory', 'siteName', 'sourceWeight',
                            'region', 'language', 'domain', 'isCluster', 'clusterId',
                            'clusterCount', 'sourceCount', 'sources', 'hotness',
                            'aiClustered', 'replyCount', 'viewCount', 'vozSummary'
                        ];
                        for (const field of fields) {
                            if (article?.[field] !== undefined) compact[field] = article[field];
                        }
                        if (app.usesTopStories && article?.topStory) {
                            compact.topStory = { rank:article.topStory.rank, isTop:article.topStory.isTop, feed:article.topStory.feed, timeline:article.topStory.timeline, conflicts:article.topStory.conflicts, latest_material_update:article.topStory.latest_material_update };
                            compact.briefing = article.briefing;
                            compact.imageCandidates = article.imageCandidates;
                        }
                        compact.content = String(article?.content || '').slice(0, includeRelated ? 300 : 160);
                        if (includeRelated && Array.isArray(article?.relatedArticles)) {
                            compact.relatedArticles = article.relatedArticles
                                .slice(0, 30)
                                .map(related => compactArticle(related, false));
                        }
                        return compact;
                    };

                    const state = {
                        feeds: app.feeds,
                        articles: raw(app.articles).map(article => compactArticle(raw(article))),
                        readStates: Array.from(app.readStates),
                        recentReadAt: app.recentReadAt,
                        pendingReadLinks: Array.from(app.pendingReadLinks),
                        pendingUnreadLinks: Array.from(app.pendingUnreadLinks),
                        pendingRecentReadLinks: Array.from(app.pendingRecentReadLinks),
                        pendingStateMutations: app.pendingStateMutations,
                        savedStates: app.savedStates,
                        boardStates: app.boardStates,
                        hiddenStates: app.hiddenStates,
                        userPreferences: app.userPreferences,
                        pendingPreferences: app.pendingPreferences,
                        categoryOrder: app.categoryOrder,
                        unreadCounts: app.unreadCounts,
                        smartClusterVersion: app.smartClusterVersion,
                        smartRegion: app.smartRegion,
                        selectedFilterType: app.selectedFilterType,
                        selectedFilterValue: app.selectedFilterValue,
                        currentPage: app.currentPage,
                        hasMore: app.hasMore,
                        expandedCategories: app.expandedCategories,
                        scrollY: sc ? sc.scrollTop : (app.lastSavedScrollY || 0),
                        savedAt: Date.now()
                    };

                    for (const key of Object.keys(state)) state[key] = raw(state[key]);

                    let json;
                    try {
                        json = JSON.stringify(state);
                    } catch (e) {
                        return;
                    }

                    const ultraCompactJson = () => JSON.stringify({
                        ...state,
                        articles: state.articles.slice(0, 20).map(article => ({
                            ...article,
                            content: '',
                            relatedArticles: undefined
                        }))
                    });

                    for (const storage of [sessionStorage, localStorage]) {
                        try {
                            storage.setItem('rssAppState', json);
                        } catch (e) {
                            try { storage.setItem('rssAppState', ultraCompactJson()); } catch (e2) { }
                        }
                    }
                },

                syncUserPreferenceDebounced(key, value) {
                    if (!this.syncPrefsTimer) this.syncPrefsTimer = {};
                    // Skip string comparison for objects/arrays to ensure they sync
                    if (typeof value !== 'object' && String(this.userPreferences[key] ?? '') === String(value ?? '')) return;
                    clearTimeout(this.syncPrefsTimer[key]);
                    this.userPreferences[key] = value;
                    try { localStorage.setItem(key, value); } catch(e) {}
                    
                    this.pendingPreferences[key] = value;
                    this.syncPrefsTimer[key] = setTimeout(() => this.flushUserPreferences(), 500);
                },

                async flushUserPreferences() {
                    await Promise.all(Object.entries(this.pendingPreferences).filter(([key]) => key !== 'smartTabModes').map(async ([key, value]) => {
                        clearTimeout(this.syncPrefsTimer?.[key]);
                        try {
                            const res = await fetch('/api/user-preferences', {
                                method: 'POST', keepalive: true,
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ key, value })
                            });
                            if (res.ok && this.pendingPreferences[key] === value) {
                                let returned = null;
                                try { returned = await res.json(); } catch {}
                                delete this.pendingPreferences[key];
                                if (returned && Object.prototype.hasOwnProperty.call(returned, 'value')) {
                                    this.userPreferences = { ...this.userPreferences, [key]: returned.value };
                                    try { localStorage.setItem(key, typeof returned.value === 'string' ? returned.value : JSON.stringify(returned.value)); } catch {}
                                }
                            }
                        } catch (_) { /* Retry on the next state sync. */ }
                    }));
                },
        };
    }
};
