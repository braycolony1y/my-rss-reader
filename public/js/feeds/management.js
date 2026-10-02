// Owns feeds / management on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderFeedsManagement = {
    create() {
        return {
                showAddFeedModal: false,
                newFeedUrl: '',
                newFeedCategory: '',
                newFeedExcludeFromSmart: false,
                selectedDropdownCategory: '', 
                isSyncing: false,
                isAdding: false,
                syncProgress: { visible: false, message: '', done: false, failed: false, current: 0, total: 0, requestId: '' },
                syncProgressInterval: null,
                editModalOpen: false,
                editingFeed: null,
                editFeedTitle: '',
                editFeedCategoryDropdown: '',
                editFeedCategoryNew: '',
                editFeedFetchMethods: [],
                editFeedExcludeFromSmart: false,
                isSavingEdit: false,
                
                openEditModal(feed) {
                    this.editingFeed = feed;
                    this.editFeedTitle = feed.title;
                    this.editFeedCategoryDropdown = feed.category;
                    this.editFeedCategoryNew = '';
                    this.editFeedFetchMethods = feed.fetchMethods || [];
                    this.editFeedExcludeFromSmart = feed.excludeFromSmart || false;
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
                            body: JSON.stringify({ 
                                url: this.editingFeed.url, 
                                title: this.editFeedTitle, 
                                category: newCat,
                                fetchMethods: this.editFeedFetchMethods,
                                excludeFromSmart: this.editFeedExcludeFromSmart
                            })
                        });
                        const data = await response.json().catch(() => null);
                        if(response.ok) {
                            if (Array.isArray(data?.feeds)) this.feeds = data.feeds;
                            if (Array.isArray(data?.sources)) this.smartSources = data.sources;
                            // A changed source policy must take effect on the
                            // very next open, not after an old browser-memory
                            // article result has been reused.
                            if (this.articleContentCache) this.articleContentCache.clear();
                            await this.fetchData();
                            this.editModalOpen = false;
                        } else {
                            throw new Error(data?.error || 'Failed to edit feed.');
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
                            body: JSON.stringify({ url: urlToSubmit, category: catToSubmit, excludeFromSmart: this.newFeedExcludeFromSmart })
                        });
                        if (!response.ok) {
                            const errText = await response.text();
                            throw new Error(errText);
                        }
                        
                        this.newFeedUrl = '';
                        this.newFeedCategory = '';
                        this.selectedDropdownCategory = '';
                        this.newFeedExcludeFromSmart = false;
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
                    this.preliminaryLoaded = false;
                    const updateProgress = async () => {
                        try {
                            const response = await fetch('/api/sync-progress?id=' + encodeURIComponent(requestId));
                            if (!response.ok) return;
                            const progress = await response.json();
                            if (this.syncProgress.requestId !== requestId) return;
                            this.syncProgress = { ...this.syncProgress, ...progress, visible: true, requestId };
                            
                            if (progress.stage === 'smart-minilm-ready' && !this.preliminaryLoaded) {
                                this.preliminaryLoaded = true;
                                if (this.selectedFilterType === 'smart') {
                                    this.loadSmartClusters(true);
                                }
                            }
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
        };
    }
};
