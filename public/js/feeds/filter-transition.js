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
                    if (!sameDestination) this.topStories = [];
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
                    if (!sameDestination) this.articles = [];
                    this.mobileSidebarOpen = false;
                    const sc = document.getElementById('scroll-container');
                    if (sc) sc.scrollTo(0, 0);
                    this.fetchData();
                },

};
