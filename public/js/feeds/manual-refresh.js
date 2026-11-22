// Owns the manual refresh request and its progress lifecycle.
const ReaderManualRefresh = {
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
                if (this.syncProgress.requestId !== requestId || this.syncProgress.done) return;
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
            const result = await response.json();
            const failed = result.success === false || result.ok === false || result.smart?.ok === false;
            await this.fetchData(); 
            this.syncProgress = { ...this.syncProgress,
                message: result.message || (failed ? 'Some sources could not refresh. Please try again.' : 'Refresh complete.'),
                done: true, failed, visible: true };
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
