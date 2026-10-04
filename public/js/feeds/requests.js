// Owns article-list requests, cancellation and page-preserving revalidation.
const ReaderFeedRequests = {
async fetchData(isLoadMore = false, skipPageReset = false, keepVisible = false) {
                    // Background revalidation must neither reset the page nor supersede navigation.
                    if (keepVisible && (this.isLoadingMore || this.isLoadingArticles)) return { skipped: true };
                    if (keepVisible) skipPageReset = true;
                    if (this.selectedFilterType === 'smart') {
                        this.selectedFilterValue = this.normalizeSmartDestination(this.selectedFilterValue);
                        this.smartRegion = this.selectedFilterValue.endsWith('_vietnam') ? 'vietnam' : 'global';
                        const route = this.getFilterFromHash();
                        const suffix = route?.articleUrl ? '?article=' + encodeURIComponent(route.articleUrl) : '';
                        window.history.replaceState(window.history.state, '', '#smart/' + this.selectedFilterValue + suffix);
                    }
                    const smartTiming = this.usesTopStories ? {startedAt:performance.now()} : null;
                    const topContext = this.usesTopStories ? JSON.stringify([this.selectedFilterValue,this.smartRegion,this.hideRead,this.searchQuery]) : null;
                    const retainTop = topContext && this._renderedTopContext === topContext && this.articles.length > 0;
                    const requestGeneration = ++this.articleRequestGeneration;
                    this._articleListAbort?.abort();
                    const listController = typeof AbortController === 'function' ? new AbortController() : null;
                    this._articleListAbort = listController;
                    if (!isLoadMore && !skipPageReset) {
                        this.currentPage = 1;
                    }
                    if (!isLoadMore) {
                        this.isLoadingArticles = true;
                        this.loadingArticleStatus = 'Connecting to server...';
                        if (!keepVisible && !retainTop) this.articles = [];
                        if (!keepVisible && !retainTop) this.topStories = [];
                        
                        if (this._connectTimer) clearInterval(this._connectTimer);
                        let connectWaitTime = 0;
                        this._connectTimer = setInterval(() => {
                            connectWaitTime += 500;
                            // Only update if we are still in the pre-download phase
                            if (!this.loadingArticleStatus || this.loadingArticleStatus.startsWith('Downloading') || this.loadingArticleStatus.startsWith('Processing')) {
                                clearInterval(this._connectTimer);
                                return;
                            }
                            if (connectWaitTime === 1000) {
                                this.loadingArticleStatus = 'Reading database into memory...';
                            } else if (connectWaitTime === 2000) {
                                this.loadingArticleStatus = 'Filtering and sorting articles...';
                            } else if (connectWaitTime === 3500) {
                                this.loadingArticleStatus = 'Almost there, preparing response...';
                            } else if (connectWaitTime > 5000 && connectWaitTime % 1000 === 0) {
                                this.loadingArticleStatus = `Still processing... (${connectWaitTime/1000}s)`;
                            }
                        }, 500);
                    }

                    const requestedPage = this.currentPage;
                    const timeout = setTimeout(() => listController?.abort(), 30000);
                    const pageLimit = this.isMobile ? 15 : 40;
                    const params = new URLSearchParams({
                        page: this.currentPage,
                        limit: pageLimit,
                        filterType: this.selectedFilterType,
                        filterValue: this.selectedFilterValue || '',
                        hideRead: this.hideRead,
                        searchQuery: this.searchQuery || ''
                    });
                    if (this.selectedFilterType === 'smart' && this.smartClusterVersion && (isLoadMore || (skipPageReset && requestedPage > 1) || this._preserveSmartVersionCall)) {
                        params.set('smartVersion', this.smartClusterVersion);
                    }
                    this._preserveSmartVersionCall = false;
                    if ((isLoadMore || (skipPageReset && this.currentPage > 1)) && this.smartViewToken) params.set('smartView', this.smartViewToken);
                    if (this.selectedFilterType === 'smart') {
                        params.set('smartMode', this.smartTabMode);
                        params.set('smartRegion', this.smartRegion);
                    }
                    params.append('_t', Date.now().toString());

                    try {
                        const earlyRequest = window.__rssInitialDataRequest;
                        const canUseEarlyRequest = !isLoadMore && !keepVisible && this.currentPage === 1 &&
                            earlyRequest &&
                            earlyRequest.limit === String(pageLimit) &&
                            earlyRequest.filterType === this.selectedFilterType &&
                            earlyRequest.filterValue === (this.selectedFilterValue || '') &&
                            earlyRequest.hideRead === String(this.hideRead) &&
                            !this.searchQuery;
                        let res = null;
                        if (canUseEarlyRequest) {
                            window.__rssInitialDataRequest = null;
                            res = await earlyRequest.promise;
                        }
                        if (!res) res = await fetch(`/api/data?${params.toString()}`, { signal: listController?.signal });
                        if (requestGeneration !== this.articleRequestGeneration) {
                            await res.body?.cancel();
                            return;
                        }
                        if (res.ok) {
                            if (!isLoadMore) this.loadingArticleStatus = 'Downloading data...';
                            
                            let data;
                            if (res.body && window.ReadableStream) {
                                const contentLength = res.headers.get('content-length');
                                const total = contentLength ? parseInt(contentLength, 10) : 0;
                                let loaded = 0;
                                const reader = res.body.getReader();
                                const chunks = [];
                                while(true) {
                                    const {done, value} = await reader.read();
                                    if (done) break;
                                    chunks.push(value);
                                    loaded += value.length;
                                    if (!isLoadMore) {
                                        if (total) {
                                            this.loadingArticleStatus = `Downloading data... ${Math.round(loaded/total*100)}%`;
                                        } else {
                                            this.loadingArticleStatus = `Downloading data... ${(loaded/1024).toFixed(1)} KB`;
                                        }
                                    }
                                }
                                if (!isLoadMore) this.loadingArticleStatus = 'Processing...';
                                let position = 0;
                                let result = new Uint8Array(loaded);
                                for(let chunk of chunks) {
                                    result.set(chunk, position);
                                    position += chunk.length;
                                }
                                const text = new TextDecoder("utf-8").decode(result);
                                data = JSON.parse(text);
                            } else {
                                data = await res.json();
                                if (!isLoadMore) this.loadingArticleStatus = 'Processing...';
                            }
                            
                            if (requestGeneration !== this.articleRequestGeneration) return;
                            if (smartTiming) { smartTiming.fetchMs=performance.now()-smartTiming.startedAt; smartTiming.renderStartedAt=performance.now(); }
                            this._renderedTopContext = topContext;
                            this.topStories = data.topStories || [];
                            if (['top', 'classic'].includes(data.smartTabMode)) {
                                this.smartTabMode = data.smartTabMode;
                            }
                            this.smartViewToken = data.smartViewToken || '';
                            this.rankingPending = data.rankingPending === true;
                            this.topUpdatesAvailable = data.updatesAvailable === true;

                            if (data.viewReset && (isLoadMore || requestedPage > 1)) {
                                // An expired snapshot is not the next page. Keep the reader's
                                // position and expose the existing explicit refresh affordance.
                                this.topUpdatesAvailable = true;
                                this.hasMore = false;
                                return { reset: true };
                            }
                            if (data.viewReset) { isLoadMore = false; this.currentPage = 1; }
                            const previousCount = this.articles.length;
                            if (isLoadMore) {
                                const existingLinks = new Set(this.articles.map(a => a.link));
                                let newUniqueArticles = (data.articles || []).filter(a => !existingLinks.has(a.link));
                                if (this.hideRead && !['recent', 'saved', 'board'].includes(this.selectedFilterType)) {
                                    newUniqueArticles = newUniqueArticles.filter(a => !this.readStates.has(a.link));
                                }
                                this.articles = [...this.articles, ...newUniqueArticles];
                            } else {
                                this.feeds = data.feeds || [];
                                this.readStates = new Set([...(data.readStates || []), ...this.pendingReadLinks].filter(link => !this.pendingUnreadLinks.has(link)));
                                if (data.recentReadAt) {
                                    const localPending = Object.fromEntries([...this.pendingRecentReadLinks].map(link => [link, this.recentReadAt[link] || Date.now()]));
                                    this.recentReadAt = { ...data.recentReadAt, ...localPending };
                                }
                                this.savedStates = this.applyPendingStateMutations('savedStates', data.savedStates || []);
                                this.boardStates = this.applyPendingStateMutations('boardStates', data.boardStates || []);
                                // The server is authoritative. Merging with an old browser snapshot
                                // kept removed entries forever and made the sidebar count drift.
                                this.hiddenStates = this.applyPendingStateMutations('hiddenStates', data.hiddenStates || []);
                                
                                let newArticles = data.articles || [];
                                if (this.hideRead && !['recent', 'saved', 'board'].includes(this.selectedFilterType)) {
                                    newArticles = newArticles.filter(a => !this.readStates.has(a.link));
                                }
                                if (keepVisible && this.articles.length > 0 && !this.usesTopStories) {
                                    // A cache revalidation must not reorder, remove, or insert cards
                                    // while the user is reading. Merge fresh fields into the exact
                                    // visible list and leave membership/order for an explicit refresh.
                                    const refreshedByIdentity = new Map();
                                    for (const refreshed of newArticles) {
                                        for (const key of [refreshed.id, refreshed.guid, refreshed.originalLink, refreshed.link]) {
                                            if (key) refreshedByIdentity.set(String(key), refreshed);
                                        }
                                    }
                                    this.articles = this.articles.map(existing => {
                                        const refreshed = [existing.id, existing.guid, existing.originalLink, existing.link]
                                            .map(key => key ? refreshedByIdentity.get(String(key)) : null)
                                            .find(Boolean);
                                        return refreshed ? { ...existing, ...refreshed } : existing;
                                    });
                                } else {
                                    this.hideTooltip();
                                    this.articles = newArticles;
                                }
                                
                                this.userPreferences = { ...(data.userPreferences || {}), ...this.pendingPreferences };
                                if (this.userPreferences.clusteringModel) {
                                    this.clusteringModel = this.userPreferences.clusteringModel;
                                }
                                this.userPreferences.boardFolders = [...new Set(['cache', ...(this.userPreferences.boardFolders || [])])];
                                this.userPreferences.boardFolderMappings = this.userPreferences.boardFolderMappings || {};
                                this.categoryOrder = data.categoryOrder || [];
                                if (data.unreadCounts) this.unreadCounts = data.unreadCounts;
                                if (data.smartClusterVersion) {
                                    this.smartClusterVersion = data.smartClusterVersion;
                                }
                            }
                            this.hasMore = data.hasMore !== undefined ? data.hasMore : false;
                            const result = { ok: true, page: requestedPage, added: isLoadMore ? this.articles.length - previousCount : this.articles.length };
                            this._lastArticlePageResult = result;
                            if (typeof this.saveState === 'function') this.saveState();
                            if (!isLoadMore && this.articles && this.articles.length > 0) {
                                setTimeout(() => this.prefetchArticlesList(this.articles.slice(0, 10), false), 250);
                            }
                            return result;
                        }
                        return { failed: true };
                    } catch (e) {
                        if (e?.name !== 'AbortError') console.error("Failed to load data:", e);
                        return { failed: true };
                    } finally {
                        clearTimeout(timeout);
                        if (requestGeneration === this.articleRequestGeneration) {
                            this._articleListAbort = null;
                            clearInterval(this._connectTimer);
                            if (!isLoadMore) this.isLoadingArticles = false;
                            this.scheduleBriefingRefresh();
                            if (smartTiming?.renderStartedAt) this.$nextTick(() => requestAnimationFrame(() => {
                                window.__smartRefreshTiming = {fetchMs:smartTiming.fetchMs, renderMs:performance.now()-smartTiming.renderStartedAt, cards:this.articles.length};
                                performance.measure('smart-top-fetch', {start:smartTiming.startedAt,end:smartTiming.renderStartedAt});
                                performance.measure('smart-top-render', {start:smartTiming.renderStartedAt,end:performance.now()});
                            }));
                        }
                    }
                }
};
