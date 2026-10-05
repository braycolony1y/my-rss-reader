const ReaderFilterLog = {
    create() {
        return {
            filterLogRows: [], filterRules: [], filterLogOrigin: 'all', filterLogSearch: '', filterLogTotal: 0,
            filterLogBusy: false, filterLogError: '', filterLogRequest: 0,
            async fetchFilterLog(append = false) {
                const request = ++this.filterLogRequest;
                this.filterLogBusy = true; this.filterLogError = '';
                try {
                    const query = new URLSearchParams({ origin: this.filterLogOrigin, search: this.filterLogSearch, offset: append ? this.filterLogRows.length : 0 });
                    const response = await fetch('/api/smart-feedback/log?' + query);
                    if (!response.ok) throw new Error('Could not load filter decisions.');
                    const data = await response.json();
                    if (request !== this.filterLogRequest) return;
                    this.filterLogRows = append ? [...this.filterLogRows, ...data.rows] : data.rows;
                    this.filterRules = data.rules; this.filterLogTotal = data.total;
                } catch (error) { if (request === this.filterLogRequest) this.filterLogError = error.message; }
                finally { if (request === this.filterLogRequest) this.filterLogBusy = false; }
            },
            async disableSmartRule(id, remove = false) {
                try {
                    await this.feedbackRequest('rules/' + encodeURIComponent(id), { remove }, 'PATCH');
                    this.feedbackHidden = [];
                    await this.fetchFilterLog();
                } catch (error) { this.filterLogError = error.message; }
            },
            filterRuleLabel(id) { return this.filterRules.find(rule => rule.id === id)?.label || id; },
        };
    }
};
