        function rssApp() {
            return {
                theme: localStorage.getItem('theme') || 'classic',
                showAddFeedModal: false,
                isLoggedIn: false,
                password: '',
                newFeedUrl: '',
                newFeedCategory: '',
                selectedDropdownCategory: '',
                searchQuery: '',
                
                feeds: [],
                articles: [],
                readStates: [],
                savedStates: [],
                boardStates: [],
                hiddenStates: [], 
                userPreferences: {}, 
                isSyncing: false,
                isAdding: false,
                syncProgress: { visible: false, message: '', done: false, failed: false, current: 0, total: 0, requestId: '' },
                syncProgressInterval: null,
                markAllUndo: null,
                markAllUndoTimer: null,
                contentFilterSettingsOpen: false,
                blockedKeywords: [],
                blockedKeywordsDraft: '',
                savingContentFilter: false,
                contentFilterPreview: [],
                contentFilterPreviewTotal: 0,
                contentFilterPreviewKeyword: '',
                contentFilterPreviewKeywordTotals: [],
                contentFilterPreviewLoading: false,
                contentFilterPreviewError: '',
                contentFilterPreviewRequest: 0,
                contentFilterPreviewDebounce: null,
                geminiStatusOpen: false,
                geminiStatusLoading: false,
                geminiStatusError: '',
                geminiKeyStatus: null,
                smartSourcesSettingsOpen: false,
                smartSources: [],
                smartSourceSearch: '',
                loadingSmartSources: false,
                savingSmartSource: false,
                removingSmartSourceUrl: '',
                smartSourceError: '',
                newSmartSource: { title: '', url: '', kind: 'news_vietnam' },
                smartSourcePanel: 'sources',
                smartSourceKind: 'news_vietnam',
                smartSourceSections: [
                    { value: 'news_vietnam', short: 'News · VN', label: 'News · Vietnam' },
                    { value: 'news_world', short: 'News · World', label: 'News · World' },
                    { value: 'finance_vietnam', short: 'Finance · VN', label: 'Finance · Vietnam' },
                    { value: 'finance_global', short: 'Finance · Global', label: 'Finance · Global' },
                    { value: 'tech_vietnam', short: 'Tech · VN', label: 'Technology · Vietnam' },
                    { value: 'tech_foreign', short: 'Tech · Global', label: 'Technology · Global' }
                ],
                smartSourceView: 'enabled',
                smartDiscoveryKind: 'news_vietnam',
                smartDiscoveryCandidates: [],
                smartDiscoverySelected: [],
                discoveringSmartSources: false,
                savingDiscoveredSources: false,
                smartClusterVersion: '',
                
                selectedFilterType: 'smart',
                selectedFilterValue: 'news_vietnam',
                expandedCategories: [],
                
                hideRead: localStorage.getItem('hideRead') === 'true',
                
                isMobile: window.innerWidth < 768,
                mobileSidebarOpen: false,
                desktopSidebarOpen: true, 
                mobileActiveCard: null,
                lastSavedScrollY: 0,
                saveState: null,
                
                editModalOpen: false,
                editingFeed: null,
                editFeedTitle: '',
                editFeedCategoryDropdown: '',
                editFeedCategoryNew: '',
                isSavingEdit: false,
                
                draggedUrl: null,
                dragTargetUrl: null,
                categoryOrder: [],
                draggedCategory: null,
                dragTargetCategory: null,

                // LOGS PANEL STATE
                logsPanelOpen: false,
                logsTab: 'stats',
                sourceStatsData: [],
                fetchHistoryData: [],
                fetchErrorsData: [],
                syncPaused: false,
                logsRefreshInterval: null,

                // ARTICLE OVERLAY STATE
                articleOverlayOpen: false,
                isLoadingOverlay: false,
                overlayArticle: null,
                overlayContent: null,
                overlayPagination: null,
                vozThreadNotice: null,
                overlayError: null,
                overlayProgress: { message: '' },
                overlayProgressInterval: null,
                overlayRequestId: '',
                overlayFetchStrategy: '',
                overlayFetchedFromCache: false,
                overlayHasNativeAudio: false,
                overlayMethodResults: {},
                overlayAttemptedStrategies: [],
                overlayRejectedStrategies: [],
                overlayMethodPreferences: {},
                overlayTryingMethod: false,
                overlayMethodError: '',
                articleSpeechState: 'idle',
                articleSpeechChunks: [],
                articleSpeechIndex: 0,
                articleSpeechGeneration: 0,
                vozScrollRaf: 0,
                lastVozMeasureAt: 0,
                lastTrackedVozPost: '',

                // DEBUG MODAL STATE
                debugModalOpen: false,
                isDebugging: false,
                debugData: null,

                // PAGINATION & SIDEBAR STATE
                currentPage: 1,
                hasMore: true,
                isLoadingMore: false,
                isLoadingArticles: false,
                articleRequestGeneration: 0,
                unreadCounts: { feeds: {}, categories: {}, total: 0 },

                async initApp() {
                    if (document.cookie.includes('auth=true')) {
                        this.isLoggedIn = true;
                        this.fetchContentFilterSettings();
                        this.fetchSmartSources();
                        
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
                                    this.readStates = state.readStates || [];
                                    this.savedStates = state.savedStates || [];
                                    this.boardStates = state.boardStates || [];
                                    this.hiddenStates = state.hiddenStates || [];
                                    this.userPreferences = state.userPreferences || {};
                                    this.categoryOrder = state.categoryOrder || [];
                                    this.unreadCounts = state.unreadCounts || { feeds: {}, categories: {}, total: 0 };
                                    cacheMatchesSmartDefault = state.selectedFilterType === 'smart' && state.selectedFilterValue === 'news_vietnam';
                                    this.selectedFilterType = 'smart';
                                    this.selectedFilterValue = 'news_vietnam';
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
                            }
                        } else {
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

                    // Save state securely to both sessionStorage and localStorage with lightweight compacting so it never exceeds quota on mobile
                    this.saveState = () => {
                        if (!this.isLoggedIn || this.articles.length === 0) return;
                        const sc = document.getElementById('scroll-container');
                        if (sc && sc.scrollTop > 0) this.lastSavedScrollY = sc.scrollTop;
                        // Always truncate article content to 300 chars in storage (~25 KB total for 40 articles) to prevent QuotaExceededError in mobile/localStorage
                        const compactArticles = this.articles.map(a => ({
                            ...a,
                            content: a.content ? String(a.content).substring(0, 300) : ''
                        }));
                        const state = {
                            feeds: this.feeds,
                            articles: compactArticles,
                            readStates: this.readStates,
                            savedStates: this.savedStates,
                            boardStates: this.boardStates,
                            hiddenStates: this.hiddenStates,
                            userPreferences: this.userPreferences,
                            categoryOrder: this.categoryOrder,
                            unreadCounts: this.unreadCounts,
                            selectedFilterType: this.selectedFilterType,
                            selectedFilterValue: this.selectedFilterValue,
                            currentPage: this.currentPage,
                            hasMore: this.hasMore,
                            expandedCategories: this.expandedCategories,
                            scrollY: sc ? sc.scrollTop : (this.lastSavedScrollY || 0),
                            savedAt: Date.now()
                        };
                        try {
                            const json = JSON.stringify(state);
                            try { sessionStorage.setItem('rssAppState', json); } catch(e) {}
                            try { localStorage.setItem('rssAppState', json); } catch(e) {}
                        } catch(e) {
                            const ultraCompact = this.articles.slice(0, 20).map(a => ({
                                link: a.link, title: a.title, content: '', image: a.image, pubDate: a.pubDate,
                                feedTitle: a.feedTitle, feedIcon: a.feedIcon, feedCategory: a.feedCategory, replyCount: a.replyCount, viewCount: a.viewCount
                            }));
                            const compactState = { ...state, articles: ultraCompact };
                            try {
                                const jsonCompact = JSON.stringify(compactState);
                                try { sessionStorage.setItem('rssAppState', jsonCompact); } catch(e2) {}
                                try { localStorage.setItem('rssAppState', jsonCompact); } catch(e2) {}
                            } catch(e3) {}
                        }
                    };
                    document.addEventListener('visibilitychange', () => { 
                        if (document.hidden) {
                            if (typeof this.saveState === 'function') this.saveState();
                        } else {
                            this.fetchSyncStatus();
                            const sc = document.getElementById('scroll-container');
                            if (sc && sc.scrollTop === 0 && this.lastSavedScrollY > 0) {
                                sc.scrollTop = this.lastSavedScrollY;
                            }
                        }
                    });
                    window.addEventListener('pagehide', () => { if (typeof this.saveState === 'function') this.saveState(); });
                    if ('onfreeze' in document) document.addEventListener('freeze', () => { if (typeof this.saveState === 'function') this.saveState(); });
                    window.addEventListener('pageshow', (e) => { 
                        if (e.persisted) {
                            this.fetchSyncStatus();
                            const sc = document.getElementById('scroll-container');
                            if (sc && sc.scrollTop === 0 && this.lastSavedScrollY > 0) {
                                sc.scrollTop = this.lastSavedScrollY;
                            }
                        }
                    });
                    this.fetchSyncStatus();
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
                        await this.fetchContentFilterSettings();
                        await this.fetchSmartSources();
                        await this.fetchData();
                        this.expandedCategories = this.categories.map(c => c.name);
                    } else alert('Incorrect password');
                },

                async fetchContentFilterSettings() {
                    try {
                        const response = await fetch('/api/content-filter-settings');
                        if (!response.ok) return;
                        const data = await response.json();
                        this.blockedKeywords = Array.isArray(data.keywords)
                            ? data.keywords.map(value => String(value || '').trim().normalize('NFC').toLocaleLowerCase('vi-VN')).filter(Boolean)
                            : [];
                        if (!this.contentFilterSettingsOpen) this.blockedKeywordsDraft = this.blockedKeywords.join('\n');
                    } catch (e) { }
                },

                openContentFilterSettings() {
                    this.blockedKeywordsDraft = this.blockedKeywords.join('\n');
                    this.contentFilterSettingsOpen = true;
                    this.mobileSidebarOpen = false;
                    this.fetchContentFilterPreview();
                },

                draftBlockedKeywords() {
                    const seen = new Set();
                    return this.blockedKeywordsDraft
                        .split(/\n/)
                        .map(value => value.trim().normalize('NFC').toLocaleLowerCase('vi-VN'))
                        .filter(value => {
                            const normalized = value;
                            if (!normalized || seen.has(normalized)) return false;
                            seen.add(normalized);
                            return true;
                        });
                },

                onContentFilterInput(event) {
                    const lowered = String(event.target.value || '')
                        .normalize('NFC')
                        .toLocaleLowerCase('vi-VN');
                    if (event.target.value !== lowered) event.target.value = lowered;
                    this.blockedKeywordsDraft = lowered;
                    const keywords = this.draftBlockedKeywords();
                    this.contentFilterPreviewKeyword = keywords[keywords.length - 1] || '';
                    clearTimeout(this.contentFilterPreviewDebounce);
                    this.contentFilterPreviewDebounce = setTimeout(() => this.fetchContentFilterPreview(), 500);
                },

                contentFilterPreviewCount(keyword) {
                    return this.contentFilterPreviewKeywordTotals.find(item => item.keyword === keyword)?.total || 0;
                },

                selectContentFilterPreviewKeyword(keyword) {
                    if (this.contentFilterPreviewKeyword === keyword) return;
                    this.contentFilterPreviewKeyword = keyword;
                    this.fetchContentFilterPreview();
                },

                async fetchContentFilterPreview(append = false) {
                    if (append && this.contentFilterPreviewLoading) return;
                    const keywords = this.draftBlockedKeywords();
                    const requestId = ++this.contentFilterPreviewRequest;
                    if (!keywords.length) {
                        this.contentFilterPreview = [];
                        this.contentFilterPreviewTotal = 0;
                        this.contentFilterPreviewKeyword = '';
                        this.contentFilterPreviewKeywordTotals = [];
                        this.contentFilterPreviewError = '';
                        this.contentFilterPreviewLoading = false;
                        return;
                    }
                    if (!keywords.includes(this.contentFilterPreviewKeyword)) this.contentFilterPreviewKeyword = keywords[keywords.length - 1];
                    const offset = append ? this.contentFilterPreview.length : 0;
                    if (!append) {
                        this.contentFilterPreview = [];
                        this.contentFilterPreviewTotal = 0;
                    }
                    this.contentFilterPreviewLoading = true;
                    this.contentFilterPreviewError = '';
                    try {
                        const response = await fetch('/api/content-filter-preview', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ keywords, selectedKeyword: this.contentFilterPreviewKeyword, offset, limit: 50 })
                        });
                        if (!response.ok) throw new Error('Could not check affected articles');
                        const data = await response.json();
                        if (requestId !== this.contentFilterPreviewRequest) return;
                        const matches = Array.isArray(data.matches) ? data.matches : [];
                        this.contentFilterPreview = append ? [...this.contentFilterPreview, ...matches] : matches;
                        this.contentFilterPreviewTotal = Number(data.total) || 0;
                        this.contentFilterPreviewKeyword = data.selectedKeyword || this.contentFilterPreviewKeyword;
                        this.contentFilterPreviewKeywordTotals = Array.isArray(data.keywordTotals) ? data.keywordTotals : [];
                    } catch (error) {
                        if (requestId === this.contentFilterPreviewRequest) this.contentFilterPreviewError = error.message;
                    } finally {
                        if (requestId === this.contentFilterPreviewRequest) this.contentFilterPreviewLoading = false;
                    }
                },

                async saveContentFilterSettings() {
                    if (this.savingContentFilter) return;
                    this.savingContentFilter = true;
                    const keywords = this.draftBlockedKeywords();
                    try {
                        const response = await fetch('/api/content-filter-settings', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ keywords })
                        });
                        if (!response.ok) throw new Error('Could not save filters');
                        const data = await response.json();
                        this.blockedKeywords = data.keywords || [];
                        this.blockedKeywordsDraft = this.blockedKeywords.join('\n');
                        this.contentFilterSettingsOpen = false;
                        await this.fetchData();
                    } catch (error) {
                        alert(error.message);
                    } finally {
                        this.savingContentFilter = false;
                    }
                },

                openGeminiStatus() {
                    this.geminiStatusOpen = true;
                    this.mobileSidebarOpen = false;
                    this.fetchGeminiKeyStatus();
                },

                async fetchGeminiKeyStatus() {
                    if (this.geminiStatusLoading) return;
                    this.geminiStatusLoading = true;
                    this.geminiStatusError = '';
                    try {
                        const response = await fetch('/api/gemini-key-status');
                        if (!response.ok) throw new Error('Could not check the Gemini key');
                        this.geminiKeyStatus = await response.json();
                    } catch (error) {
                        this.geminiStatusError = error.message;
                    } finally {
                        this.geminiStatusLoading = false;
                    }
                },

                async fetchSmartSources() {
                    this.loadingSmartSources = true;
                    try {
                        const response = await fetch('/api/smart-sources');
                        if (!response.ok) return;
                        const data = await response.json();
                        this.smartSources = Array.isArray(data.sources) ? data.sources : [];
                    } catch (e) { }
                    finally { this.loadingSmartSources = false; }
                },

                async openSmartSourcesSettings() {
                    this.smartSourcesSettingsOpen = true;
                    this.mobileSidebarOpen = false;
                    this.smartSourceSearch = '';
                    this.smartSourceError = '';
                    this.smartSourceView = 'enabled';
                    this.smartSourcePanel = 'sources';
                    this.smartDiscoveryCandidates = [];
                    this.smartDiscoverySelected = [];
                    await this.fetchSmartSources();
                },

                filteredSmartSources() {
                    const query = this.smartSourceSearch.trim().toLocaleLowerCase();
                    return [...this.smartSources]
                        .filter(source => this.smartSourceKindFor(source) === this.smartSourceKind)
                        .filter(source => this.smartSourceView === 'disabled' ? source.enabled === false : source.enabled !== false)
                        .filter(source => !query || [source.title, source.url, this.smartSourceCategoryLabel(source)].join(' ').toLocaleLowerCase().includes(query))
                        .sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.region).localeCompare(String(b.region)) || String(a.title).localeCompare(String(b.title)));
                },

                smartSourceHost(url) {
                    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url || ''; }
                },

                smartSourceIcon(source) {
                    const host = String(source.domain || this.smartSourceHost(source.url)).toLowerCase();
                    if (host.includes('tuoitre.vn')) return 'https://statictuoitre.mediacdn.vn/web_images/favicon.ico';
                    if (host.includes('kenh14.vn')) return 'https://kenh14cdn.com/web_images/kenh14-favicon.ico';
                    if (host.includes('soha.vn')) return 'https://sohanews.sohacdn.com/icons/soha-32.png';
                    if (host.includes('genk.vn')) return 'https://genk.mediacdn.vn/web_images/genk32.png';
                    if (host.includes('vjst.vn')) return 'https://ictv.1cdn.vn/assets/static/images/logo.png';
                    if (host.includes('vtv.vn')) return 'https://static.mediacdn.vn/vtv.vn/images/favicon.ico';
                    if (host.includes('doanhnhansaigon.vn')) return 'https://dnsg.1cdn.vn/assets/images/favicon.ico';
                    if (host.includes('tapchinganhang.gov.vn')) return 'https://tapchinganhang.gov.vn/modules/frontend/themes/tcnh/images/favicon/favicon.ico?v=2.620251216214508';
                    if (host.includes('vccinews.')) return 'https://vccinews.com/images/logo.png';
                    if (host.includes('haiquanonline.com.vn')) return 'https://www.google.com/s2/favicons?domain=customs.gov.vn&sz=64';
                    if (host.includes('pcworld.com')) return 'https://icons.duckduckgo.com/ip3/pcworld.com.ico';
                    return host ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=64' : '';
                },

                smartSourceCategoryLabel(source) {
                    const labels = {
                        news_vietnam: 'News · Vietnam',
                        news_world: 'News · World',
                        finance_vietnam: 'Finance · Vietnam',
                        finance_global: 'Finance · Global'
                    };
                    if (source.category === 'tech') return source.region === 'vietnam' ? 'Technology · Vietnam' : 'Technology · Global';
                    return labels[source.category] || 'News · World';
                },

                smartSourceKindFor(source) {
                    if (source.category === 'tech') return source.region === 'vietnam' ? 'tech_vietnam' : 'tech_foreign';
                    return source.category || 'news_world';
                },

                smartSourceKindLabel(kind) {
                    return this.smartSourceSections.find(section => section.value === kind)?.label || 'News · Vietnam';
                },

                setSmartSourceKind(kind) {
                    this.smartSourceKind = kind;
                    this.newSmartSource.kind = kind;
                    this.smartDiscoveryKind = kind;
                    this.smartSourceSearch = '';
                    this.smartDiscoveryCandidates = [];
                    this.smartDiscoverySelected = [];
                    this.smartSourceError = '';
                },

                async addSmartSource() {
                    if (this.savingSmartSource) return;
                    this.savingSmartSource = true;
                    this.smartSourceError = '';
                    const kind = this.newSmartSource.kind;
                    const isTech = kind.startsWith('tech_');
                    const payload = {
                        title: this.newSmartSource.title.trim(),
                        url: this.newSmartSource.url.trim(),
                        category: isTech ? 'tech' : kind,
                        region: isTech ? (kind === 'tech_vietnam' ? 'vietnam' : 'foreign') : (kind.endsWith('_vietnam') ? 'vietnam' : 'foreign'),
                        weight: 1
                    };
                    try {
                        const response = await fetch('/api/smart-sources', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error || 'Could not add this source.');
                        this.smartSources = data.sources || [];
                        this.newSmartSource = { title: '', url: '', kind };
                        this.smartSourcePanel = 'sources';
                        this.smartSourceView = 'enabled';
                    } catch (error) {
                        this.smartSourceError = error.message;
                    } finally {
                        this.savingSmartSource = false;
                    }
                },

                async toggleSmartSource(source) {
                    this.removingSmartSourceUrl = source.url;
                    this.smartSourceError = '';
                    try {
                        const response = await fetch('/api/smart-sources', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url: source.url, enabled: source.enabled === false })
                        });
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error || 'Could not update this source.');
                        this.smartSources = data.sources || [];
                    } catch (error) {
                        this.smartSourceError = error.message;
                    } finally {
                        this.removingSmartSourceUrl = '';
                    }
                },

                toggleSmartDiscoverySelection(url) {
                    this.smartDiscoverySelected = this.smartDiscoverySelected.includes(url)
                        ? this.smartDiscoverySelected.filter(value => value !== url)
                        : [...this.smartDiscoverySelected, url];
                },

                async discoverSmartSources() {
                    if (this.discoveringSmartSources) return;
                    this.discoveringSmartSources = true;
                    this.smartSourceError = '';
                    const kind = this.smartSourceKind;
                    const isTech = kind.startsWith('tech_');
                    try {
                        const response = await fetch('/api/smart-sources/discover', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                category: isTech ? 'tech' : kind,
                                region: isTech ? (kind === 'tech_vietnam' ? 'vietnam' : 'foreign') : (kind.endsWith('_vietnam') ? 'vietnam' : 'foreign')
                            })
                        });
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error || 'Could not search for sources.');
                        this.smartSources = data.sources || this.smartSources;
                        this.smartDiscoveryCandidates = data.candidates || [];
                        this.smartDiscoverySelected = [];
                        if (!this.smartDiscoveryCandidates.length) this.smartSourceError = 'No more curated sources are available for this section. Previously skipped sources remain under “Not used”.';
                    } catch (error) {
                        this.smartSourceError = error.message;
                    } finally {
                        this.discoveringSmartSources = false;
                    }
                },

                async enableSelectedDiscoveredSources() {
                    if (!this.smartDiscoverySelected.length || this.savingDiscoveredSources) return;
                    this.savingDiscoveredSources = true;
                    this.smartSourceError = '';
                    try {
                        for (const url of this.smartDiscoverySelected) {
                            const response = await fetch('/api/smart-sources', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ url, enabled: true })
                            });
                            const data = await response.json();
                            if (!response.ok) throw new Error(data.error || 'Could not add a selected source.');
                            this.smartSources = data.sources || this.smartSources;
                        }
                        this.smartDiscoveryCandidates = [];
                        this.smartDiscoverySelected = [];
                        this.smartSourcePanel = 'sources';
                        this.smartSourceView = 'enabled';
                    } catch (error) {
                        this.smartSourceError = error.message;
                    } finally {
                        this.savingDiscoveredSources = false;
                    }
                },

                async resetSmartSources() {
                    if (!confirm('Restore the built-in Smart source list? Custom source changes will be replaced.')) return;
                    this.smartSourceError = '';
                    try {
                        const response = await fetch('/api/smart-sources/reset', { method: 'POST' });
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error || 'Could not restore the source list.');
                        this.smartSources = data.sources || [];
                    } catch (error) {
                        this.smartSourceError = error.message;
                    }
                },

                async fetchData(isLoadMore = false, skipPageReset = false) {
                    const requestGeneration = ++this.articleRequestGeneration;
                    if (!isLoadMore && !skipPageReset) {
                        this.currentPage = 1;
                    }
                    if (!isLoadMore) {
                        this.isLoadingArticles = true;
                        this.articles = [];
                    }

                    const pageLimit = this.isMobile ? 15 : 40;
                    const params = new URLSearchParams({
                        page: this.currentPage,
                        limit: pageLimit,
                        filterType: this.selectedFilterType,
                        filterValue: this.selectedFilterValue || '',
                        hideRead: this.hideRead,
                        searchQuery: this.searchQuery || ''
                    });
                    if (this.selectedFilterType === 'smart' && this.smartClusterVersion && (isLoadMore || this._preserveSmartVersionCall)) {
                        params.set('smartVersion', this.smartClusterVersion);
                    }
                    this._preserveSmartVersionCall = false;
                    params.append('_t', Date.now().toString());

                    try {
                        const res = await fetch(`/api/data?${params.toString()}`);
                        if (res.ok) {
                            const data = await res.json();
                            if (requestGeneration !== this.articleRequestGeneration) return;
                            
                            if (isLoadMore) {
                                let newUniqueArticles = (data.articles || []).filter(a => !existingLinks.has(a.link));
                                if (this.hideRead) {
                                    newUniqueArticles = newUniqueArticles.filter(a => !this.readStates.includes(a.link));
                                }
                                this.articles = [...this.articles, ...newUniqueArticles];
                            } else {
                                this.feeds = data.feeds || [];
                                this.readStates = [...new Set([...(data.readStates || []), ...this.readStates])];
                                this.savedStates = [...new Set([...(data.savedStates || []), ...this.savedStates])];
                                this.boardStates = [...new Set([...(data.boardStates || []), ...this.boardStates])];
                                this.hiddenStates = [...new Set([...(data.hiddenStates || []), ...this.hiddenStates])];
                                
                                let newArticles = data.articles || [];
                                if (this.hideRead) {
                                    newArticles = newArticles.filter(a => !this.readStates.includes(a.link));
                                }
                                this.articles = newArticles;
                                
                                this.userPreferences = data.userPreferences || {};
                                this.categoryOrder = data.categoryOrder || [];
                                this.unreadCounts = data.unreadCounts || { feeds: {}, categories: {}, total: 0 };
                                if (data.smartClusterVersion) {
                                    this.smartClusterVersion = data.smartClusterVersion;
                                }
                            }
                            this.hasMore = data.hasMore !== undefined ? data.hasMore : false;
                            if (typeof this.saveState === 'function') this.saveState();
                            if (!isLoadMore && this.articles && this.articles.length > 0) {
                                setTimeout(() => this.prefetchArticlesList(this.articles.slice(0, 5), false), 250);
                            }
                        }
                    } catch (e) {
                        console.error("Failed to load data:", e);
                    } finally {
                        if (!isLoadMore && requestGeneration === this.articleRequestGeneration) this.isLoadingArticles = false;
                    }
                },

                async loadMore() {
                    if (!this.hasMore || this.isLoadingMore) return;
                    this.isLoadingMore = true;
                    this.currentPage++;
                    await this.fetchData(true);
                    this.isLoadingMore = false;
                    if (typeof this.saveState === 'function') this.saveState();
                },

                async goToPage(page) {
                    if (page < 1 || this.isLoadingMore) return;
                    if (!this.hasMore && page > this.currentPage) return;
                    this.isLoadingMore = true;
                    this.currentPage = page;
                    this.articles = [];
                    await this.fetchData(false, true);
                    this.isLoadingMore = false;
                    document.getElementById('scroll-container').scrollTo(0, 0);
                    if (typeof this.saveState === 'function') this.saveState();
                },

                handleScroll(event) {
                    if (this.isMobile || this.isLoadingArticles || this.isLoadingMore || !this.hasMore) return;
                    const container = event.target;
                    if (container.scrollHeight - container.scrollTop <= container.clientHeight + 300) {
                        this.loadMore();
                    }
                },

                get displayedArticles() {
                    return this.articles;
                },

                /* Alpine needs a key that is present and unique even when a
                   feed item has no `link` (or when a cluster exposes a
                   different canonical URL).  Undefined/duplicate keys make
                   Alpine reuse the previous card's DOM, which looks like a
                   flash of another article during scrolling. */
                articleKey(article, index = '') {
                    if (!article) return 'article:empty';
                    const identity = article.id || article.guid || article.originalLink || article.link;
                    const suffix = index === '' ? '' : ':' + String(index);
                    if (identity) return 'article:' + String(identity) + suffix;
                    return 'article:' + String(article.pubDate || '') + ':' + String(article.title || '') + suffix;
                },

                get categories() {
                    const catsMap = new Map();
                    this.feeds.forEach(f => {
                        const catName = f.category || 'Others';
                        if (!catsMap.has(catName)) {
                            catsMap.set(catName, { name: catName, feeds: [], unread: 0 });
                        }
                        let cat = catsMap.get(catName);
                        cat.feeds.push(f);
                        cat.unread = this.unreadCounts.categories[catName] || 0;
                    });
                    
                    let catArray = Array.from(catsMap.values());
                    catArray.sort((a, b) => {
                        let idxA = this.categoryOrder.indexOf(a.name);
                        let idxB = this.categoryOrder.indexOf(b.name);
                        if (idxA === -1) idxA = 999; 
                        if (idxB === -1) idxB = 999;
                        return idxA - idxB;
                    });
                    return catArray;
                },

                get headerTitle() {
                    if (this.selectedFilterType === 'smart') {
                        const labels = {
                            news_vietnam: 'Smart News · Vietnam',
                            news_world: 'Smart News · World',
                            finance_vietnam: 'Smart Finance · Vietnam',
                            finance_global: 'Smart Finance · Global',
                            tech: 'Smart Technology'
                        };
                        return labels[this.selectedFilterValue] || 'Smart News';
                    }
                    if (this.selectedFilterType === 'today') return 'Today';
                    if (this.selectedFilterType === 'recent') return 'Recently Read';
                    if (this.selectedFilterType === 'saved') return 'Read Later';
                    if (this.selectedFilterType === 'board') return 'Boards';
                    if (this.selectedFilterType === 'hidden') return 'Hidden Articles';
                    if (this.selectedFilterType === 'hot_today') return 'Hot Today';
                    if (this.selectedFilterType === 'hot_week') return 'Hot This Week';
                    if (this.selectedFilterType === 'views_today') return 'Most Views Today';
                    if (this.selectedFilterType === 'views_week') return 'Most Views This Week';
                    if (this.selectedFilterType === 'category') return this.selectedFilterValue;
                    if (this.selectedFilterType === 'feed') return this.feeds.find(f => f.url === this.selectedFilterValue)?.title || 'Feed';
                    return '';
                },

                get smartSection() {
                    if (this.selectedFilterValue && (this.selectedFilterValue === 'finance' || this.selectedFilterValue.startsWith('finance_'))) return 'finance';
                    if (this.selectedFilterValue && (this.selectedFilterValue === 'tech' || this.selectedFilterValue.startsWith('tech'))) return 'tech';
                    return 'news';
                },

                setSmartSection(section) {
                    const defaults = { news: 'news_vietnam', finance: 'finance_vietnam', tech: 'tech' };
                    this.setFilter('smart', defaults[section] || 'news_vietnam', true);
                },

                toggleCategory(name) {
                    if (this.expandedCategories.includes(name)) {
                        this.expandedCategories = this.expandedCategories.filter(c => c !== name);
                    } else {
                        this.expandedCategories.push(name);
                    }
                },

                setFilter(type, value, preserveVersion = false) {
                    if (type !== 'smart' || !preserveVersion || this.selectedFilterType !== 'smart') {
                        this.smartClusterVersion = '';
                    }
                    this._preserveSmartVersionCall = preserveVersion && this.selectedFilterType === 'smart';
                    this.selectedFilterType = type;
                    this.selectedFilterValue = value;
                    this.currentPage = 1;
                    this.hasMore = false;
                    this.articles = [];
                    this.mobileSidebarOpen = false;
                    const sc = document.getElementById('scroll-container');
                    if (sc) sc.scrollTo(0, 0);
                    this.fetchData();
                },

                handleCardClick(article, event) {
                    this.prefetchNextAfter(article);
                    if (this.isMobile) {
                        if (this.mobileActiveCard === article.link) {
                            this.openArticleOverlay(article);
                            this.mobileActiveCard = null;
                        } else {
                            this.mobileActiveCard = article.link;
                        }
                    } else {
                        this.openArticleOverlay(article);
                    }
                },

                dragStart(feed) { this.draggedUrl = feed.url; },
                dragEnd() { this.draggedUrl = null; this.dragTargetUrl = null; },
                async dropFeed(targetFeed) {
                    if (!this.draggedUrl || this.draggedUrl === targetFeed.url) return;
                    const sourceIdx = this.feeds.findIndex(f => f.url === this.draggedUrl);
                    const targetIdx = this.feeds.findIndex(f => f.url === targetFeed.url);
                    if (sourceIdx > -1 && targetIdx > -1) {
                        const [movedFeed] = this.feeds.splice(sourceIdx, 1);
                        movedFeed.category = targetFeed.category;
                        this.feeds.splice(targetIdx, 0, movedFeed);

                        await fetch('/api/feeds/reorder', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ feeds: this.feeds })
                        });
                    }
                    this.dragTargetUrl = null;
                },

                dragStartCategory(name) { this.draggedCategory = name; },
                dragEndCategory() { this.draggedCategory = null; this.dragTargetCategory = null; },
                async dropCategory(targetName) {
                    if (!this.draggedCategory || this.draggedCategory === targetName) return;
                    let currentNames = this.categories.map(c => c.name);
                    let newOrder = this.categoryOrder.filter(n => currentNames.includes(n));
                    currentNames.forEach(n => { if (!newOrder.includes(n)) newOrder.push(n); });
                    this.categoryOrder = newOrder;

                    const sourceIdx = this.categoryOrder.indexOf(this.draggedCategory);
                    const targetIdx = this.categoryOrder.indexOf(targetName);
                    if (sourceIdx > -1 && targetIdx > -1) {
                        const [movedCat] = this.categoryOrder.splice(sourceIdx, 1);
                        this.categoryOrder.splice(targetIdx, 0, movedCat);

                        await fetch('/api/categories/reorder', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ categoryOrder: this.categoryOrder })
                        });
                    }
                    this.dragTargetCategory = null;
                },

                async toggleState(listName, link) {
                    let isAdding = !this[listName].includes(link);
                    if (isAdding) {
                        this[listName].push(link);
                        if (listName === 'savedStates' || listName === 'boardStates') {
                            // Auto-cache article content in background when saved
                            fetch(`/api/article-content?url=${encodeURIComponent(link)}`).catch(() => {});
                        }
                    } else {
                        this[listName] = this[listName].filter(l => l !== link);
                    }
                    
                    if (listName === 'hiddenStates') {
                         const article = this.articles.find(a => a.link === link);
                         if (article && !this.readStates.includes(link)) {
                             if (isAdding) {
                                 if (this.unreadCounts.total > 0) this.unreadCounts.total--;
                                 if (this.unreadCounts.feeds[article.feedUrl] > 0) this.unreadCounts.feeds[article.feedUrl]--;
                                 let cat = article.feedCategory || 'Others';
                                 if (this.unreadCounts.categories[cat] > 0) this.unreadCounts.categories[cat]--;
                             } else {
                                 this.unreadCounts.total++;
                                 this.unreadCounts.feeds[article.feedUrl] = (this.unreadCounts.feeds[article.feedUrl] || 0) + 1;
                                 let cat = article.feedCategory || 'Others';
                                 this.unreadCounts.categories[cat] = (this.unreadCounts.categories[cat] || 0) + 1;
                             }
                         }
                    }

                    if (typeof this.saveState === 'function') this.saveState();
                    await fetch('/api/toggle', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ link: link, list: listName })
                    });
                },

                async markAsReadExplicit(link) {
                    this.prefetchNextAfter(link);
                    if (!this.readStates.includes(link)) {
                        this.readStates.push(link);
                        
                        const article = this.articles.find(a => a.link === link);
                        if (article && !this.hiddenStates.includes(link)) {
                            if (this.unreadCounts.total > 0) this.unreadCounts.total--;
                            if (this.unreadCounts.feeds[article.feedUrl] > 0) this.unreadCounts.feeds[article.feedUrl]--;
                            let cat = article.feedCategory || 'Others';
                            if (this.unreadCounts.categories[cat] > 0) this.unreadCounts.categories[cat]--;
                        }

                        if (typeof this.saveState === 'function') this.saveState();

                        await fetch('/api/toggle', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ link: link, list: 'readStates', forceAdd: true })
                        });
                    }
                },

                async markAllAsRead() {
                    const unreadInView = this.articles.filter(a => !this.readStates.includes(a.link) && !this.hiddenStates.includes(a.link));
                    let linksToMark = unreadInView.map(a => a.link);
                    
                    // Also mark all related articles as read
                    unreadInView.forEach(a => {
                        if (a.relatedArticles && Array.isArray(a.relatedArticles)) {
                            a.relatedArticles.forEach(r => {
                                if (!this.readStates.includes(r.link)) {
                                    linksToMark.push(r.link);
                                }
                            });
                        }
                    });
                    
                    linksToMark = [...new Set(linksToMark)]; // deduplicate
                    if (linksToMark.length === 0) return;

                    if (this.markAllUndoTimer) clearTimeout(this.markAllUndoTimer);
                    this.markAllUndo = {
                        links: [...linksToMark],
                        unreadCounts: JSON.parse(JSON.stringify(this.unreadCounts))
                    };
                    this.markAllUndoTimer = setTimeout(() => {
                        this.markAllUndo = null;
                        this.markAllUndoTimer = null;
                    }, 15000);

                    this.readStates = [...this.readStates, ...linksToMark];
                    
                    unreadInView.forEach(article => {
                        if (this.unreadCounts.total > 0) this.unreadCounts.total--;
                        if (this.unreadCounts.feeds[article.feedUrl] > 0) this.unreadCounts.feeds[article.feedUrl]--;
                        let cat = article.feedCategory || 'Others';
                        if (this.unreadCounts.categories[cat] > 0) this.unreadCounts.categories[cat]--;
                    });

                    if (typeof this.saveState === 'function') this.saveState();

                    await Promise.allSettled(linksToMark.map(link =>
                        fetch('/api/toggle', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ link: link, list: 'readStates', forceAdd: true })
                        })
                    ));
                },

                async undoMarkAllRead() {
                    if (!this.markAllUndo) return;
                    const undo = this.markAllUndo;
                    if (this.markAllUndoTimer) clearTimeout(this.markAllUndoTimer);
                    this.markAllUndo = null;
                    this.markAllUndoTimer = null;
                    const links = new Set(undo.links);
                    this.readStates = this.readStates.filter(link => !links.has(link));
                    this.unreadCounts = JSON.parse(JSON.stringify(undo.unreadCounts));
                    if (typeof this.saveState === 'function') this.saveState();
                    await Promise.allSettled(undo.links.map(link =>
                        fetch('/api/toggle', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ link, list: 'readStates', forceRemove: true })
                        })
                    ));
                },
                
                openEditModal(feed) {
                    this.editingFeed = feed;
                    this.editFeedTitle = feed.title;
                    this.editFeedCategoryDropdown = feed.category;
                    this.editFeedCategoryNew = '';
                    this.editModalOpen = true;
                },
                
                async saveEditFeed() {
                    this.isSavingEdit = true;
                    let newCat = this.editFeedCategoryDropdown === 'CREATE_NEW' ? this.editFeedCategoryNew : this.editFeedCategoryDropdown;
                    if(!newCat) newCat = 'Others';
                    try {
                        const response = await fetch('/api/feeds', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url: this.editingFeed.url, title: this.editFeedTitle, category: newCat })
                        });
                        if(response.ok) {
                            this.fetchData();
                            this.editModalOpen = false;
                        }
                    } catch(e) {
                        alert("Failed to edit feed.");
                    } finally {
                        this.isSavingEdit = false;
                    }
                },

                async addFeed() {
                    if (!this.newFeedUrl) return;
                    this.isAdding = true;
                    
                    let urlToSubmit = this.newFeedUrl.trim();
                    if (!urlToSubmit.startsWith('http://') && !urlToSubmit.startsWith('https://')) {
                        urlToSubmit = 'https://' + urlToSubmit;
                    }
                    
                    let catToSubmit = 'Others';
                    if (this.selectedDropdownCategory === 'CREATE_NEW' && this.newFeedCategory) {
                        catToSubmit = this.newFeedCategory;
                    } else if (this.selectedDropdownCategory && this.selectedDropdownCategory !== 'CREATE_NEW') {
                        catToSubmit = this.selectedDropdownCategory;
                    }
                    
                    try {
                        const response = await fetch('/api/feeds', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url: urlToSubmit, category: catToSubmit })
                        });
                        if (!response.ok) {
                            const errText = await response.text();
                            throw new Error(errText);
                        }
                        
                        this.newFeedUrl = '';
                        this.newFeedCategory = '';
                        this.selectedDropdownCategory = '';
                        await this.syncNow();
                    } catch (e) {
                        console.error(e);
                        alert("Failed to add feed: " + e.message);
                    } finally {
                        this.isAdding = false;
                    }
                },

                async removeFeed(feed) {
                    if (confirm("Remove " + feed.title + "?")) {
                        this.feeds = this.feeds.filter(f => f.url !== feed.url);
                        if (this.selectedFilterValue === feed.url) this.setFilter('today', null);
                        
                        await fetch('/api/feeds', {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url: feed.url })
                        });
                        this.syncNow();
                    }
                },

                async syncNow() {
                    let isRefreshingAll = true;
                    if (this.selectedFilterType === 'feed' && this.selectedFilterValue) {
                        isRefreshingAll = false;
                    } else if ((this.selectedFilterType === 'category' || this.selectedFilterType === 'smart') && this.selectedFilterValue) {
                        isRefreshingAll = false;
                    }
                    if (isRefreshingAll) {
                        if (!confirm("Are you sure you want to refresh all articles? This might take a while.")) return;
                    }
                    const requestId = 'sync-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
                    this.isSyncing = true;
                    if (this.syncProgressInterval) clearInterval(this.syncProgressInterval);
                    this.syncProgress = { visible: true, message: 'Preparing refresh…', done: false, failed: false, current: 0, total: 0, requestId };
                    const updateProgress = async () => {
                        try {
                            const response = await fetch('/api/sync-progress?id=' + encodeURIComponent(requestId));
                            if (!response.ok) return;
                            const progress = await response.json();
                            if (this.syncProgress.requestId !== requestId) return;
                            this.syncProgress = { ...this.syncProgress, ...progress, visible: true, requestId };
                        } catch (e) { }
                    };
                    this.syncProgressInterval = setInterval(updateProgress, 450);
                    try {
                        let payload = {};
                        if (this.selectedFilterType === 'feed' && this.selectedFilterValue) {
                            payload.feedUrl = this.selectedFilterValue;
                        } else if ((this.selectedFilterType === 'category' || this.selectedFilterType === 'smart') && this.selectedFilterValue) {
                            payload.category = this.selectedFilterValue;
                        }
                        payload.requestId = requestId;
                        
                        const endpoint = this.selectedFilterType === 'smart' ? '/api/smart-sync' : '/api/sync';
                        const response = await fetch(endpoint, { 
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        if (!response.ok) throw new Error('Refresh request failed');
                        await this.fetchData(); 
                        this.syncProgress = { ...this.syncProgress, message: 'Refresh complete.', done: true, failed: false, visible: true };
                    } catch (e) {
                        console.error("[Sync Engine] Critical failure during sync:", e);
                        this.syncProgress = { ...this.syncProgress, message: 'Refresh failed. Please try again.', done: true, failed: true, visible: true };
                    } finally {
                        if (this.syncProgressInterval) clearInterval(this.syncProgressInterval);
                        this.syncProgressInterval = null;
                        this.isSyncing = false;
                        setTimeout(() => {
                            if (this.syncProgress.requestId === requestId && this.syncProgress.done) this.syncProgress.visible = false;
                        }, 5000);
                    }
                },

                stripHtml(html) {
                    if (!html) return '';
                    let text = html.replace(/<[^>]*>?/gm, '');
                    for (let pass = 0; pass < 3; pass++) {
                        const doc = new DOMParser().parseFromString(text, 'text/html');
                        const decoded = doc.body.textContent || '';
                        if (decoded === text) break;
                        text = decoded;
                    }
                    return text.trim().replace(/^\*\*([\s\S]*?)\*\*$/, '$1').trim();
                },

                articleFetchStrategyLabel(strategy) {
                    return ({
                        direct: 'Publisher website',
                        cloudflare: 'Cloudflare reader proxy',
                        vietserver: 'Vietnam reader proxy',
                        allorigins: 'AllOrigins backup proxy',
                        jina: 'Jina Reader',
                        opencli: 'OpenCLI browser reader'
                    })[strategy] || strategy;
                },

                overlaySuccessfulStrategies() {
                    return Object.keys(this.overlayMethodResults || {});
                },

                applyOverlayArticleData(data, fallbackArticle = null) {
                    if (!data || data.error) return;
                    if (!this.articleContentCache) this.articleContentCache = new Map();
                    const targetUrl = data.url || fallbackArticle?.originalLink || fallbackArticle?.link || this.overlayArticle?.originalLink || this.overlayArticle?.link;
                    if (targetUrl) {
                        this.articleContentCache.set(targetUrl, data);
                        if (this.articleContentCache.size > 60) {
                            const firstKey = this.articleContentCache.keys().next().value;
                            this.articleContentCache.delete(firstKey);
                        }
                    }
                    const strategy = data.fetchStrategy || '';
                    if (strategy && strategy !== 'none') this.overlayMethodResults = { ...this.overlayMethodResults, [strategy]: { ...data } };
                    this.stopArticleSpeech();
                    this.overlayPagination = data.pagination || null;
                    this.overlayContent = this.beautifyArticleHtml(data.content, data.title || fallbackArticle?.title || this.overlayArticle?.title);
                    this.overlayHasNativeAudio = /<audio\b/i.test(this.overlayContent || '');
                    if (!this.overlayHasNativeAudio) this.prepareArticleSpeech();
                    this.overlayArticle.overlayTitle = this.stripHtml(data.title || fallbackArticle?.title || this.overlayArticle.title);
                    this.overlayArticle.overlayImage = data.image || fallbackArticle?.image || this.overlayArticle.image;
                    this.overlayArticle.overlayAuthor = data.author || '';
                    this.overlayArticle.overlayDate = data.date || fallbackArticle?.pubDate || this.overlayArticle.pubDate;
                    
                    if (data.image && !this.overlayArticle.image) this.overlayArticle.image = data.image;
                    if (data.author && !this.overlayArticle.author) this.overlayArticle.author = data.author;
                    this.overlayArticle.siteName = data.siteName || this.overlayArticle.siteName || '';
                    this.overlayArticle.isCached = Boolean(data.cached);
                    if (data.url && data.url !== this.overlayArticle.link) {
                        this.overlayArticle.originalLink ||= this.overlayArticle.link;
                        this.overlayArticle.link = data.url;
                    }
                    this.overlayFetchStrategy = strategy;
                    this.overlayFetchedFromCache = data.cached === true;
                    this.overlayMethodPreferences = { ...this.overlayMethodPreferences, ...(data.methodPreferences || {}) };
                    this.overlayAttemptedStrategies = [...new Set([
                        ...this.overlayAttemptedStrategies,
                        ...(data.attemptedStrategies || []),
                        strategy
                    ].filter(Boolean))];
                    this.checkVozThreadPosition();
                    this.$nextTick(() => {
                        if (window.Hls) {
                            document.querySelectorAll('.article-rendered-content video').forEach(video => {
                                let src = video.getAttribute('src');
                                if (!src) {
                                    const sourceTag = video.querySelector('source[src*=".m3u8"], source[type="application/x-mpegURL"]');
                                    if (sourceTag) src = sourceTag.getAttribute('src');
                                }
                                if (src && src.includes('.m3u8')) {
                                    if (Hls.isSupported()) {
                                        video.removeAttribute('src');
                                        video.querySelectorAll('source').forEach(s => s.remove());
                                        const hls = new Hls();
                                        hls.loadSource(src);
                                        hls.attachMedia(video);
                                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                                        video.src = src;
                                    }
                                }
                            });
                        }
                    });
                },

                checkVozThreadPosition() {
                    this.vozThreadNotice = null;
                    if (!this.overlayArticle) return;
                    const url = this.overlayArticle.link || '';
                    const isVoz = url.includes('voz.vn') || this.overlayArticle.siteName === 'VOZ';
                    if (!isVoz) return;
                    const threadMatch = url.match(/threads\/[^\/.]+\.(\d+)/i) || url.match(/\b(\d{5,8})\b/);
                    const threadId = threadMatch ? threadMatch[1] : url;
                    const prefKey = 'voz_last_read_post_' + threadId;
                    const lastRead = this.userPreferences[prefKey] || localStorage.getItem(prefKey);
                    
                    if (this.overlayFetchedFromCache) {
                        this.checkVozNewPostsInBackground(url);
                    }
                    
                    if (this.vozPollingInterval) {
                        clearInterval(this.vozPollingInterval);
                        this.vozPollingInterval = null;
                    }

                    if (lastRead && Number(lastRead) > 1 && this.vozInitialThreadLoad) {
                        const requestId = this.overlayRequestId;
                        let attempts = 0;
                        const checkAndScroll = () => {
                            if (!this.articleOverlayOpen || this.overlayRequestId !== requestId) return;
                            const postEl = document.getElementById('voz-post-' + lastRead);
                            if (postEl && postEl.offsetParent !== null) {
                                postEl.scrollIntoView({ behavior: 'auto', block: 'center' });
                                
                                const existingNotice = document.getElementById('voz-inline-notice');
                                if (existingNotice) existingNotice.remove();
                                
                                const inlineNotice = document.createElement('div');
                                inlineNotice.id = 'voz-inline-notice';
                                inlineNotice.className = 'mb-3 px-4 py-2.5 bg-blue-900 text-blue-200 rounded-xl border border-blue-700 flex justify-between items-center text-sm font-medium shadow-sm';
                                inlineNotice.innerHTML = `<span>📍 Bạn đã quay lại đúng vị trí bài viết #${lastRead} mà bạn đang đọc lần trước!</span><button class="text-blue-600 dark:text-blue-400 hover:opacity-80 ml-4 font-bold text-lg" onclick="this.parentElement.remove()" title="Đóng">&times;</button>`;
                                postEl.parentElement.insertBefore(inlineNotice, postEl);
                            } else if (attempts < 30) {
                                attempts++;
                                setTimeout(checkAndScroll, 100); // Poll every 100ms for up to 3 seconds
                            } else {
                                const targetPage = Math.ceil(Number(lastRead) / 20);
                                const currentPage = this.overlayPagination ? this.overlayPagination.currentPage : 1;
                                if (targetPage !== currentPage && this.overlayPagination?.pages?.some(p => p.page === targetPage)) {
                                    const pageObj = this.overlayPagination.pages.find(p => p.page === targetPage);
                                    this.vozThreadNotice = {
                                        text: `📍 Lần trước bạn đang đọc bài #${lastRead} (Trang ${targetPage}).`,
                                        actionText: `Chuyển sang Trang ${targetPage} →`,
                                        action: () => this.navigateToThreadPage(pageObj.url, true)
                                    };
                                } else {
                                    this.vozThreadNotice = {
                                        text: `📍 Lần trước bạn đã đọc đến bài #${lastRead}.`,
                                        actionText: 'Ẩn',
                                        action: () => { this.vozThreadNotice = null; }
                                    };
                                }
                            }
                        };
                        checkAndScroll();
                    }
                },

                syncUserPreferenceDebounced(key, value) {
                    if (!this.syncPrefsTimer) this.syncPrefsTimer = {};
                    if (String(this.userPreferences[key] ?? '') === String(value ?? '')) return;
                    clearTimeout(this.syncPrefsTimer[key]);
                    this.userPreferences[key] = value;
                    try { localStorage.setItem(key, value); } catch(e) {}
                    
                    this.syncPrefsTimer[key] = setTimeout(() => {
                        fetch('/api/user-preferences', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.password },
                            body: JSON.stringify({ key, value })
                        }).catch(() => {});
                    }, 2000);
                },

                trackVozThreadScroll(event) {
                    if (!this.overlayArticle || !this.articleOverlayOpen) return;
                    const url = this.overlayArticle.link || '';
                    if (!url.includes('voz.vn') && this.overlayArticle.siteName !== 'VOZ') return;
                    const container = event.currentTarget || event.target;
                    if (!container || this.vozScrollRaf) return;
                    this.vozScrollRaf = requestAnimationFrame(() => {
                        this.vozScrollRaf = 0;
                        if (!this.overlayArticle || !this.articleOverlayOpen) return;
                        const now = performance.now();
                        if (now - this.lastVozMeasureAt < 120) return;
                        this.lastVozMeasureAt = now;
                        const posts = Array.from(container.querySelectorAll('.voz-post[data-post-index]'));
                        if (!posts.length) return;
                        const containerRect = container.getBoundingClientRect();
                        let topPost = posts[0];
                        for (const post of posts) {
                            if (post.getBoundingClientRect().top >= containerRect.top - 50) {
                                topPost = post;
                                break;
                            }
                        }
                        const index = topPost.getAttribute('data-post-index');
                        if (!index || index === this.lastTrackedVozPost) return;
                        this.lastTrackedVozPost = index;
                        const currentUrl = this.overlayArticle.link || '';
                        const threadMatch = currentUrl.match(/threads\/[^\/.]+\.(\d+)/i) || currentUrl.match(/\b(\d{5,8})\b/);
                        const threadId = threadMatch ? threadMatch[1] : currentUrl;
                        this.syncUserPreferenceDebounced('voz_last_read_post_' + threadId, index);
                    });
                },

                async checkVozNewPostsInBackground(url) {
                    const requestId = this.overlayRequestId;
                    try {
                        const res = await fetch('/api/article-content?url=' + encodeURIComponent(url) + '&bypassCache=true');
                        if (!res.ok) return;
                        const freshData = await res.json();
                        if (!freshData || freshData.error) return;
                        /* Never let a background refresh for an old article
                           write into the newly opened article. */
                        if (!this.articleOverlayOpen || this.overlayRequestId !== requestId) return;
                        const activeUrl = this.overlayArticle?.link || this.overlayArticle?.originalLink || '';
                        if (activeUrl !== url && this.overlayArticle?.originalLink !== url) return;

                        const renderedContainer = document.querySelector('#overlay-scroll-container .article-rendered-content');
                        const currentPostsCount = renderedContainer
                            ? renderedContainer.querySelectorAll('.voz-post[data-post-index], .voz-post').length
                            : (this.overlayContent?.match(/class=["'][^"']*voz-post[^"']*["']/gi) || []).length;
                        const freshPostsCount = (freshData.content?.match(/class=["'][^"']*voz-post[^"']*["']/gi) || []).length;
                        const currentPageNum = this.overlayPagination?.currentPage || 1;
                        const freshPageNum = freshData.pagination?.currentPage || 1;

                        const isNewPage = freshPageNum > currentPageNum;
                        
                        if (freshPostsCount > 0) {
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(freshData.content, 'text/html');
                            const freshPosts = Array.from(doc.querySelectorAll('.voz-post'));
                            let contentUpdated = false;
                            
                            if (renderedContainer && this.overlayRequestId === requestId) {
                                const currentPosts = Array.from(renderedContainer.querySelectorAll('.voz-post'));
                                
                                freshPosts.forEach(freshPost => {
                                    const id = freshPost.id;
                                    if (!id) return;
                                    const currentPost = currentPosts.find(p => p.id === id);
                                    
                                    if (currentPost) {
                                        if (currentPost.innerHTML !== freshPost.innerHTML) {
                                            currentPost.innerHTML = freshPost.innerHTML;
                                            contentUpdated = true;
                                        }
                                    } else {
                                        renderedContainer.appendChild(freshPost.cloneNode(true));
                                        contentUpdated = true;
                                    }
                                });
                                
                                if (contentUpdated) {
                                    this.overlayContent = renderedContainer.innerHTML;
                                    this.overlayPagination = freshData.pagination || this.overlayPagination;
                                    const cached = this.articleContentCache?.get(url);
                                    if (cached) {
                                        cached.content = this.overlayContent;
                                        cached.pagination = this.overlayPagination;
                                    }
                                }
                            }
                            
                            if (contentUpdated && (freshData.url || url)) {
                                const cacheKey = 'article_cache_v26_' + (freshData.url || url);
                                try { localStorage.setItem(cacheKey, JSON.stringify({ data: { ...freshData, content: this.overlayContent }, timestamp: Date.now() })); } catch(e) {}
                            }
                        }
                    } catch(e) {}
                },

                async navigateToThreadPage(targetUrl, isResume = false) {
                    if (!targetUrl || this.isLoadingOverlay) return;
                    const requestId = 'thread-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
                    this.overlayRequestId = requestId;
                    this.vozInitialThreadLoad = isResume;
                    this.lastVozMeasureAt = 0;
                    this.lastTrackedVozPost = '';
                    this.stopArticleSpeech();
                    this.isLoadingOverlay = true;
                    this.overlayContent = null;
                    this.overlayError = null;
                    const threadScroll = document.getElementById('overlay-scroll-container');
                    if (threadScroll) threadScroll.scrollTop = 0;
                    if (this.overlayArticle) {
                        this.overlayArticle.originalLink ||= this.overlayArticle.link;
                        this.overlayArticle.link = targetUrl;
                    }
                    try {
                        const cached = this.articleContentCache ? this.articleContentCache.get(targetUrl) : null;
                        if (cached) {
                            if (!this.articleOverlayOpen || this.overlayRequestId !== requestId) return;
                            this.applyOverlayArticleData(cached, this.overlayArticle);
                            return;
                        }
                        const res = await fetch('/api/article-content?url=' + encodeURIComponent(targetUrl));
                        const data = await res.json();
                        if (!this.articleOverlayOpen || this.overlayRequestId !== requestId) return;
                        if (!res.ok || data.error) throw new Error(data.error || 'Trang không tồn tại hoặc lỗi tải');
                        this.applyOverlayArticleData(data, this.overlayArticle);
                    } catch (e) {
                        if (this.overlayRequestId === requestId) this.overlayError = e.message;
                    } finally {
                        if (this.overlayRequestId === requestId) this.isLoadingOverlay = false;
                    }
                },

                switchOverlayFetchStrategy(strategy) {
                    const data = this.overlayMethodResults[strategy];
                    if (!data) return;
                    this.applyOverlayArticleData(data, this.overlayArticle);
                    this.overlayFetchedFromCache = data.cached === true;
                    this.overlayMethodError = '';
                },

                async setArticleFetchPreference(strategy, preference) {
                    const current = this.overlayMethodPreferences[strategy] || '';
                    const nextPreference = current === preference ? '' : preference;
                    const previous = current;
                    this.overlayMethodPreferences = { ...this.overlayMethodPreferences, [strategy]: nextPreference };
                    try {
                        const response = await fetch('/api/article-fetch-preference', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                url: this.overlayArticle?.link,
                                strategy,
                                preference: nextPreference
                            })
                        });
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error || 'Could not save method preference.');
                        this.overlayMethodPreferences = data.preferences || this.overlayMethodPreferences;
                    } catch (error) {
                        this.overlayMethodPreferences = { ...this.overlayMethodPreferences, [strategy]: previous };
                        this.overlayMethodError = error.message;
                    }
                },

                async clearArticleCache() {
                    if (!this.overlayArticle || !this.overlayFetchedFromCache) return;
                    const targetUrl = this.overlayArticle.originalLink || this.overlayArticle.link;
                    if (!targetUrl) return;
                    
                    try {
                        const res = await fetch('/api/clear-article-cache', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url: targetUrl })
                        });
                        if (res.ok) {
                            if (this.articleContentCache) this.articleContentCache.delete(targetUrl);
                            this.overlayArticle.isCached = false;
                            this.openArticleOverlay(this.overlayArticle);
                        }
                    } catch (e) {
                        console.error('Failed to clear cache:', e);
                    }
                },

                async rejectAndTryNextArticleMethod() {
                    if (this.overlayTryingMethod || !this.overlayFetchStrategy || !this.overlayArticle) return;
                    const rejected = this.overlayFetchStrategy;
                    const targetUrl = this.overlayArticle.originalLink || this.overlayArticle.link;
                    this.overlayRejectedStrategies = [...new Set([...this.overlayRejectedStrategies, rejected])];
                    this.overlayTryingMethod = true;
                    this.overlayMethodError = '';
                    const requestId = 'article-method-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
                    this.overlayRequestId = requestId;
                    this.overlayProgress = { message: 'Rejecting this result and choosing the next reader method…' };
                    if (this.overlayProgressInterval) clearInterval(this.overlayProgressInterval);
                    const updateProgress = async () => {
                        try {
                            const response = await fetch('/api/article-content-progress?id=' + encodeURIComponent(requestId));
                            if (!response.ok || this.overlayRequestId !== requestId) return;
                            this.overlayProgress = await response.json();
                        } catch (e) { }
                    };
                    this.overlayProgressInterval = setInterval(updateProgress, 400);
                    const exclude = [...new Set(this.overlayAttemptedStrategies)].join(',');
                    try {
                        const params = new URLSearchParams({
                            url: targetUrl,
                            requestId,
                            reject: rejected,
                            exclude,
                            title: this.overlayArticle.title || '',
                            feedTitle: this.overlayArticle.feedTitle || '',
                            feedUrl: this.overlayArticle.feedUrl || '',
                            feedIcon: this.overlayArticle.feedIcon || ''
                        });
                        const response = await fetch('/api/article-content?' + params.toString());
                        const data = await response.json();
                        if (!this.articleOverlayOpen || this.overlayRequestId !== requestId) return;
                        this.overlayAttemptedStrategies = [...new Set([...this.overlayAttemptedStrategies, ...(data.attemptedStrategies || [])])];
                        if (!response.ok || data.error) throw new Error(data.error || 'No other reader method could load this article.');
                        this.applyOverlayArticleData(data, this.overlayArticle);
                    } catch (error) {
                        if (this.overlayRequestId === requestId) this.overlayMethodError = error.message;
                    } finally {
                        if (this.overlayRequestId === requestId) {
                            if (this.overlayProgressInterval) clearInterval(this.overlayProgressInterval);
                            this.overlayProgressInterval = null;
                            this.overlayTryingMethod = false;
                        }
                    }
                },

                supportsArticleSpeech() {
                    return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
                },

                stopArticleSpeech() {
                    this.articleSpeechGeneration += 1;
                    if (this.supportsArticleSpeech()) window.speechSynthesis.cancel();
                    this.articleSpeechState = 'idle';
                    this.articleSpeechChunks = [];
                    this.articleSpeechIndex = 0;
                },

                prepareArticleSpeech() {
                    if (!this.supportsArticleSpeech()) return;
                    const doc = new DOMParser().parseFromString(this.overlayContent || '', 'text/html');
                    doc.querySelectorAll('audio,video,figcaption').forEach(node => node.remove());
                    const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
                    if (!text) return;
                    const sentences = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [text];
                    const chunks = [];
                    let current = '';
                    for (const sentence of sentences) {
                        const next = (current + ' ' + sentence.trim()).trim();
                        if (current && next.length > 260) {
                            chunks.push(current);
                            current = sentence.trim();
                        } else current = next;
                    }
                    if (current) chunks.push(current);
                    this.articleSpeechChunks = chunks;
                    this.articleSpeechIndex = 0;
                    this.articleSpeechState = 'idle';
                },

                toggleArticleSpeech() {
                    if (!this.supportsArticleSpeech()) return;
                    if (this.articleSpeechState === 'playing') {
                        window.speechSynthesis.pause();
                        this.articleSpeechState = 'paused';
                        return;
                    }
                    if (this.articleSpeechState === 'paused') {
                        window.speechSynthesis.resume();
                        this.articleSpeechState = 'playing';
                        return;
                    }

                    if (!this.articleSpeechChunks.length) this.prepareArticleSpeech();
                    if (!this.articleSpeechChunks.length) return;
                    if (this.articleSpeechIndex >= this.articleSpeechChunks.length - 1) this.articleSpeechIndex = 0;
                    this.articleSpeechState = 'playing';
                    this.speakNextArticleChunk();
                },

                seekArticleSpeech(index) {
                    if (!this.articleSpeechChunks.length) return;
                    this.articleSpeechGeneration += 1;
                    window.speechSynthesis.cancel();
                    this.articleSpeechIndex = Math.max(0, Math.min(this.articleSpeechChunks.length - 1, Number(index) || 0));
                    this.articleSpeechState = 'playing';
                    setTimeout(() => this.speakNextArticleChunk(), 0);
                },

                skipArticleSpeech(direction) {
                    this.seekArticleSpeech(this.articleSpeechIndex + (Number(direction) || 0));
                },

                articleSpeechProgressLabel() {
                    if (!this.articleSpeechChunks.length) return '0 / 0';
                    return (this.articleSpeechIndex + 1) + ' / ' + this.articleSpeechChunks.length;
                },

                speakNextArticleChunk() {
                    if (!this.supportsArticleSpeech() || this.articleSpeechState === 'idle') return;
                    if (this.articleSpeechIndex >= this.articleSpeechChunks.length) {
                        this.articleSpeechState = 'idle';
                        this.articleSpeechIndex = Math.max(0, this.articleSpeechChunks.length - 1);
                        return;
                    }
                    const generation = this.articleSpeechGeneration;
                    const utterance = new SpeechSynthesisUtterance(this.articleSpeechChunks[this.articleSpeechIndex]);
                    let isVietnamese = false;
                    try { isVietnamese = new URL(this.overlayArticle?.link || '').hostname.endsWith('.vn'); } catch (e) { }
                    utterance.lang = isVietnamese ? 'vi-VN' : (navigator.language || 'en-US');
                    const languagePrefix = utterance.lang.split('-')[0].toLowerCase();
                    const voice = window.speechSynthesis.getVoices().find(candidate => String(candidate.lang || '').toLowerCase().startsWith(languagePrefix));
                    if (voice) utterance.voice = voice;
                    utterance.onend = () => {
                        if (generation !== this.articleSpeechGeneration || this.articleSpeechState === 'idle') return;
                        this.articleSpeechIndex += 1;
                        this.speakNextArticleChunk();
                    };
                    utterance.onerror = event => {
                        if (!['canceled', 'interrupted'].includes(event.error)) this.stopArticleSpeech();
                    };
                    window.speechSynthesis.speak(utterance);
                },

                beautifyArticleHtml(html, title = '') {
                    if (!html) return '';
                    const doc = new DOMParser().parseFromString(String(html), 'text/html');
                    doc.querySelectorAll('script,style,template,nav,aside,form,noscript,button,[aria-hidden="true"]').forEach(node => node.remove());
                    const noise = /(?:advert|adsbygoogle|breadcrumb|pagination|related|recommend|share|social|signature|message-user|message-attribution|message-footer|post-meta|author-box|author-info|user-panel|member-header|comment-list|comments-area|newsletter|subscribe|trending|popular-post|read-more|tags-list)/i;
                    doc.body.querySelectorAll('*').forEach(node => {
                        const marker = [node.id, node.className, node.getAttribute('role')].filter(value => typeof value === 'string').join(' ');
                        if (noise.test(marker)) {
                            node.remove();
                            return;
                        }
                        if (['DIV', 'P', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(node.tagName)) {
                            const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
                            if (/^Quảng cáo$/i.test(text)) {
                                node.remove();
                                return;
                            }
                        }
                        const isMediaNode = ['IMG', 'VIDEO', 'AUDIO', 'IFRAME'].includes(node.tagName);
                        const isProtectedNode = node.classList.contains('voz-post-likes') || node.closest('.voz-post-likes') || node.classList.contains('box_tiso_all') || node.closest('.box_tiso_all') || node.classList.contains('highcharts-container') || node.closest('.highcharts-container');
                        if (!isProtectedNode) {
                            if (!isMediaNode || node.tagName === 'IMG') {
                                node.removeAttribute('style');
                                node.removeAttribute('height');
                                node.removeAttribute('min-height');
                                node.removeAttribute('max-height');
                                node.removeAttribute('width');
                            }
                        }
                        [...node.attributes].forEach(attribute => {
                            if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
                        });
                    });
                    doc.body.querySelectorAll('div,section,ul').forEach(node => {
                        if (!node.isConnected) return;
                        if (node.classList.contains('embedded-suggested-articles') || node.closest('.embedded-suggested-articles') || node.classList.contains('styled-rel-card') || node.closest('.styled-rel-card')) return;
                        const textLength = (node.textContent || '').replace(/\s+/g, ' ').trim().length;
                        const links = [...node.querySelectorAll('a')];
                        const linkLength = links.reduce((sum, link) => sum + (link.textContent || '').trim().length, 0);
                        if (links.length >= 4 && textLength > 0 && linkLength / textLength > 0.78) node.remove();
                    });
                    const semanticBoundary = /^(?:Đọc tiếp\s*Về trang Chủ đề|Tặng sao cho bài viết hay|Đừng bỏ lỡ|Advertisements|(?:Bình luận|Comments)\s*\(\s*\d+\s*\)|Tin liên quan|Related stories|You may also like|Recommended for you|More stories|Read next|Tuổi Trẻ Online Newsletters)\b/i;
                    const boundary = [...doc.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,div,section')].find(node => {
                        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
                        if (!semanticBoundary.test(text)) return false;
                        const range = doc.createRange();
                        range.setStart(doc.body, 0);
                        range.setEndBefore(node);
                        return range.toString().replace(/\s+/g, ' ').trim().length >= 400;
                    });
                    if (boundary) {
                        let parent = boundary.parentNode;
                        let cursor = boundary;
                        while (cursor) {
                            const next = cursor.nextSibling;
                            cursor.remove();
                            cursor = next;
                        }
                        while (parent && parent !== doc.body) {
                            let sibling = parent.nextSibling;
                            while (sibling) {
                                const next = sibling.nextSibling;
                                sibling.remove();
                                sibling = next;
                            }
                            parent = parent.parentNode;
                        }
                    }
                    doc.body.querySelectorAll('img,video,audio').forEach(media => {
                        const lazy = media.getAttribute('data-src') || media.getAttribute('data-url') || media.getAttribute('data-original') || media.getAttribute('data-lazy-src');
                        if (lazy) media.setAttribute('src', lazy);
                        const mediaMarker = [media.getAttribute('src'), media.getAttribute('alt'), media.getAttribute('class')].filter(Boolean).join(' ');
                        if (/(?:newsletter|captcha|default[-_ ]?avatar|userdeff?ault|draggable-icon|cmsads|admicro|doubleclick|googlesyndication)/i.test(mediaMarker)) {
                            media.remove();
                            return;
                        }
                        const width = Number(media.getAttribute('width') || 0);
                        const height = Number(media.getAttribute('height') || 0);
                        if ((width && width <= 2) || (height && height <= 2)) media.remove();
                        if (media.tagName === 'VIDEO' || media.tagName === 'AUDIO') {
                            media.setAttribute('controls', '');
                            media.setAttribute('playsinline', '');
                        }
                    });
                    doc.body.querySelectorAll('audio').forEach(audio => {
                        let player = audio.closest('.article-audio-player');
                        if (!player) {
                            player = doc.createElement('div');
                            player.className = 'article-audio-player';
                            audio.parentNode?.insertBefore(player, audio);
                            player.appendChild(audio);
                        }
                        if (!player.querySelector('.article-audio-player__label')) {
                            const label = doc.createElement('div');
                            label.className = 'article-audio-player__label';
                            label.textContent = 'Listen to article';
                            player.insertBefore(label, player.firstChild);
                        }
                        audio.setAttribute('controls', '');
                        audio.setAttribute('playsinline', '');
                        audio.setAttribute('preload', 'metadata');
                    });
                    doc.body.querySelectorAll('.bbCodeBlock--unfurl').forEach(node => {
                        let href = node.getAttribute('data-url') || '';
                        if (!href) {
                            const titleLink = node.querySelector('.contentRow-header a');
                            if (titleLink) href = titleLink.href;
                        }
                        if (href) {
                            node.style.setProperty('position', 'relative', 'important');
                            const overlay = doc.createElement('a');
                            overlay.href = href;
                            overlay.target = '_blank';
                            overlay.className = 'embedded-suggested-overlay';
                            node.appendChild(overlay);
                        }
                    });
                    
                    if (!html.includes('voz-post')) {
                        doc.body.querySelectorAll('a:not(.voz-post-index):not(.voz-like-users):not(.embedded-suggested-overlay):not(.bbCodeBlock--unfurl)').forEach(link => link.replaceWith(...link.childNodes));
                    } else {
                        doc.body.querySelectorAll('a').forEach(link => link.setAttribute('target', '_blank'));
                    }
                    doc.body.querySelectorAll('p,div,span,section').forEach(node => {
                        if (!node.isConnected || node.querySelector('audio,video,img')) return;
                        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
                        const isPageControl = /^(?:chia sẻ|share|báo lỗi(?: cho .*)?|gửi email|in bài viết|copy link)$/i.test(text);
                        const isDuplicateByline = /^[^|]{2,100}\|\s*\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}$/.test(text);
                        const isAudioLabel = /^Audio\s+\d+$/i.test(text);
                        if (isPageControl || isDuplicateByline || isAudioLabel) node.remove();
                    });
                    const normalizedTitle = this.stripHtml(title).replace(/\s+/g, ' ').trim().toLowerCase();
                    const firstHeading = doc.body.querySelector('h1,h2,h3');
                    if (firstHeading && normalizedTitle && (firstHeading.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === normalizedTitle) firstHeading.remove();
                    for (let pass = 0; pass < 4; pass++) {
                        doc.body.querySelectorAll('p:empty,div:empty,span:empty,section:empty,figure:empty').forEach(node => node.remove());
                    }
                    doc.body.querySelectorAll('table').forEach(table => {
                        if (!table.parentElement.classList.contains('overflow-x-auto')) {
                            const wrapper = doc.createElement('div');
                            wrapper.className = 'overflow-x-auto my-4';
                            table.parentElement.insertBefore(wrapper, table);
                            wrapper.appendChild(table);
                            table.style.minWidth = 'max-content';
                        }
                    });
                    return doc.body.innerHTML.trim();
                },

                sortedRelatedArticles(articles) {
                    return [...(Array.isArray(articles) ? articles : [])].sort((a, b) =>
                        (Number(b.sourceWeight) || 1) - (Number(a.sourceWeight) || 1) ||
                        (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0) ||
                        String(a.link || '').localeCompare(String(b.link || ''))
                    );
                },

                formatLogTime(ts) {
                    const d = new Date(ts);
                    return d.toLocaleString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false });
                },

                async openLogsPanel() {
                    this.logsPanelOpen = true;
                    this.mobileSidebarOpen = false;
                    this.logsTab = 'stats';
                    await this.fetchSyncStatus();
                    // Only fetch the active tab's data to avoid loading 19K+ history entries
                    await this.fetchSourceStats();
                },

                closeLogsPanel() {
                    this.logsPanelOpen = false;
                },

                async refreshLogs() {
                    await this.fetchSyncStatus();
                    if (this.logsTab === 'stats') await this.fetchSourceStats();
                    else if (this.logsTab === 'history') await this.fetchFetchHistory();
                    else if (this.logsTab === 'errors') await this.fetchFetchErrors();
                },

                async fetchSourceStats() {
                    try {
                        const res = await fetch('/api/fetch-summary');
                        if (res.ok) {
                            this.sourceStatsData = await res.json();
                        }
                    } catch(e) { console.error('Failed to fetch stats'); }
                },

                async fetchFetchHistory() {
                    try {
                        const res = await fetch('/api/fetch-history');
                        if (res.ok) {
                            this.fetchHistoryData = await res.json();
                        }
                    } catch(e) { console.error('Failed to fetch history'); }
                },

                async fetchFetchErrors() {
                    try {
                        const res = await fetch('/api/fetch-errors');
                        if (res.ok) {
                            this.fetchErrorsData = await res.json();
                        }
                    } catch(e) { console.error('Failed to fetch errors'); }
                },

                async toggleSyncPause() {
                    try {
                        const res = await fetch('/api/sync-toggle', { method: 'POST' });
                        if (res.ok) {
                            const data = await res.json();
                            this.syncPaused = data.paused;
                            await this.refreshLogs();
                        }
                    } catch(e) {}
                },

                async fetchSyncStatus() {
                    try {
                        const res = await fetch('/api/sync-status');
                        if (res.ok) {
                            const data = await res.json();
                            this.syncPaused = data.paused;
                        }
                    } catch(e) {}
                },

                prefetchNextAfter(articleOrLink) {
                    const targetUrl = typeof articleOrLink === 'string'
                        ? articleOrLink
                        : (articleOrLink?.originalLink || articleOrLink?.link || articleOrLink?.id);
                    if (!targetUrl || !Array.isArray(this.articles) || !this.articles.length) return;

                    let currentIndex = this.articles.findIndex(a => (a.originalLink || a.link || a.id) === targetUrl || a.link === targetUrl);
                    if (currentIndex === -1 && typeof articleOrLink === 'object' && articleOrLink?.link) {
                        currentIndex = this.articles.findIndex(a => a.link === articleOrLink.link);
                    }
                    if (currentIndex !== -1) {
                        const nextFive = this.articles.slice(currentIndex + 1, currentIndex + 6);
                        if (nextFive.length > 0) {
                            this.prefetchArticlesList(nextFive, false);
                        }
                    }
                },

                prefetchArticlesList(articlesToPrefetch, clearQueue = false) {
                    if (!this.articleContentCache) this.articleContentCache = new Map();
                    if (!Array.isArray(articlesToPrefetch) || !articlesToPrefetch.length) return;

                    if (clearQueue) this.prefetchQueue = [];
                    if (!this.prefetchQueue) this.prefetchQueue = [];

                    for (const art of articlesToPrefetch) {
                        const url = art.originalLink || art.link;
                        if (!url || this.articleContentCache.has(url)) continue;
                        if (!this.prefetchQueue.some(item => (item.originalLink || item.link) === url)) {
                            this.prefetchQueue.push(art);
                        }
                    }
                    if (this.prefetchQueue.length > 0 && !this.isProcessingPrefetch) {
                        this.processPrefetchQueue();
                    }
                },

                async processPrefetchQueue() {
                    if (this.isProcessingPrefetch) return;
                    this.isProcessingPrefetch = true;

                    while (this.prefetchQueue && this.prefetchQueue.length > 0) {
                        if (this.isLoadingOverlay && this.articleOverlayOpen && !this.overlayContent) {
                            await new Promise(r => setTimeout(r, 400));
                            continue;
                        }

                        const art = this.prefetchQueue.shift();
                        if (!art) continue;
                        const url = art.originalLink || art.link;
                        if (!url || (this.articleContentCache && this.articleContentCache.has(url))) continue;

                        try {
                            const params = new URLSearchParams({
                                url,
                                title: art.title || '',
                                feedTitle: art.feedTitle || '',
                                feedUrl: art.feedUrl || '',
                                feedIcon: art.feedIcon || '',
                                prefetch: '1',
                                _t: Date.now().toString()
                            });
                            const res = await fetch('/api/article-content?' + params.toString());
                            if (res.ok) {
                                const data = await res.json();
                                if (!data.error && data.content) {
                                    if (!this.articleContentCache) this.articleContentCache = new Map();
                                    this.articleContentCache.set(url, data);
                                    if (this.articleContentCache.size > 60) {
                                        const firstKey = this.articleContentCache.keys().next().value;
                                        this.articleContentCache.delete(firstKey);
                                    }
                                }
                            }
                        } catch (e) {
                            // Silently ignore background prefetch errors
                        }
                        await new Promise(r => setTimeout(r, 350));
                    }
                    this.isProcessingPrefetch = false;
                },

                async openArticleOverlay(article) {
                    const requestId = 'article-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
                    const targetUrl = article.originalLink || article.link;
                    this.stopArticleSpeech();
                    this.articleOverlayOpen = true;
                    this.isLoadingOverlay = true;
                    this.vozInitialThreadLoad = true;
                    this.overlayContent = null;
                    this.overlayPagination = null;
                    this.overlayError = null;
                    this.overlayFetchStrategy = '';
                    this.overlayFetchedFromCache = false;
                    this.overlayHasNativeAudio = false;
                    this.overlayMethodResults = {};
                    this.overlayAttemptedStrategies = [];
                    this.overlayRejectedStrategies = [];
                    this.overlayMethodPreferences = {};
                    this.overlayTryingMethod = false;
                    this.overlayMethodError = '';
                    this.overlayRequestId = requestId;
                    this.overlayProgress = { message: 'Preparing article reader…' };
                    this.overlayArticle = { ...article };
                    this.lastVozMeasureAt = 0;
                    this.lastTrackedVozPost = '';
                    const articleScroll = document.getElementById('overlay-scroll-container');
                    if (articleScroll) articleScroll.scrollTop = 0;
                    this.markAsReadExplicit(article.link);
                    document.body.style.overflow = 'hidden';

                    const currentIndex = (this.articles || []).findIndex(a => (a.originalLink || a.link || a.id) === targetUrl || a.link === article.link);
                    this.prefetchNextAfter(article);

                    if (this.articleContentCache && this.articleContentCache.has(targetUrl)) {
                        const cachedData = this.articleContentCache.get(targetUrl);
                        cachedData.cached = true; // Frontend cache hit counts as cached
                        if (this.overlayRequestId !== requestId || !this.articleOverlayOpen) return;
                        this.applyOverlayArticleData(cachedData, article);
                        this.isLoadingOverlay = false;
                        return;
                    }

                    if (this.overlayProgressInterval) clearInterval(this.overlayProgressInterval);
                    const updateProgress = async () => {
                        try {
                            const progressResponse = await fetch('/api/article-content-progress?id=' + encodeURIComponent(requestId));
                            if (!progressResponse.ok || this.overlayRequestId !== requestId) return;
                            const progress = await progressResponse.json();
                            this.overlayProgress = progress;
                        } catch (e) { }
                    };
                    this.overlayProgressInterval = setInterval(updateProgress, 400);

                    try {
                        const params = new URLSearchParams({
                            url: article.originalLink || article.link,
                            requestId,
                            title: article.title || '',
                            feedTitle: article.feedTitle || '',
                            feedUrl: article.feedUrl || '',
                            feedIcon: article.feedIcon || ''
                        });
                        const res = await fetch('/api/article-content?' + params.toString());
                        if (this.overlayRequestId !== requestId || !this.articleOverlayOpen) return;
                        if (res.ok) {
                            const data = await res.json();
                            if (this.overlayRequestId !== requestId || !this.articleOverlayOpen) return;
                            if (data.error) {
                                this.overlayError = data.error;
                            } else {
                                this.applyOverlayArticleData(data, article);
                            }
                        } else {
                            this.overlayError = 'Failed to load article content.';
                        }
                    } catch (e) {
                        if (this.overlayRequestId === requestId) this.overlayError = 'Network error: ' + e.message;
                    } finally {
                        if (this.overlayRequestId === requestId) {
                            if (this.overlayProgressInterval) clearInterval(this.overlayProgressInterval);
                            this.overlayProgressInterval = null;
                            this.isLoadingOverlay = false;
                        }
                    }
                },

                closeArticleOverlay() {
                    this.stopArticleSpeech();
                    if (this.vozScrollRaf) cancelAnimationFrame(this.vozScrollRaf);
                    this.vozScrollRaf = 0;
                    this.lastVozMeasureAt = 0;
                    this.lastTrackedVozPost = '';
                    if (this.overlayProgressInterval) clearInterval(this.overlayProgressInterval);
                    this.overlayProgressInterval = null;
                    if (this.vozPollingInterval) clearInterval(this.vozPollingInterval);
                    this.vozPollingInterval = null;
                    this.overlayRequestId = '';
                    this.articleOverlayOpen = false;
                    this.overlayContent = null;
                    this.overlayPagination = null;
                    this.overlayError = null;
                    this.overlayFetchStrategy = '';
                    this.overlayFetchedFromCache = false;
                    this.overlayHasNativeAudio = false;
                    this.overlayMethodResults = {};
                    this.overlayAttemptedStrategies = [];
                    this.overlayRejectedStrategies = [];
                    this.overlayMethodPreferences = {};
                    this.overlayTryingMethod = false;
                    this.overlayMethodError = '';
                    this.overlayProgress = { message: '' };
                    this.overlayArticle = null;
                    this.isLoadingOverlay = false;
                    document.body.style.overflow = '';
                },

                async openDebugModal(url) {
                    this.debugModalOpen = true;
                    this.isDebugging = true;
                    this.debugData = null;
                    try {
                        const res = await fetch(`/api/debug-article?url=${encodeURIComponent(url)}`);
                        if (res.ok) {
                            this.debugData = await res.json();
                        } else {
                            this.debugData = { url, error: 'Server error during debug' };
                        }
                    } catch (e) {
                        this.debugData = { url, error: e.message };
                    } finally {
                        this.isDebugging = false;
                    }
                },

                proxyImageUrl(url) {
                    if (!url) return "";
                    if (url.includes("baodautu.vn") || url.includes("media.baodautu.vn")) {
                        return "/api/proxy-image?url=" + encodeURIComponent(url);
                    }
                    return url;
                },

                formatCount(n) {
                    if (n == null || isNaN(n)) return '0';
                    n = Number(n);
                    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
                    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
                    return String(n);
                },

                timeAgo(dateString) {
                    if (!dateString) return '';
                    const date = new Date(dateString);
                    const seconds = Math.floor((new Date() - date) / 1000);

                    if (seconds < 0) return "Just now";
                    
                    let interval = seconds / 31536000;
                    if (interval > 1) return Math.floor(interval) + "y";
                    interval = seconds / 2592000;
                    if (interval > 1) return Math.floor(interval) + "mo";
                    interval = seconds / 86400;
                    if (interval > 1) return Math.floor(interval) + "d";
                    interval = seconds / 3600;
                    if (interval > 1) return Math.floor(interval) + "h";
                    interval = seconds / 60;
                    if (interval > 1) return Math.floor(interval) + "m";
                    return Math.floor(seconds) + "s";
                },

                formatVietnamDateTime(dateString) {
                    if (!dateString) return 'Time unavailable';
                    const date = new Date(dateString);
                    if (Number.isNaN(date.getTime())) return 'Time unavailable';
                    return new Intl.DateTimeFormat('en-GB', {
                        timeZone: 'Asia/Ho_Chi_Minh',
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    }).format(date);
                }
            }
        }
        document.addEventListener('input', e => {
            if (e.target.matches('.compare-slider')) {
                const container = e.target.closest('.tinhte-photo-compare');
                if (container) {
                    const overlay = container.querySelector('.compare-overlay');
                    const handle = container.querySelector('.compare-handle');
                    if (overlay) overlay.style.clipPath = `inset(0 ${100 - e.target.value}% 0 0)`;
                    if (handle) handle.style.left = `${e.target.value}%`;
                }
            }
        });
