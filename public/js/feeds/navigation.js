// Owns feeds / navigation on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderFeedsNavigation = {
    create() {
        return {
                searchQuery: '',
                
                selectedFilterType: 'smart',
                selectedFilterValue: 'news_vietnam',
                expandedCategories: [],
                
                hideRead: localStorage.getItem('hideRead') === 'true',
                
                draggedUrl: null,
                dragTargetUrl: null,
                categoryOrder: [],
                draggedCategory: null,
                dragTargetCategory: null,

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
                            news_global: 'Smart News · Global',
                            finance_vietnam: 'Smart Finance · Vietnam',
                            finance_global: 'Smart Finance · Global',
                            tech_vietnam: 'Smart Technology · Vietnam',
                            tech_global: 'Smart Technology · Global',
                            tech: this.smartRegion === 'vietnam'
                                ? 'Smart Technology · Vietnam'
                                : 'Smart Technology · Global'
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

                toggleCategory(name) {
                    if (this.expandedCategories.includes(name)) {
                        this.expandedCategories = this.expandedCategories.filter(c => c !== name);
                    } else {
                        this.expandedCategories.push(name);
                    }
                },

                toggleHideRead() {
                    this.hideRead = !this.hideRead;
                    localStorage.setItem('hideRead', String(this.hideRead));
                    this.syncUserPreferenceDebounced('hideRead', this.hideRead);
                    this.fetchData();
                },

                setFilter(type, value, preserveVersion = false) {
                    if (type === 'smart') {
                        value = this.normalizeSmartDestination(value);
                        this.smartRegion = value.endsWith('_vietnam') ? 'vietnam' : 'global';
                    }
                    this.hideTooltip();
                    if (type !== 'smart' || !preserveVersion || this.selectedFilterType !== 'smart') {
                        this.smartClusterVersion = '';
                    }
                    this._preserveSmartVersionCall = preserveVersion && this.selectedFilterType === 'smart';
                    this.topStories = [];
                    this.storyAnalysisOpen = {};
                    this.smartViewToken = '';
                    this.topStoryError = '';
                    if (this.briefingRefreshTimer) clearTimeout(this.briefingRefreshTimer);
                    const wasSmart =
                        this.selectedFilterType === 'smart';
                    const previousSmartMode = this.smartTabMode;

                    this.selectedFilterType = type;
                    this.selectedFilterValue = value;
                    this.syncUserPreferenceDebounced('currentView', { type, value: value ?? null });

                    if (type === 'smart') {
                        const storedMode =
                            this.userPreferences.smartTabModes?.__all ||
                            this.userPreferences.smartTabModes?.[value];

                        this.smartTabMode =
                            wasSmart &&
                            ['top', 'classic'].includes(previousSmartMode)
                                ? previousSmartMode
                                : (
                                    ['top', 'classic'].includes(storedMode)
                                        ? storedMode
                                        : 'top'
                                );
                    }
                    window.location.hash = `${type}${value ? '/' + encodeURIComponent(value) : ''}`;
                    this.currentPage = 1;
                    this.hasMore = false;
                    this.articles = [];
                    this.mobileSidebarOpen = false;
                    const sc = document.getElementById('scroll-container');
                    if (sc) sc.scrollTo(0, 0);
                    this.fetchData();
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
        };
    }
};
