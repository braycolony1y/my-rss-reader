// Owns article / prefetch on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderArticlePrefetch = {
    create() {
        return {

                prefetchNextAfter(articleOrLink) {
                    if (this.isRedditArticle(articleOrLink)) return;
                    const targetUrl = typeof articleOrLink === 'string'
                        ? articleOrLink
                        : (this.articleReaderUrl(articleOrLink) || articleOrLink?.id);
                    if (!targetUrl || !Array.isArray(this.articles) || !this.articles.length) return;

                    const sourceArray = this.displayedArticles || [];
                    let currentIndex = sourceArray.findIndex(a => (a.originalLink || a.link || a.id) === targetUrl || a.link === targetUrl);
                    if (currentIndex === -1 && typeof articleOrLink === 'object' && articleOrLink?.link) {
                        currentIndex = sourceArray.findIndex(a => a.link === articleOrLink.link);
                    }
                    if (currentIndex !== -1) {
                        const nextFive = sourceArray.slice(currentIndex + 1, currentIndex + 6);
                        if (nextFive.length > 0) {
                            this.prefetchArticlesList(nextFive, false);
                        }
                    }
                },

                prefetchArticlesList(articlesToPrefetch, clearQueue = false) {
                    if (!this.articleContentCache) this.articleContentCache = new Map();
                    if (!Array.isArray(articlesToPrefetch) || !articlesToPrefetch.length) return;

                    if (clearQueue) this.prefetchQueue = [];
                    if (!this.prefetchQueue) this.prefetchQueue = [];

                    for (const art of articlesToPrefetch) {
                        if (this.isRedditArticle(art)) continue;
                        const url = this.articleReaderUrl(art);
                        if (!url || this.articleContentCache.has(url)) continue;
                        if (!this.prefetchQueue.some(item => this.articleReaderUrl(item) === url)) {
                            this.prefetchQueue.push(art);
                        }
                    }
                    if (this.prefetchQueue.length > 0 && !this.isProcessingPrefetch) {
                        this.processPrefetchQueue();
                    }
                },

                async processPrefetchQueue() {
                    if (this.isProcessingPrefetch) return;
                    this.isProcessingPrefetch = true;

                    while (this.prefetchQueue && this.prefetchQueue.length > 0) {
                        if (this.isLoadingOverlay && this.articleOverlayOpen && !this.overlayContent) {
                            await new Promise(r => setTimeout(r, 400));
                            continue;
                        }

                        const art = this.prefetchQueue.shift();
                        if (!art || this.isRedditArticle(art)) continue;
                        const url = this.articleReaderUrl(art);
                        if (!url || (this.articleContentCache && this.articleContentCache.has(url))) continue;

                        try {
                            const params = new URLSearchParams({
                                url,
                                title: art.title || '',
                                description: String(art.content || '').slice(0, 1200),
                                feedTitle: art.feedTitle || '',
                                feedUrl: art.feedUrl || '',
                                feedIcon: art.feedIcon || '',
                                prefetch: '1',
                                _t: Date.now().toString()
                            });
                            const res = await fetch('/api/article-content?' + params.toString());
                            if (res.ok) {
                                const data = await res.json();
                                if (!data.error && data.content) {
                                    if (!this.articleContentCache) this.articleContentCache = new Map();
                                    this.articleContentCache.set(url, data);
                                    if (this.articleContentCache.size > 60) {
                                        const firstKey = this.articleContentCache.keys().next().value;
                                        this.articleContentCache.delete(firstKey);
                                    }
                                }
                            }
                        } catch (e) {
                            // Silently ignore background prefetch errors
                        }
                        await new Promise(r => setTimeout(r, 350));
                    }
                    this.isProcessingPrefetch = false;
                },
        };
    }
};
