// Owns smart / navigation on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderSmartNavigation = {
    create() {
        return {
                smartTabMode: 'top',
                smartModeWriteQueue: Promise.resolve(),
                smartModeWriteVersion: 0,
                smartModeRetryTimer: null,
                async setSmartTabMode(mode) {
                    if (!['top','classic'].includes(mode) || mode === this.smartTabMode) return;
                    const tab = this.selectedFilterValue;
                    const writeVersion = ++this.smartModeWriteVersion;
                    if (this.smartModeRetryTimer) {
                        clearTimeout(this.smartModeRetryTimer);
                        this.smartModeRetryTimer = null;
                    }
                    this.hideTooltip();
                    this.smartTabMode = mode;

                    // Top / Classic is one Smart-wide view preference.
                    // Keep the destination keys synchronized for backward
                    // compatibility with older stored preferences/server code.
                    const synchronizedModes = {
                        ...(this.userPreferences.smartTabModes || {}),
                        __all: mode
                    };
                    for (const key of [
                        'news_vietnam',
                        'news_global',
                        'finance_vietnam',
                        'finance_global',
                        'tech', 'tech_vietnam', 'tech_global'
                    ]) {
                        synchronizedModes[key] = mode;
                    }

                    this.userPreferences.smartTabModes = synchronizedModes;
                    this.pendingPreferences.smartTabModes = {
                        ...synchronizedModes
                    };
                    this.topStoryError = '';
                    // Paint first. Persistence and briefing requests must not gate the toggle.
                    this.smartViewToken = '';
                    this.fetchData();
                    const modes = { ...this.userPreferences.smartTabModes };
                    this.smartModeWriteQueue = this.smartModeWriteQueue.catch(() => {}).then(async () => {
                        const response = await fetch('/api/user-preferences', {
                            method: 'POST',
                            keepalive: true,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                key: 'smartTabModes',
                                value: modes
                            })
                        });
                        if (!response.ok) throw new Error('Could not save this view. Please retry.');
                    });
                    try {
                        await this.smartModeWriteQueue;
                        if (writeVersion === this.smartModeWriteVersion) delete this.pendingPreferences.smartTabModes;
                    }
                    catch (error) {
                        if (writeVersion !== this.smartModeWriteVersion) return;

                        // The selected Smart view is already valid and rendered.
                        // Persistence failure is not a Top Stories content failure,
                        // so keep the user's choice and retry quietly.
                        console.warn(
                            '[SMART VIEW] Preference save failed; keeping selected view.',
                            error
                        );

                        clearTimeout(this.smartModeRetryTimer);

                        this.smartModeRetryTimer = setTimeout(() => {
                            this.smartModeRetryTimer = null;

                            const pending =
                                this.pendingPreferences.smartTabModes;

                            if (!pending) return;

                            const retryModes = { ...pending };

                            this.smartModeWriteQueue =
                                this.smartModeWriteQueue
                                    .catch(() => {})
                                    .then(async () => {
                                        const response = await fetch(
                                            '/api/user-preferences',
                                            {
                                                method: 'POST',
                                                keepalive: true,
                                                headers: {
                                                    'Content-Type':
                                                        'application/json'
                                                },
                                                body: JSON.stringify({
                                                    key: 'smartTabModes',
                                                    value: retryModes
                                                })
                                            }
                                        );

                                        if (!response.ok) {
                                            throw new Error(
                                                `Smart view preference save failed (${response.status})`
                                            );
                                        }
                                    });

                            void this.smartModeWriteQueue
                                .then(() => {
                                    const latest =
                                        this.pendingPreferences.smartTabModes;

                                    if (
                                        latest &&
                                        JSON.stringify(latest) ===
                                            JSON.stringify(retryModes)
                                    ) {
                                        delete this.pendingPreferences.smartTabModes;
                                    }
                                })
                                .catch(retryError => {
                                    console.warn(
                                        '[SMART VIEW] Preference retry deferred.',
                                        retryError
                                    );
                                });
                        }, 5000);
                    }
                },
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
