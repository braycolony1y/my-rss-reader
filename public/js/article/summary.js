// Owns article / summary on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderArticleSummary = {
    create() {
        return {
                // AI Summary state
                aiSummary: null,
                aiSummaryLoading: false,
                aiSummaryExpanded: false,
                aiSummaryError: null,
                aiAnalysisLoading: false,
                aiSummaryPollTimer: null,
                aiSummaryUpgradePollTimer: null,
                vozSummaryProgress: null,
                vozSummaryController: null,

                // ─── AI Summary Methods ────────────────────────────────
                isVozArticle(article) {
                    if (!article) return false;
                    const url = article.originalLink || article.link || '';
                    return url.includes('voz.vn');
                },

                async fetchAiSummary(url) {
                    if (!url) return;
                    this.aiSummaryLoading = true;
                    try {
                        // Prioritize this article
                        fetch('/api/summary/prioritize', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url })
                        }).catch(() => {});

                        const res = await fetch(`/api/summary?url=${encodeURIComponent(url)}`);
                        if (!res.ok) { this.aiSummaryLoading = false; return; }
                        const data = await res.json();

                        if (data.status === 'ready') {
                            this.aiSummary = data;
                            this.aiSummaryLoading = false;
                        } else if (data.status === 'voz_manual') {
                            this.aiSummary = { status: 'voz_manual' };
                            this.aiSummaryLoading = false;
                        } else {
                            // pending or generating — start polling
                            this.aiSummary = data;
                            this.pollAiSummary(url);
                        }
                    } catch (e) {
                        this.aiSummaryLoading = false;
                        this.aiSummaryError = e.message;
                    }
                },

                pollAiSummary(url) {
                    if (this.aiSummaryPollTimer) clearInterval(this.aiSummaryPollTimer);
                    let attempts = 0;
                    this.aiSummaryPollTimer = setInterval(async () => {
                        attempts++;
                        if (attempts > 60) { // Stop after ~3 minutes
                            clearInterval(this.aiSummaryPollTimer);
                            this.aiSummaryPollTimer = null;
                            this.aiSummaryLoading = false;
                            return;
                        }
                        try {
                            const res = await fetch(`/api/summary?url=${encodeURIComponent(url)}`);
                            if (!res.ok) return;
                            const data = await res.json();
                            if (data.status === 'ready') {
                                this.aiSummary = data;
                                this.aiSummaryLoading = false;
                                clearInterval(this.aiSummaryPollTimer);
                                this.aiSummaryPollTimer = null;
                            } else {
                                this.aiSummary = data;
                            }
                        } catch (e) {}
                    }, 3000);
                },

                pollAiSummaryUpgrade(url) {
                    if (this.aiSummaryUpgradePollTimer) clearInterval(this.aiSummaryUpgradePollTimer);
                    let attempts = 0;
                    this.aiSummaryUpgradePollTimer = setInterval(async () => {
                        attempts++;
                        if (attempts > 30) { // Stop after 90s
                            clearInterval(this.aiSummaryUpgradePollTimer);
                            this.aiSummaryUpgradePollTimer = null;
                            return;
                        }
                        try {
                            const res = await fetch(`/api/summary?url=${encodeURIComponent(url)}`);
                            if (!res.ok) return;
                            const data = await res.json();
                            if (data.status === 'ready' && data.modelUsed === 'gemini-3.8-flash') {
                                this.aiSummary = data;
                                clearInterval(this.aiSummaryUpgradePollTimer);
                                this.aiSummaryUpgradePollTimer = null;
                            }
                        } catch (e) {}
                    }, 3000);
                },

                async submitSummaryFeedback(url, feedback) {
                    if (!url) return;
                    try {
                        await fetch('/api/summary/feedback', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url, feedback })
                        });
                        if (this.aiSummary) {
                            this.aiSummary = { ...this.aiSummary, feedback };
                        }
                    } catch (e) {}
                },

                async fetchAiAnalysis(url) {
                    if (!url || this.aiAnalysisLoading) return;
                    this.aiAnalysisLoading = true;
                    try {
                        const res = await fetch('/api/summary/analysis', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url })
                        });
                        const data = await res.json();
                        if (data.success && data.analysis) {
                            if (!this.aiSummary) this.aiSummary = {};
                            this.aiSummary.analysis = data.analysis;
                            this.aiSummary.analysisModel = data.analysisModel;
                        }
                    } catch (e) {
                        console.error('Failed to fetch analysis:', e);
                    } finally {
                        this.aiAnalysisLoading = false;
                    }
                },
                async generateVozSummary(url, mode = 'detailed') {
                    if (!url) return;
                    this.vozSummaryProgress = { stage: 'starting', current: 0, total: null, message: 'Starting...' };
                    this.aiSummary = null;

                    try {
                        const res = await fetch('/api/summary/voz', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url, mode })
                        });
                        if (!res.ok) throw new Error('Failed to start summary');
                        
                        this.pollVozSummary(url);
                    } catch (e) {
                        this.aiSummaryError = e.message;
                        this.vozSummaryProgress = null;
                    }
                },

                pollVozSummary(url) {
                    if (this.vozSummaryPollTimer) clearInterval(this.vozSummaryPollTimer);
                    this.vozSummaryPollTimer = setInterval(async () => {
                        try {
                            const res = await fetch(`/api/summary/voz/status?url=${encodeURIComponent(url)}`);
                            if (!res.ok) return;
                            const data = await res.json();
                            
                            if (data.status === 'not_found') {
                                clearInterval(this.vozSummaryPollTimer);
                                this.vozSummaryProgress = null;
                            } else if (data.status === 'ready') {
                                clearInterval(this.vozSummaryPollTimer);
                                this.aiSummary = data.summary;
                                this.vozSummaryProgress = null;
                                if (this.overlayArticle && (this.overlayArticle.link === url || this.overlayArticle.originalLink === url)) {
                                    this.overlayArticle.vozSummary = data.summary;
                                }
                                const article = this.articles.find(a => a.link === url || a.originalLink === url);
                                if (article) article.vozSummary = data.summary;
                            } else if (data.status === 'error') {
                                clearInterval(this.vozSummaryPollTimer);
                                this.aiSummaryError = data.error;
                                this.vozSummaryProgress = null;
                            } else if (data.status === 'generating') {
                                this.vozSummaryProgress = data.progress;
                            }
                        } catch(e) {}
                    }, 2000);
                },

                async cancelVozSummary(url) {
                    if (this.vozSummaryPollTimer) {
                        clearInterval(this.vozSummaryPollTimer);
                        this.vozSummaryPollTimer = null;
                    }
                    this.vozSummaryProgress = null;
                    
                    if (url) {
                        try {
                            await fetch('/api/summary/voz/cancel', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ url })
                            });
                        } catch(e) {}
                    }
                },

                exportVozToPdf(url) {
                    const summary = this.aiSummary;
                    if (!summary || !summary.rawPosts || summary.rawPosts.length === 0) {
                        alert('Raw thread data not available. Please generate a new summary to export the full thread.');
                        return;
                    }
                    
                    const printWindow = window.open('', '_blank');
                    const content = `
                        <html>
                        <head>
                            <title>Voz Thread Export - ${url}</title>
                            <style>
                                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; }
                                h1 { font-size: 24px; margin-bottom: 10px; }
                                .meta { color: #666; font-size: 14px; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 1px solid #eee; }
                                .post { margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #eee; }
                                .post-header { font-weight: bold; margin-bottom: 10px; color: #4f46e5; }
                                .post-content { white-space: pre-wrap; font-size: 15px; }
                            </style>
                        </head>
                        <body>
                            <h1>Voz Thread Export</h1>
                            <div class="meta">Source: <a href="${url}">${url}</a><br>Exported on: ${new Date().toLocaleString()}<br>Total Posts: ${summary.rawPosts.length}</div>
                            
                            ${summary.rawPosts.map(p => `
                                <div class="post">
                                    <div class="post-header">#${p.number} - ${p.author || 'Anonymous'}</div>
                                    <div class="post-content">${p.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                                </div>
                            `).join('')}
                            
                            <script>
                                window.onload = () => { window.print(); };
                            </script>
                        </body>
                        </html>
                    `;
                    printWindow.document.write(content);
                    printWindow.document.close();
                },

                async generateSummary(url, mode) {
                    if (!url) return;
                    if (this.isVozArticle(this.overlayArticle)) {
                        return this.generateVozSummary(url, mode);
                    }
                    try {
                        // First, explicitly check if it's already in the cache
                        const checkRes = await fetch('/api/summary?url=' + encodeURIComponent(url));
                        if (checkRes.ok) {
                            const data = await checkRes.json();
                            if (data && data.status === 'ready') {
                                this.aiSummary = data;
                                return; // Already generated!
                            }
                        }

                        await fetch('/api/summary/upgrade', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url })
                        });
                        if (this.aiSummary) this.aiSummary.status = 'pending';
                        this.fetchAiSummary(url); // Start polling

                    } catch (e) {
                        console.error('Failed to trigger summary:', e);
                    }
                },
        };
    }
};
