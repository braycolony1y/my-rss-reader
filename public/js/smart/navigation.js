// Owns Stories (internal id: smart) section and region navigation on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderSmartNavigation = {
    create() {
        return {
                smartRegion: 'global',
                normalizeSmartDestination(value) {
                    const category = String(value || '').replace(/_(world|foreign)$/, '_global');
                    return ['news', 'finance', 'tech'].includes(category)
                        ? `${category}_${this.smartRegion === 'vietnam' ? 'vietnam' : 'global'}`
                        : category;
                },
                async setSmartRegion(region) {
                    const normalized = region === 'vietnam' ? 'vietnam' : 'global';
                    const destination = `${this.smartSection}_${normalized}`;
                    if (this.selectedFilterType === 'smart' && this.selectedFilterValue === destination) return;
                    this.smartRegion = normalized;
                    this.setFilter('smart', destination);
                },

                // Backward-compatible alias for any older callers.
                async setTopRegion(region) {
                    await this.setSmartRegion(region);
                },

                get smartSection() {
                    if (this.selectedFilterValue && (this.selectedFilterValue === 'finance' || this.selectedFilterValue.startsWith('finance_'))) return 'finance';
                    if (this.selectedFilterValue && (this.selectedFilterValue === 'tech' || this.selectedFilterValue.startsWith('tech'))) return 'tech';
                    return 'news';
                },

                setSmartSection(section) {
        // SMART_REGION_GLOBAL_ONLY_V3
        //
        // The left News / Finance / Tech selector must preserve the
        // currently selected Vietnam / Global region.
        //
        // Smart region has exactly two canonical values:
        //   vietnam | global

        let region =
            this.smartRegion === 'vietnam'
                ? 'vietnam'
                : 'global';

        // News and Finance also encode the current region in their
        // filter ID. Use that visible state as authoritative before
        // changing section.
        if (
            this.selectedFilterValue === 'news_vietnam' ||
            this.selectedFilterValue === 'finance_vietnam'
        ) {
            region = 'vietnam';
        } else if (
            this.selectedFilterValue === 'news_global' ||
            this.selectedFilterValue === 'finance_global'
        ) {
            region = 'global';
        }

        this.smartRegion = region;

        const target = {
            news:
                region === 'vietnam'
                    ? 'news_vietnam'
                    : 'news_global',

            finance:
                region === 'vietnam'
                    ? 'finance_vietnam'
                    : 'finance_global',

            tech: `tech_${region}`
        };

        this.setFilter(
            'smart',
            target[section] || target.news,
            true
        );
                },
        };
    }
};
