// Owns app / persistence on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderAppPersistence = {
    create() {
        return {
                pendingPreferences: {}, 
                userPreferences: {},
                lastSavedScrollY: 0,
                saveState() {
                    if (!this.isLoggedIn || !this.articles.length) return;

                    const sc = document.getElementById('scroll-container');
                    if (sc) this.lastSavedScrollY = sc.scrollTop;

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
                        if (this.usesTopStories && article?.topStory) {
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
                        feeds: this.feeds,
                        articles: this.articles.map(article => compactArticle(article)),
                        readStates: Array.from(this.readStates),
                        recentReadAt: this.recentReadAt,
                        pendingReadLinks: Array.from(this.pendingReadLinks),
                        pendingUnreadLinks: Array.from(this.pendingUnreadLinks),
                        pendingRecentReadLinks: Array.from(this.pendingRecentReadLinks),
                        pendingStateMutations: this.pendingStateMutations,
                        savedStates: this.savedStates,
                        boardStates: this.boardStates,
                        hiddenStates: this.hiddenStates,
                        userPreferences: this.userPreferences,
                        pendingPreferences: this.pendingPreferences,
                        categoryOrder: this.categoryOrder,
                        unreadCounts: this.unreadCounts,
                        smartClusterVersion: this.smartClusterVersion,
                        smartRegion: this.smartRegion,
                        selectedFilterType: this.selectedFilterType,
                        selectedFilterValue: this.selectedFilterValue,
                        currentPage: this.currentPage,
                        hasMore: this.hasMore,
                        expandedCategories: this.expandedCategories,
                        scrollY: sc ? sc.scrollTop : (this.lastSavedScrollY || 0),
                        savedAt: Date.now()
                    };

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
