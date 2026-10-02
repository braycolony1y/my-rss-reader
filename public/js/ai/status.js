// Owns ai / status on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderAiStatus = {
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

                openGeminiStatus() {
                    this.geminiStatusOpen = true;
                    this.mobileSidebarOpen = false;
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
                            this.onlineAiUsageNow = Date.now();
                            if (this.onlineAiUsageOffset === 0) this.fetchOnlineAiUsage(true);
                        }, 60000);
                    }
                },

                closeGeminiStatus() {
                    this.geminiStatusOpen = false;
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
                    if (this.onlineAiUsageLoading) return;
                    this.onlineAiUsageLoading = true;
                    if (!silent) this.onlineAiUsageError = '';
                    try {
                        const response = await fetch(`/api/online-ai-usage?limit=${encodeURIComponent(this.onlineAiUsageLimit)}&offset=${encodeURIComponent(this.onlineAiUsageOffset)}`, {
                            cache: 'no-store'
                        });
                        const data = await response.json().catch(() => ({}));
                        if (!response.ok) throw new Error(data.detail || data.error || 'Could not load online AI activity');
                        this.onlineAiUsage = data;
                        this.onlineAiUsageError = data.warning || '';
                    } catch (error) {
                        this.onlineAiUsageError = error.message || 'Could not load online AI activity';
                    } finally {
                        this.onlineAiUsageLoading = false;
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
                    const events = Array.isArray(this.onlineAiUsage?.events) ? this.onlineAiUsage.events : [];
                    const query = String(this.onlineAiUsageSearch || '').trim().toLowerCase();
                    return events.filter(event => {
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

                        if (this.onlineAiUsageStatus !== 'all' && event.status !== this.onlineAiUsageStatus) return false;
                        if (this.onlineAiUsageProvider !== 'all' && event.provider !== this.onlineAiUsageProvider) return false;
                        if (this.onlineAiUsageOperation !== 'all' && event.operation !== this.onlineAiUsageOperation) return false;
                        if (this.onlineAiUsageModel !== 'all' && event.model !== this.onlineAiUsageModel) return false;
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
                        const previous = this.geminiKeyStatus || {};
                        const previousRun = previous.lastSmartRun || {};
                        this.geminiKeyStatus = {
                            ...previous,
                            lastSmartRun: {
                                ...previousRun,
                                state: status.state || previousRun.state || '',
                                startedAt: status.startedAt || previousRun.startedAt || '',
                                completedAt: status.completedAt || previousRun.completedAt || '',
                                localConfigured: Boolean(status.localConfigured),
                                localUsed: Boolean(status.localUsed),
                                localModel: status.localModel || previousRun.localModel || 'qwen3.5:4b',
                                geminiUsed: Boolean(status.geminiUsed),
                                providers: Array.isArray(status.aiProviders) ? status.aiProviders : (previousRun.providers || []),
                                providerOrder: Array.isArray(status.providerOrder)
                                    ? status.providerOrder.filter(provider => provider !== 'qwen-flash')
                                    : ['gemini-flash-lite', 'gemini-flash', 'local-qwen'],
                                reviewedArticleCount: Number(status.geminiReviewedArticleCount) || previousRun.reviewedArticleCount || 0,
                                eligibleArticleCount: Number(status.geminiEligibleArticleCount) || previousRun.eligibleArticleCount || 0,
                                reason: status.geminiReason || previousRun.reason || '',
                                progress: status.progress || previousRun.progress || null
                            }
                        };
                    } catch (error) { }
                },

                async fetchGeminiDebugStats() {
                    try {
                        const res = await fetch('/api/summary/debug');
                        if (res.ok) {
                            this.geminiDebugStats = await res.json();
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
                        this.geminiKeyStatus = await response.json();
                    } catch (error) {
                        this.geminiStatusError = error.message;
                    } finally {
                        this.geminiStatusLoading = false;
                    }
                },
        };
    }
};
