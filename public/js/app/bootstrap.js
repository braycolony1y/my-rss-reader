// Owns app / bootstrap on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderAppBootstrap = {
    create() {
        return {
                isLoggedIn: false,
                password: '',

                async initApp() {
                    setInterval(() => { this.clockNow = Date.now(); this.updateSourceTimes(); }, 30000);
                    document.addEventListener('visibilitychange', () => { this.clockNow = Date.now(); this.updateSourceTimes(); });
                    document.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') this.toggleSourceTime(event); });
                    this.$watch('isLoggedIn', () => this.loadCacheState());
                    setInterval(() => this.loadCacheState(), 60000);
                    this.installTooltipDismissListeners();
                    if (document.cookie.includes('auth=true')) {
                        this.isLoggedIn = true;
                        this.loadCacheState();
                        this.fetchContentFilterSettings();
                        this.fetchSmartSettings();
                        this.fetchSmartSources();
                        const universalState = await this.fetchUniversalUserStateSnapshot();
                        if (universalState) {
                            this.readStates = new Set(universalState.readStates || []);
                            this.savedStates = this.dedupeStateLinks(universalState.savedStates || []);
                            this.boardStates = this.dedupeStateLinks(universalState.boardStates || []);
                            this.hiddenStates = this.dedupeStateLinks(universalState.hiddenStates || []);
                            this.recentReadAt = universalState.recentReadAt || {};
                            this.userPreferences = universalState.userPreferences || {};
                            this.categoryOrder = universalState.categoryOrder || [];
                            if (typeof this.userPreferences.hideRead === 'boolean') this.hideRead = this.userPreferences.hideRead;
                            if (['classic', 'glass', 'glass-light'].includes(this.userPreferences.theme)) this.theme = this.userPreferences.theme;
                        }
                        
                        // Try to restore state from sessionStorage or localStorage (handles iOS Safari & Chrome mobile tab eviction)
                        const saved = sessionStorage.getItem('rssAppState') || localStorage.getItem('rssAppState');
                        let restoredFromCache = false;
                        let cacheMatchesSmartDefault = false;
                        if (saved) {
                            try {
                                const state = JSON.parse(saved);
                                const age = Date.now() - (state.savedAt || 0);
                                if (state.articles && state.articles.length > 0) {
                                    this.feeds = state.feeds || [];
                                    this.articles = state.articles || [];
                                    this.pendingReadLinks = new Set(state.pendingReadLinks || []);
                                    this.pendingUnreadLinks = new Set(state.pendingUnreadLinks || []);
                                    this.pendingRecentReadLinks = new Set(state.pendingRecentReadLinks || []);
                                    this.pendingStateMutations = state.pendingStateMutations && typeof state.pendingStateMutations === 'object' ? state.pendingStateMutations : {};
                                    this.pendingPreferences = state.pendingPreferences && typeof state.pendingPreferences === 'object' ? state.pendingPreferences : {};
                                    this.readStates = new Set([...(universalState?.readStates || state.readStates || []), ...this.pendingReadLinks].filter(link => !this.pendingUnreadLinks.has(link)));
                                    this.recentReadAt = { ...(universalState?.recentReadAt || state.recentReadAt || {}) };
                                    for (const link of this.pendingRecentReadLinks) this.recentReadAt[link] ||= Date.now();
                                    this.savedStates = this.applyPendingStateMutations('savedStates', universalState?.savedStates || state.savedStates || []);
                                    this.boardStates = this.applyPendingStateMutations('boardStates', universalState?.boardStates || state.boardStates || []);
                                    this.hiddenStates = this.applyPendingStateMutations('hiddenStates', universalState?.hiddenStates || state.hiddenStates || []);
                                    this.userPreferences = { ...(universalState?.userPreferences || state.userPreferences || {}), ...this.pendingPreferences };
                                    if (['classic', 'glass', 'glass-light'].includes(this.userPreferences.theme)) this.theme = this.userPreferences.theme;
                                    this.smartClusterVersion = state.smartClusterVersion || '';
                                    this.smartRegion = state.smartRegion === 'vietnam' ? 'vietnam' : 'global';
                                    if (this.userPreferences.clusteringModel) {
                                        this.clusteringModel = this.userPreferences.clusteringModel;
                                    }
                                    this.categoryOrder = universalState?.categoryOrder || state.categoryOrder || [];
                                    if (typeof this.userPreferences.hideRead === 'boolean') this.hideRead = this.userPreferences.hideRead;
                                    this.unreadCounts = state.unreadCounts || { feeds: {}, categories: {}, total: 0 };
                                    const hashFilter = this.getFilterFromHash();
                                    if (hashFilter) {
                                        this.selectedFilterType = hashFilter.type;
                                        this.selectedFilterValue = hashFilter.value;
                        if (hashFilter.type === 'smart') this.smartRegion = String(hashFilter.value).endsWith('_vietnam') ? 'vietnam' : 'global';
                                    } else {
                                        const universalView = this.userPreferences.currentView;
                                        this.selectedFilterType = universalView?.type || state.selectedFilterType || 'smart';
                                        this.selectedFilterValue = Object.prototype.hasOwnProperty.call(universalView || {}, 'value') ? universalView.value : (state.selectedFilterValue || 'news_vietnam');
                                        window.history.replaceState(null, null, `#${this.selectedFilterType}${this.selectedFilterValue ? '/' + this.selectedFilterValue : ''}`);
                                    }
                                    cacheMatchesSmartDefault = this.selectedFilterType === state.selectedFilterType && this.selectedFilterValue === state.selectedFilterValue;
                                    this.currentPage = state.currentPage || 1;
                                    this.hasMore = state.hasMore !== undefined ? state.hasMore : true;
                                    this.expandedCategories = state.expandedCategories || this.categories.map(c => c.name);
                                    restoredFromCache = true;
                                    // Robust multi-stage scroll position restoration (handles lazy image loading and viewport shifts on mobile)
                                    const scrollY = cacheMatchesSmartDefault ? (state.scrollY || 0) : 0;
                                    this.lastSavedScrollY = scrollY;
                                    const restoreScroll = () => {
                                        const sc = document.getElementById('scroll-container');
                                        if (sc && scrollY > 0) sc.scrollTop = scrollY;
                                    };
                                    this.$nextTick(restoreScroll);
                                    setTimeout(restoreScroll, 50);
                                    setTimeout(restoreScroll, 200);
                                    setTimeout(restoreScroll, 500);
                                    // If state is older than 5 min, only update sync status right away without overwriting this.articles or resetting scroll
                                    if (age > 5 * 60 * 1000) {
                                        const bgRefresh = () => this.fetchSyncStatus();
                                        if ('requestIdleCallback' in window) requestIdleCallback(bgRefresh);
                                        else setTimeout(bgRefresh, 500);
                                    }
                                } else {
                                    // Empty articles in cache — fetch fresh
                                    await this.fetchData();
                                    this.expandedCategories = this.categories.map(c => c.name);
                                    if (typeof this.saveState === 'function') this.saveState();
                                }
                            } catch(e) {
                                // Corrupted state, fetch fresh
                                await this.fetchData();
                                this.expandedCategories = this.categories.map(c => c.name);
                                if (typeof this.saveState === 'function') this.saveState();
                            }
                            if (restoredFromCache && !cacheMatchesSmartDefault) {
                                await this.fetchData();
                            } else if (restoredFromCache) {
                                // Paint the cached cards first, then revalidate without
                                // replacing them with a loading screen.
                                setTimeout(() => this.fetchData(false, true, true), 50);
                            }
                        } else {
                            const universalView = this.userPreferences.currentView;
                            if (universalView?.type) {
                                this.selectedFilterType = universalView.type;
                                this.selectedFilterValue = Object.prototype.hasOwnProperty.call(universalView, 'value') ? universalView.value : null;
                                window.history.replaceState(null, null, `#${this.selectedFilterType}${this.selectedFilterValue ? '/' + encodeURIComponent(this.selectedFilterValue) : ''}`);
                            }
                            await this.fetchData();
                            this.expandedCategories = this.categories.map(c => c.name);
                            if (typeof this.saveState === 'function') this.saveState();
                        }
                    }
                    if (this.isMobile) {
                        this.mobileSidebarOpen = false;
                    }
                    setTimeout(() => {
                        if (this.articles && this.articles.length > 0) {
                            this.prefetchArticlesList(this.articles.slice(0, 5), true);
                        }
                    }, 600);
                    
                    this.startServerEvents();

                    /*
                     * Emergency reconciliation only.
                     * Normal updates arrive through /api/events.
                     */
                    this.serverEventsFallbackTimer =
                        setInterval(
                            () => {
                                if (
                                    !document.hidden &&
                                    !this.serverEventsConnected
                                ) {
                                    this.syncUserStatesInBackground();
                                }
                            },
                            5 * 60 * 1000
                        );

                    // Background poll for debug stats (quota warning)
                    this.fetchGeminiDebugStats();
                    setInterval(
                        () => {
                            if (
                                !document.hidden &&
                                !this.geminiStatusOpen
                            ) {
                                this.fetchGeminiDebugStats();
                            }
                        },
                        5 * 60 * 1000
                    );

                    // RETURN_TAB_SCROLL_FIX_V1
                    //
                    // A normal Chrome tab switch preserves the live DOM and its
                    // scroll position. Never restore a saved scroll position on
                    // visibilitychange: scrollTop=0 is a valid position and may
                    // briefly be reported while the tab becomes visible.
                    //
                    // Snapshot the current value, including zero, when leaving.
                    // Full reload/tab-eviction restoration is handled separately
                    // by the rssAppState startup restore path.
                    document.addEventListener('visibilitychange', () => {
                        const sc = document.getElementById('scroll-container');

                        if (document.hidden) {
                            if (sc) {
                                this.lastSavedScrollY = sc.scrollTop;
                            }

                            this.flushUserPreferences();

                            if (typeof this.saveState === 'function') {
                                this.saveState();
                            }
                        } else {
                            this.fetchSyncStatus();
                            this.syncUserStatesInBackground();

                            // Intentionally do not write sc.scrollTop here.
                        }
                    });
                    window.addEventListener('pagehide', () => { this.flushUserPreferences(); if (typeof this.saveState === 'function') this.saveState(); });
                    if ('onfreeze' in document) document.addEventListener('freeze', () => { if (typeof this.saveState === 'function') this.saveState(); });
                    window.addEventListener('pageshow', (e) => {
                        if (e.persisted) {
                            // BFCache restores the live document, including its
                            // scroll position. Do not overwrite it with a saved
                            // position from another moment.
                            this.fetchSyncStatus();
                        }
                    });
                    this.fetchSyncStatus();

                    const initialRoute = this.getFilterFromHash();
                    if (this.isLoggedIn && initialRoute?.articleUrl && !this.articleOverlayOpen) {
                        await this.openArticleFromRoute(initialRoute.articleUrl);
                    }

                    // Ping backend for Forum active tab status to accelerate sync
                    setInterval(() => {
                        if (document.hidden) return;
                        
                        let isForum = false;
                        if (this.overlayArticle && this.overlayArticle.feedCategory && this.overlayArticle.feedCategory.toLowerCase().includes('forum')) {
                            isForum = true;
                        } else if (this.selectedFilterType === 'feed' && this.selectedFilterValue) {
                            const feed = this.feeds.find(f => f.url === this.selectedFilterValue);
                            if (feed && feed.category && feed.category.toLowerCase().includes('forum')) {
                                isForum = true;
                            }
                        } else if (this.selectedFilterType === 'category' && this.selectedFilterValue) {
                            if (this.selectedFilterValue.toLowerCase().includes('forum')) {
                                isForum = true;
                            }
                        }

                        if (isForum) {
                            fetch('/api/ping-active', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ isForum: true })
                            }).catch(() => {});
                        }
                    }, 30000);
                },

                async login() {
                    const res = await fetch('/api/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password: this.password })
                    });
                    if (res.ok) {
                        this.isLoggedIn = true;
                        document.cookie = "auth=true; path=/; max-age=31536000";
                        this.startServerEvents();
                        await this.fetchContentFilterSettings();
                        await this.fetchSmartSources();
                        await this.fetchData();
                        this.expandedCategories = this.categories.map(c => c.name);
                    } else alert('Incorrect password');
                },
        };
    }
};
