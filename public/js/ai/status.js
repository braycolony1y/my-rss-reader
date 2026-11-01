// Owns ai / status on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderAiStatus = (() => {
    const privateState = new WeakMap();
    function getPrivate(instance) {
        let state = privateState.get(instance);
        if (!state) {
            state = {
                filterCache: null,
                lastSmartRunSig: '',
                lastDebugStatsRaw: '',
                lastUsageSig: '',
                fetchingUsage: false
            };
            privateState.set(instance, state);
        }
        return state;
    }

    function syncScalarObject(target, source) {
        for (const key of Object.keys(target)) {
            if (!Object.prototype.hasOwnProperty.call(source, key)) {
                delete target[key];
            }
        }
        for (const [key, value] of Object.entries(source)) {
            if (target[key] !== value) {
                target[key] = value;
            }
        }
    }

    function computeUsageSignature(data) {
        const events = Array.isArray(data?.events) ? data.events : [];
        return JSON.stringify({
            summary: data?.summary || null,
            totalEvents: data?.totalEvents || 0,
            rangeStart: data?.rangeStart || 0,
            rangeEnd: data?.rangeEnd || 0,
            hasNewer: Boolean(data?.hasNewer),
            hasOlder: Boolean(data?.hasOlder),
            count: events.length,
            firstId: events[0]?.id || '',
            lastId: events.length ? (events[events.length - 1]?.id || '') : ''
        });
    }

    return {
    create() {
        return {
                geminiStatusOpen: false,
                geminiStatusLoading: false,
                geminiStatusError: '',
                geminiKeyStatus: null,
                clusteringModel: 'gemini-3.5-flash-lite',
                geminiDebugStats: null,
                geminiDebugTimer: null,
                smartAiStatusTimer: null,
                onlineAiUsage: null,
                onlineAiUsageLoading: false,
                onlineAiUsageError: '',
                onlineAiUsageTimer: null,
                onlineAiUsageLimit: 500,
                onlineAiUsageOffset: 0,
                onlineAiUsageStatus: 'all',
                onlineAiUsageProvider: 'all',
                onlineAiUsageOperation: 'all',
                onlineAiUsageModel: 'all',
                onlineAiUsageSearch: '',
                onlineAiUsageCopiedKey: '',
                onlineAiUsageCopyTimer: null,
                onlineAiUsageNow: Date.now(),
                newGeminiKey: '',
                newGeminiKeyVisible: false,
                addingGeminiKey: false,
                addGeminiKeyError: '',
                addGeminiKeyMessage: '',

                syncGeminiStatusScrollLock(open = this.geminiStatusOpen) {
                    if (typeof document === 'undefined') return;
                    const locked = Boolean(open);
                    document.documentElement?.classList?.toggle('ai-status-scroll-lock', locked);
                    if (document.body?.style) {
                        if (locked) {
                            document.body.style.overflow = 'hidden';
                        } else if (!this.articleOverlayOpen) {
                            document.body.style.overflow = '';
                        }
                    }
                },

                openGeminiStatus() {
                    this.geminiStatusOpen = true;
                    this.mobileSidebarOpen = false;
                    this.syncGeminiStatusScrollLock(true);
                    this.fetchGeminiKeyStatus();
                    this.fetchSmartAiProgress();
                    this.fetchOnlineAiUsage();
                    if (!this.smartAiStatusTimer) {
                        this.smartAiStatusTimer = setInterval(() => this.fetchSmartAiProgress(), 2000);
                    }
                    if (!this.geminiDebugTimer) {
                        this.fetchGeminiDebugStats();
                        this.geminiDebugTimer = setInterval(() => this.fetchGeminiDebugStats(), 5000);
                    }
                    if (!this.onlineAiUsageTimer) {
                        this.onlineAiUsageTimer = setInterval(() => {
                            if (this.onlineAiUsageOffset === 0) this.fetchOnlineAiUsage(true);
                        }, 60000);
                    }
                },

                closeGeminiStatus() {
                    this.geminiStatusOpen = false;
                    this.syncGeminiStatusScrollLock(false);
                    if (this.geminiDebugTimer) {
                        clearInterval(this.geminiDebugTimer);
                        this.geminiDebugTimer = null;
                    }
                    if (this.smartAiStatusTimer) {
                        clearInterval(this.smartAiStatusTimer);
                        this.smartAiStatusTimer = null;
                    }
                    if (this.onlineAiUsageTimer) {
                        clearInterval(this.onlineAiUsageTimer);
                        this.onlineAiUsageTimer = null;
                    }
                },

                async fetchOnlineAiUsage(silent = false) {
                    const priv = getPrivate(this);
                    if (priv.fetchingUsage || this.onlineAiUsageLoading) return;
                    priv.fetchingUsage = true;
                    const showLoading = !silent || !this.onlineAiUsage;
                    if (showLoading) this.onlineAiUsageLoading = true;
                    if (!silent) this.onlineAiUsageError = '';
                    try {
                        const response = await fetch(`/api/online-ai-usage?limit=${encodeURIComponent(this.onlineAiUsageLimit)}&offset=${encodeURIComponent(this.onlineAiUsageOffset)}`, {
                            cache: 'no-store'
                        });
                        const data = await response.json().catch(() => ({}));
                        if (!response.ok) throw new Error(data.detail || data.error || 'Could not load online AI activity');
                        const nextSig = computeUsageSignature(data);
                        if (silent && this.onlineAiUsage && priv.lastUsageSig === nextSig) {
                            if (data.generatedAt && this.onlineAiUsage.generatedAt !== data.generatedAt) {
                                this.onlineAiUsage.generatedAt = data.generatedAt;
                            }
                        } else {
                            priv.lastUsageSig = nextSig;
                            this.onlineAiUsage = data;
                        }
                        const nextWarning = data.warning || '';
                        if (this.onlineAiUsageError !== nextWarning) {
                            this.onlineAiUsageError = nextWarning;
                        }
                    } catch (error) {
                        this.onlineAiUsageError = error.message || 'Could not load online AI activity';
                    } finally {
                        priv.fetchingUsage = false;
                        if (showLoading) this.onlineAiUsageLoading = false;
                    }
                },

                async changeOnlineAiUsagePage(direction) {
                    const pageSize = Number(this.onlineAiUsageLimit) || 500;
                    if (direction === 'older' && this.onlineAiUsage?.hasOlder) {
                        this.onlineAiUsageOffset += pageSize;
                    } else if (direction === 'newer' && this.onlineAiUsage?.hasNewer) {
                        this.onlineAiUsageOffset = Math.max(0, this.onlineAiUsageOffset - pageSize);
                    } else {
                        return;
                    }
                    await this.fetchOnlineAiUsage();
                },

                filteredOnlineAiUsageEvents() {
                    const usage = this.onlineAiUsage;
                    const events = Array.isArray(usage?.events) ? usage.events : [];
                    const statusFilter = this.onlineAiUsageStatus;
                    const providerFilter = this.onlineAiUsageProvider;
                    const operationFilter = this.onlineAiUsageOperation;
                    const modelFilter = this.onlineAiUsageModel;
                    const query = String(this.onlineAiUsageSearch || '').trim().toLowerCase();

                    const priv = getPrivate(this);
                    const cached = priv.filterCache;
                    if (
                        cached &&
                        cached.events === events &&
                        cached.statusFilter === statusFilter &&
                        cached.providerFilter === providerFilter &&
                        cached.operationFilter === operationFilter &&
                        cached.modelFilter === modelFilter &&
                        cached.query === query
                    ) {
                        return cached.result;
                    }

                    const result = events.filter(event => {
                        // Gemini API cooldown state is already shown in the
                        // dedicated Gemini Keys panel. Do not duplicate it
                        // here as activity-feed noise.
                        const activityDetail = String(
                            event.error ||
                            event.message ||
                            ''
                        );

                        const isGeminiApiCooldownActivity =
                            String(event.provider || '').toLowerCase() === 'gemini' &&
                            (
                                event.status === 'cooldown' ||
                                event.errorCode === 'COOLDOWN' ||
                                /Gemini API cooldown active until/i.test(activityDetail) ||
                                /all configured keys may be cooling down/i.test(activityDetail)
                            );

                        if (isGeminiApiCooldownActivity) return false;

                        if (statusFilter !== 'all' && event.status !== statusFilter) return false;
                        if (providerFilter !== 'all' && event.provider !== providerFilter) return false;
                        if (operationFilter !== 'all' && event.operation !== operationFilter) return false;
                        if (modelFilter !== 'all' && event.model !== modelFilter) return false;
                        if (!query) return true;
                        return [
                            event.provider,
                            event.providerId,
                            event.operation,
                            event.model,
                            event.status,
                            event.httpStatus,
                            event.errorCode,
                            event.error,
                            event.message,
                            event.groupId,
                            event.keyIndex,
                            event.parserReason,
                            event.repairReason
                        ].filter(value => value !== null && value !== undefined).join(' ').toLowerCase().includes(query);
                    });

                    priv.filterCache = {
                        events,
                        statusFilter,
                        providerFilter,
                        operationFilter,
                        modelFilter,
                        query,
                        result
                    };
                    return result;
                },

                formatAiUsageDuration(value) {
                    const milliseconds = Number(value);
                    if (!Number.isFinite(milliseconds)) return 'not recorded';
                    if (milliseconds < 1000) return `${milliseconds} ms`;
                    if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(milliseconds < 10000 ? 2 : 1)} s`;
                    return `${(milliseconds / 60000).toFixed(1)} min`;
                },

                formatAiUsageNumber(value) {
                    return new Intl.NumberFormat().format(Number(value) || 0);
                },

                async copyOnlineAiDiagnostic(value, key = 'raw') {
                    const text = String(value || '');
                    if (!text) return;
                    try {
                        await navigator.clipboard.writeText(text);
                        this.onlineAiUsageCopiedKey = String(key || 'raw');
                        if (this.onlineAiUsageCopyTimer) clearTimeout(this.onlineAiUsageCopyTimer);
                        this.onlineAiUsageCopyTimer = setTimeout(() => {
                            if (this.onlineAiUsageCopiedKey === String(key || 'raw')) this.onlineAiUsageCopiedKey = '';
                            this.onlineAiUsageCopyTimer = null;
                        }, 1600);
                    } catch (error) {
                        this.onlineAiUsageError = 'Could not copy the provider response.';
                    }
                },

                async saveClusteringModel() {
                    try {
                        await fetch('/api/user-preferences', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ key: 'clusteringModel', value: this.clusteringModel })
                        });
                    } catch (e) {
                        console.error('Failed to save clustering model', e);
                    }
                },

                async addGeminiKey() {
                    const apiKey = String(this.newGeminiKey || '').trim();
                    this.addGeminiKeyError = '';
                    this.addGeminiKeyMessage = '';
                    if (apiKey.length < 20 || /\s/.test(apiKey)) {
                        this.addGeminiKeyError = 'Enter a complete Gemini API key without spaces.';
                        return;
                    }

                    this.addingGeminiKey = true;
                    try {
                        const response = await fetch('/api/gemini-keys', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ apiKey })
                        });
                        const data = await response.json().catch(() => ({}));
                        if (!response.ok) throw new Error(data.detail || data.error || 'Could not add the Gemini key');
                        this.addGeminiKeyMessage = data.message || 'The key was validated and activated.';
                        this.newGeminiKey = '';
                        this.newGeminiKeyVisible = false;
                        await Promise.all([
                            this.fetchGeminiKeyStatus(),
                            this.fetchGeminiDebugStats()
                        ]);
                    } catch (error) {
                        this.addGeminiKeyError = error.message || 'Could not add the Gemini key';
                    } finally {
                        this.addingGeminiKey = false;
                    }
                },

                async fetchSmartAiProgress() {
                    try {
                        const response = await fetch('/api/smart-status');
                        if (!response.ok) return;
                        const status = await response.json();
                        const priv = getPrivate(this);
                        const previous = this.geminiKeyStatus;
                        const previousRun = previous?.lastSmartRun || {};
                        const nextProviders = Array.isArray(status.aiProviders)
                            ? status.aiProviders
                            : (previousRun.providers || []);
                        const nextProviderOrder = Array.isArray(status.providerOrder)
                            ? status.providerOrder.filter(provider => provider !== 'qwen-flash')
                            : (Array.isArray(previousRun.providerOrder) && previousRun.providerOrder.length
                                ? previousRun.providerOrder
                                : ['gemini-flash-lite', 'gemini-flash', 'local-qwen']);
                        const nextProgress = status.progress || previousRun.progress || null;
                        const nextRun = {
                            state: status.state || previousRun.state || '',
                            startedAt: status.startedAt || previousRun.startedAt || '',
                            completedAt: status.completedAt || previousRun.completedAt || '',
                            localConfigured: Boolean(status.localConfigured),
                            localUsed: Boolean(status.localUsed),
                            localModel: status.localModel || previousRun.localModel || 'qwen3.5:4b',
                            geminiUsed: Boolean(status.geminiUsed),
                            providers: nextProviders,
                            providerOrder: nextProviderOrder,
                            reviewedArticleCount: Number(status.geminiReviewedArticleCount) || previousRun.reviewedArticleCount || 0,
                            eligibleArticleCount: Number(status.geminiEligibleArticleCount) || previousRun.eligibleArticleCount || 0,
                            reason: status.geminiReason || previousRun.reason || '',
                            progress: nextProgress
                        };
                        const nextSig = JSON.stringify(nextRun);
                        if (previous?.lastSmartRun && priv.lastSmartRunSig === nextSig) {
                            return;
                        }
                        priv.lastSmartRunSig = nextSig;

                        if (!previous) {
                            if (this.geminiStatusLoading) return;
                            this.geminiKeyStatus = { lastSmartRun: nextRun };
                            return;
                        }

                        if (!previous.lastSmartRun || typeof previous.lastSmartRun !== 'object') {
                            previous.lastSmartRun = nextRun;
                            return;
                        }

                        const currentRun = previous.lastSmartRun;
                        const scalarKeys = [
                            'state', 'startedAt', 'completedAt', 'localConfigured',
                            'localUsed', 'localModel', 'geminiUsed',
                            'reviewedArticleCount', 'eligibleArticleCount', 'reason'
                        ];
                        for (const key of scalarKeys) {
                            if (currentRun[key] !== nextRun[key]) {
                                currentRun[key] = nextRun[key];
                            }
                        }
                        if (JSON.stringify(currentRun.providers) !== JSON.stringify(nextProviders)) {
                            currentRun.providers = nextProviders;
                        }
                        if (JSON.stringify(currentRun.providerOrder) !== JSON.stringify(nextProviderOrder)) {
                            currentRun.providerOrder = nextProviderOrder;
                        }
                        if (!nextProgress || typeof nextProgress !== 'object') {
                            if (currentRun.progress !== nextProgress) {
                                currentRun.progress = nextProgress;
                            }
                        } else if (!currentRun.progress || typeof currentRun.progress !== 'object') {
                            currentRun.progress = { ...nextProgress };
                        } else {
                            syncScalarObject(currentRun.progress, nextProgress);
                        }
                    } catch (error) { }
                },

                async fetchGeminiDebugStats() {
                    try {
                        const res = await fetch('/api/summary/debug');
                        if (!res.ok) return;
                        const raw = await res.text();
                        const priv = getPrivate(this);
                        if (this.geminiDebugStats && priv.lastDebugStatsRaw === raw) {
                            return;
                        }
                        const next = JSON.parse(raw);
                        priv.lastDebugStatsRaw = raw;

                        if (!this.geminiDebugStats || typeof this.geminiDebugStats !== 'object') {
                            this.geminiDebugStats = next;
                            return;
                        }

                        const current = this.geminiDebugStats;
                        if (next.queue && typeof next.queue === 'object') {
                            if (!current.queue || typeof current.queue !== 'object') {
                                current.queue = next.queue;
                            } else {
                                for (const key of ['processing', 'paused', 'currentUrl', 'queueLength']) {
                                    if (current.queue[key] !== next.queue[key]) {
                                        current.queue[key] = next.queue[key];
                                    }
                                }
                                if (next.queue.stats && typeof next.queue.stats === 'object') {
                                    if (!current.queue.stats || typeof current.queue.stats !== 'object') {
                                        current.queue.stats = next.queue.stats;
                                    } else {
                                        syncScalarObject(current.queue.stats, next.queue.stats);
                                    }
                                }
                            }
                        }

                        if (next.gemini && typeof next.gemini === 'object') {
                            if (!current.gemini || typeof current.gemini !== 'object') {
                                current.gemini = next.gemini;
                            } else {
                                for (const key of ['activeKeyIndex', 'totalKeys', 'activeKeyMasked', 'autoSwitchCount']) {
                                    if (current.gemini[key] !== next.gemini[key]) {
                                        current.gemini[key] = next.gemini[key];
                                    }
                                }
                                const curKeys = current.gemini.keys;
                                const nextKeys = next.gemini.keys;
                                if (
                                    Array.isArray(curKeys) &&
                                    Array.isArray(nextKeys) &&
                                    curKeys.length === nextKeys.length &&
                                    curKeys.every((item, i) => item?.index === nextKeys[i]?.index)
                                ) {
                                    for (let i = 0; i < nextKeys.length; i++) {
                                        syncScalarObject(curKeys[i], nextKeys[i]);
                                    }
                                } else {
                                    current.gemini.keys = Array.isArray(nextKeys) ? nextKeys : [];
                                }
                            }
                        }
                    } catch (e) {}
                },

                async fetchGeminiKeyStatus() {
                    if (this.geminiStatusLoading) return;
                    this.geminiStatusLoading = true;
                    this.geminiStatusError = '';
                    try {
                        const response = await fetch('/api/gemini-key-status');
                        if (!response.ok) throw new Error('Could not check the Gemini key');
                        const next = await response.json();
                        const priv = getPrivate(this);
                        priv.lastSmartRunSig = next?.lastSmartRun ? JSON.stringify({
                            state: next.lastSmartRun.state || '',
                            startedAt: next.lastSmartRun.startedAt || '',
                            completedAt: next.lastSmartRun.completedAt || '',
                            localConfigured: Boolean(next.lastSmartRun.localConfigured),
                            localUsed: Boolean(next.lastSmartRun.localUsed),
                            localModel: next.lastSmartRun.localModel || 'qwen3.5:4b',
                            geminiUsed: Boolean(next.lastSmartRun.geminiUsed),
                            providers: Array.isArray(next.lastSmartRun.providers) ? next.lastSmartRun.providers : [],
                            providerOrder: Array.isArray(next.lastSmartRun.providerOrder) ? next.lastSmartRun.providerOrder : ['gemini-flash-lite', 'gemini-flash', 'local-qwen'],
                            reviewedArticleCount: Number(next.lastSmartRun.reviewedArticleCount) || 0,
                            eligibleArticleCount: Number(next.lastSmartRun.eligibleArticleCount) || 0,
                            reason: next.lastSmartRun.reason || '',
                            progress: next.lastSmartRun.progress || null
                        }) : '';
                        this.geminiKeyStatus = next;
                    } catch (error) {
                        this.geminiStatusError = error.message;
                    } finally {
                        this.geminiStatusLoading = false;
                    }
                },
        };
    }
    };
})();
