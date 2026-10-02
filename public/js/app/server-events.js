// Owns app / server-events on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderAppServerEvents = {
    create() {
        return {

                // APP_EVENT_STREAM_CLIENT_V1
                serverEvents: null,
                serverEventsConnected: false,
                serverEventsFallbackTimer: null,
                serverEventUserStateTimer: null,

                startServerEvents() {
                    if (
                        !this.isLoggedIn ||
                        this.serverEvents ||
                        typeof EventSource ===
                            'undefined'
                    ) {
                        return;
                    }

                    const source =
                        new EventSource(
                            '/api/events'
                        );

                    this.serverEvents =
                        source;

                    const connected =
                        () => {
                            this.serverEventsConnected =
                                true;
                        };

                    source.onopen =
                        connected;

                    source.addEventListener(
                        'ready',
                        connected
                    );

                    source.addEventListener(
                        'user-state-changed',
                        event => {
                            /*
                             * SSE_STATE_DELTA_V1
                             *
                             * Apply the small server delta directly.
                             * Do NOT call syncUserStatesInBackground()
                             * here: that routine flushes pending writes,
                             * which can publish another SSE event and
                             * create a write -> event -> sync loop.
                             *
                             * A hidden tab intentionally defers updates;
                             * the existing visibilitychange reconciliation
                             * performs a full state refresh on return.
                             */
                            if (
                                document.hidden
                            ) {
                                return;
                            }

                            let data;

                            try {
                                data =
                                    JSON.parse(
                                        event.data ||
                                            '{}'
                                    );
                            } catch {
                                return;
                            }

                            if (
                                data.kind ===
                                    'preference' &&
                                data.key
                            ) {
                                if (
                                    !Object.prototype.hasOwnProperty.call(
                                        this.pendingPreferences,
                                        data.key
                                    )
                                ) {
                                    this.userPreferences = {
                                        ...this.userPreferences,
                                        [data.key]:
                                            data.value
                                    };

                                    if (data.key === 'clusteringModel') this.clusteringModel = data.value;
                                    if (data.key === 'theme' && ['classic', 'glass', 'glass-light'].includes(data.value)) {
                                        this.theme = data.value;
                                        localStorage.setItem('theme', data.value);
                                    }
                                    if (data.key === 'hideRead' && typeof data.value === 'boolean') {
                                        this.hideRead = data.value;
                                        if (this.selectedFilterType !== 'recent') this.fetchData(false, false, true);
                                    }
                                }

                                return;
                            }

                            if (data.kind === 'recent-read' && data.link) {
                                this.recentReadAt = { ...this.recentReadAt, [data.link]: Number(data.at) || Date.now() };
                                // A different device may have reopened an article that is
                                // not present in this device's current seven-day list. Pull
                                // the RAM-filtered recent view so membership as well as order
                                // becomes universal immediately.
                                if (this.selectedFilterType === 'recent') this.fetchData(false, false, true);
                                return;
                            }

                            if (
                                ![
                                    'toggle',
                                    'toggle-batch'
                                ].includes(
                                    data.kind
                                ) ||
                                !Array.isArray(
                                    data.changes
                                )
                            ) {
                                return;
                            }

                            const changes =
                                data.changes.filter(
                                    change =>
                                        change &&
                                        typeof change.link ===
                                            'string'
                                );

                            if (
                                !changes.length
                            ) {
                                return;
                            }

                            if (
                                data.list ===
                                    'readStates'
                            ) {
                                const next =
                                    new Set(
                                        this.readStates
                                    );

                                for (
                                    const change
                                    of changes
                                ) {
                                    if (
                                        change.present
                                    ) {
                                        next.add(
                                            change.link
                                        );
                                    } else {
                                        next.delete(
                                            change.link
                                        );
                                    }
                                }

                                for (const link of this.pendingReadLinks) next.add(link);
                                for (const link of this.pendingUnreadLinks) next.delete(link);
                                this.readStates = next;

                                return;
                            }

                            const applyArrayDelta =
                                current => {
                                    let next =
                                        Array.isArray(
                                            current
                                        )
                                            ? [
                                                  ...current
                                              ]
                                            : [];

                                    for (
                                        const change
                                        of changes
                                    ) {
                                        next =
                                            next.filter(
                                                link =>
                                                    link !==
                                                    change.link
                                            );

                                        if (
                                            change.present
                                        ) {
                                            next.push(
                                                change.link
                                            );
                                        }
                                    }

                                    next = this.applyPendingStateMutations(data.list, next);
                                    return this.dedupeStateLinks(
                                        next
                                    );
                                };

                            if (
                                data.list ===
                                    'savedStates'
                            ) {
                                this.savedStates =
                                    applyArrayDelta(
                                        this.savedStates
                                    );
                            } else if (
                                data.list ===
                                    'boardStates'
                            ) {
                                this.boardStates =
                                    applyArrayDelta(
                                        this.boardStates
                                    );
                            } else if (
                                data.list ===
                                    'hiddenStates'
                            ) {
                                this.hiddenStates =
                                    applyArrayDelta(
                                        this.hiddenStates
                                    );
                            }
                        }
                    );

                    /*
                     * SMART_BRIEFING_SSE_V1
                     *
                     * Apply completed briefings directly so bursts across
                     * multiple pages cannot cancel one another's refreshes.
                     * Legacy events and material revisions still reconcile
                     * through /api/data; viewport heartbeats recover missed events.
                     */
                    source.addEventListener('content-filter-changed', event => {
                        if (document.hidden) return;
                        try {
                            const data = JSON.parse(event.data || '{}');
                            this.blockedKeywords = this.normalizeKeywordList(data.keywords || []);
                            if (!this.contentFilterSettingsOpen) this.blockedKeywordsDraft = [...this.blockedKeywords];
                            if (!this.savingContentFilter) this.fetchData(false, false, true);
                        } catch {}
                    });

                    source.addEventListener('board-cache-changed', () => {
                        if (document.hidden) return;
                        this.loadCacheState();
                        this.syncUserStatesInBackground();
                        if (this.selectedFilterType === 'board') this.fetchData(false, false, true);
                    });

                    if (!this.briefingViewportListener) {
                        this.briefingViewportListener = event => {
                            if (event.detail.smartViewToken === this.smartViewToken) this.applyBriefingUpdates(event.detail.updates);
                        };
                        window.addEventListener('briefing-viewport-updated', this.briefingViewportListener);
                    }

                    source.addEventListener(
                        'smart-briefing-changed',
                        event => {
                            if (
                                document.hidden ||
                                !this.usesTopStories
                            ) {
                                return;
                            }

                            let data = {};

                            try {
                                data =
                                    JSON.parse(
                                        event.data ||
                                        '{}'
                                    );
                            } catch {
                                data = {};
                            }

                            if (data.briefing && this.applyBriefingUpdates([data])) return;

                            let targetAttempt = 0;

                            if (
                                data.clusterId
                            ) {
                                const index =
                                    this.articles.findIndex(
                                        article =>
                                            (
                                                article.clusterId ||
                                                article.link
                                            ) ===
                                            data.clusterId
                                    );

                                /*
                                 * Ignore look-ahead/background briefing jobs
                                 * that are not currently rendered.
                                 */
                                if (index < 0) {
                                    return;
                                }

                                const pageSize =
                                    this.isMobile
                                        ? 15
                                        : 40;

                                const targetPage =
                                    Math.floor(
                                        index /
                                        pageSize
                                    ) + 1;

                                targetAttempt =
                                    Math.max(
                                        0,
                                        targetPage - 1
                                    );
                            }

                            this.scheduleBriefingRefresh(
                                targetAttempt,
                                500
                            );
                        }
                    );

                    source.onerror =
                        () => {
                            this.serverEventsConnected =
                                false;

                            /*
                             * EventSource reconnects automatically.
                             */
                        };
                },

                stopServerEvents() {
                    clearTimeout(
                        this.serverEventUserStateTimer
                    );

                    this.serverEventUserStateTimer =
                        null;

                    if (
                        this.serverEvents
                    ) {
                        this.serverEvents.close();
                    }

                    this.serverEvents =
                        null;

                    this.serverEventsConnected =
                        false;
                },
        };
    }
};
