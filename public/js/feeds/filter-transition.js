// Owns section transitions while keeping same-view refreshes readable.
const ReaderFilterTransition = {
    set(app, type, value, preserveVersion = false) {
        return this.transition.call(app, type, value, preserveVersion);
    },
    transition(type, value, preserveVersion = false) {
                    if (type === 'smart') {
                        value = this.normalizeSmartDestination(value);
                        this.smartRegion = value.endsWith('_vietnam') ? 'vietnam' : 'global';
                    }
                    const sameDestination = type === this.selectedFilterType
                        && (value || null) === (this.selectedFilterValue || null);
                    this.hideTooltip();
                    if (type !== 'smart' || !preserveVersion || this.selectedFilterType !== 'smart') {
                        this.smartClusterVersion = '';
                    }
                    this._preserveSmartVersionCall = preserveVersion && this.selectedFilterType === 'smart';
                    this.smartViewToken = '';
                    this.selectedFilterType = type;
                    this.selectedFilterValue = value;
                    this.syncUserPreferenceDebounced('currentView', { type, value: value ?? null });
                    window.location.hash = `${type}${value ? '/' + encodeURIComponent(value) : ''}`;
                    this.currentPage = 1;
                    this.hasMore = false;
                    if (!sameDestination) { this.articles = []; ReaderListPublication.restore(this); }
                    this.mobileSidebarOpen = false;
                    const sc = document.getElementById('scroll-container');
                    if (sc) sc.scrollTo(0, 0);
                    this.fetchData();
                },

};
