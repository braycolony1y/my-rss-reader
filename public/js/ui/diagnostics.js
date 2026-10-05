// Owns ui / diagnostics on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderUiDiagnostics = {
    create() {
        return {
                
                debugModalOpen: false,

                // LOGS PANEL STATE
                logsPanelOpen: false,
                logsTab: 'stats',
                sourceStatsData: [],
                fetchHistoryData: [],
                fetchErrorsData: [],
                syncPaused: false,
                logsRefreshInterval: null,

                // DEBUG MODAL STATE
                debugModalOpen: false,
                isDebugging: false,
                debugData: null,
                debugModalArticle: null,

                formatLogTime(ts) {
                    const d = new Date(ts);
                    return d.toLocaleString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false });
                },

                async openLogsPanel() {
                    this.logsPanelOpen = true;
                    this.mobileSidebarOpen = false;
                    this.logsTab = 'stats';
                    this.$nextTick?.(() => document.querySelector('.monitor-tabs button')?.focus());
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
                    else if (this.logsTab === 'filtered') await this.fetchFilterLog();
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

                async openDebugModal(articleOrUrl) {
                    const url = this.articleReaderUrl(articleOrUrl);
                    this.debugModalArticle = typeof articleOrUrl === 'object' ? articleOrUrl : this.articles.find(a => (a.originalLink || a.link) === url);
                    
                    this.debugModalOpen = true;
                    this.isDebugging = true;
                    this.debugData = null;
                    
                    try {
                        const res = await fetch(`/api/debug-article?url=${encodeURIComponent(url)}`);
                        if (res.ok) {
                            this.debugData = await res.json();
                            this.debugData.prefetchQueue = this.currentPrefetchQueue || [];
                        } else {
                            this.debugData = { url, error: 'Server error during debug' };
                        }
                    } catch (e) {
                        this.debugData = { url, error: e.message };
                    } finally {
                        this.isDebugging = false;
                    }
                },
        };
    }
};
