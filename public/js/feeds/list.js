// Owns feeds / list on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderFeedsList = {
    create() {
        return {
                
                feeds: [],
                articles: [],

                // PAGINATION & SIDEBAR STATE
                currentPage: 1,
                hasMore: true,
                isLoadingMore: false,
                isLoadingArticles: false,
                loadingArticleStatus: '',
                articleRequestGeneration: 0,
                unreadCounts: { feeds: {}, categories: {}, total: 0 },

                fetchData(...args) { return ReaderFeedRequests.fetchData.apply(this, args); },

                loadMore() { return ReaderFeedPagination.loadMore.call(this); },
                goToPage(page) { return ReaderFeedPagination.goToPage.call(this, page); },
                handleScroll(event) { return ReaderFeedPagination.handleScroll.call(this, event); },

                get displayedArticles() {
                    return this.articles;
                },

                /* Alpine needs a key that is present and unique even when a
                   feed item has no `link` (or when a cluster exposes a
                   different canonical URL).  Undefined/duplicate keys make
                   Alpine reuse the previous card's DOM, which looks like a
                   flash of another article during scrolling. */
                articleRowKeys: new WeakMap(),
                articleRowSequence: 0,
                articleRowKey(article, index) {
                    if (!article || typeof article !== 'object') return this.articleKey(article, index);
                    if (!this.articleRowKeys.has(article)) this.articleRowKeys.set(article, this.articleKey(article) + ':row:' + (++this.articleRowSequence));
                    return this.articleRowKeys.get(article);
                },

                articleKey(article, index = '') {
                    if (!article) return 'article:empty';
                    const identity = article.id || article.guid || article.originalLink || article.link;
                    const suffix = index === '' ? '' : ':' + String(index);
                    if (identity) return 'article:' + String(identity) + suffix;
                    return 'article:' + String(article.pubDate || '') + ':' + String(article.title || '') + suffix;
                },

                handleCardClick(article, event) {
                    if (this.isRedditArticle(article)) {
                        event?.preventDefault();
                        this.openArticleOverlay(article);
                        return;
                    }
                    if (!this.isVozArticle(article)) {
                        // VOZ_SKIP_CARDCLICK_PREFETCH_V5
                        // VOZ has its own post-first-paint deferred prefetch.
                        this.prefetchNextAfter(article);
                    }
                    if (this.isMobile) {
                        if (this.mobileActiveCard === article.link) {
                            this.openArticleOverlay(article);
                            this.mobileActiveCard = null;
                        } else {
                            this.mobileActiveCard = article.link;
                        }
                    } else {
                        this.openArticleOverlay(article);
                    }
                },

                handleCardHover(article) {
                    if (this.isRedditArticle(article)) return;
                    if (this.isMobile) return;
                    const url = this.articleReaderUrl(article);
                    if (!url) return;
                    
                    this.hoveredArticleUrl = url;
                    
                    
                    // If already in client-side cache, skip
                    if (this.articleContentCache && this.articleContentCache.has(url)) return;
                    
                    if (!this.hoverPrefetchTimeouts) this.hoverPrefetchTimeouts = {};
                    if (this.hoverPrefetchTimeouts[url]) clearTimeout(this.hoverPrefetchTimeouts[url]);
                    
                    this.hoverPrefetchTimeouts[url] = setTimeout(() => {
                        if (this.hoveredArticleUrl !== url) return;
                        if ((this.activeHoverPrefetches || 0) >= 2) return; // Cap at 2 concurrent
                        
                        this.activeHoverPrefetches = (this.activeHoverPrefetches || 0) + 1;
                        if (!this.articleContentCache) this.articleContentCache = new Map();
                        
                        fetch('/api/article-content?' + new URLSearchParams({
                            url,
                            title: article.title || '',
                            description: String(article.content || '').slice(0, 1200),
                            feedTitle: article.feedTitle || '',
                            feedUrl: article.feedUrl || '',
                            feedIcon: article.feedIcon || '',
                            prefetch: '1',
                            _t: Date.now().toString()
                        }).toString()).then(res => res.ok ? res.json() : null).then(data => {
                            if (data && !data.error && data.content) {
                                if (!this.articleContentCache) this.articleContentCache = new Map();
                                this.articleContentCache.set(url, data);
                                if (this.articleContentCache.size > 80) {
                                    const firstKey = this.articleContentCache.keys().next().value;
                                    this.articleContentCache.delete(firstKey);
                                }
                            }
                        }).catch(() => {}).finally(() => {
                            this.activeHoverPrefetches = (this.activeHoverPrefetches || 1) - 1;
                        });
                    }, 400);
                },

                handleCardHoverOut(article) {
                    const url = this.articleReaderUrl(article);
                    if (this.hoveredArticleUrl === url) {
                        this.hoveredArticleUrl = null;
                    }

                    if (this.hoverPrefetchTimeouts && this.hoverPrefetchTimeouts[url]) {
                        clearTimeout(this.hoverPrefetchTimeouts[url]);
                        delete this.hoverPrefetchTimeouts[url];
                    }
                },
        };
    }
};
