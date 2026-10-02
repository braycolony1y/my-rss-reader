// Owns article / navigation on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderArticleNavigation = {
    create() {
        return {


                sortedRelatedArticles(articles) {
                    return [...(Array.isArray(articles) ? articles : [])].sort((a, b) =>
                        (Number(b.sourceWeight) || 1) - (Number(a.sourceWeight) || 1) ||
                        (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0) ||
                        String(a.link || '').localeCompare(String(b.link || ''))
                    );
                },

                normalizeArticleSourceUrl(value) {
                    return String(value || '').trim().replace(
                        /(\.(?:tpo|chn|s?html?|aspx?|php))[\]\\)}]+([?#].*)?$/i,
                        '$1$2'
                    );
                },

                articleReaderUrl(articleOrUrl) {
                    const raw = typeof articleOrUrl === 'string'
                        ? articleOrUrl
                        : (articleOrUrl?.resolvedLink || articleOrUrl?.link || articleOrUrl?.originalLink || '');
                    return this.normalizeArticleSourceUrl(raw);
                },

                isRedditArticle(articleOrUrl) {
                    try {
                        const url = new URL(this.articleReaderUrl(articleOrUrl));
                        return ['http:', 'https:'].includes(url.protocol)
                            && (url.hostname === 'reddit.com' || url.hostname.endsWith('.reddit.com') || url.hostname === 'redd.it');
                    } catch { return false; }
                },

                articleSourceUrl(article) {
                    const raw = this.articleReaderUrl(article);
                    if (this.selectedFilterType === 'board' || this.isOnBoard(article)) {
                        try {
                            const url = new URL(raw);
                            if (url.hostname === 'voz.vn' && /^\/t\/(?:[^/]*\.)?\d+(?:\/|$)/i.test(url.pathname)) {
                                url.pathname = url.pathname.replace(/\/(?:unread|latest|page-\d+|post-\d+)\/?$/i, '').replace(/\/+$/, '') + '/unread';
                                url.search = ''; url.hash = '';
                                return url.href;
                            }
                        } catch {}
                    }
                    return raw;
                },

                isGoogleNewsArticleUrl(value) {
                    try {
                        const parsed = new URL(value);
                        return parsed.hostname === 'news.google.com' && /\/(?:rss\/)?articles\//.test(parsed.pathname);
                    } catch (e) {
                        return false;
                    }
                },

                articleRouteUrl(articleOrUrl) {
                    const raw = this.articleReaderUrl(articleOrUrl);
                    if (!raw) return '';
                    const normalized = this.normalizeArticleSourceUrl(raw);
                    try {
                        const parsed = new URL(normalized, window.location.origin);
                        parsed.hash = '';
                        return parsed.href;
                    } catch (e) {
                        return normalized;
                    }
                },

                articleIdentity(articleOrUrl) {
                    return this.normalizeStateLink(this.articleRouteUrl(articleOrUrl));
                },

                filterHash(articleUrl = '') {
                    const base = `${this.selectedFilterType}${this.selectedFilterValue ? '/' + encodeURIComponent(this.selectedFilterValue) : ''}`;
                    return articleUrl ? `#${base}?article=${encodeURIComponent(articleUrl)}` : `#${base}`;
                },

                updateArticleRoute(articleOrUrl, replace = false) {
                    const articleUrl = this.articleRouteUrl(articleOrUrl);
                    const nextHash = this.filterHash(articleUrl);
                    if (window.location.hash === nextHash) return;
                    const nextUrl = window.location.pathname + window.location.search + nextHash;
                    window.history[replace ? 'replaceState' : 'pushState'](window.history.state, '', nextUrl);
                },

                clearArticleRoute(replace = true) {
                    const nextHash = this.filterHash();
                    if (window.location.hash === nextHash) return;
                    const nextUrl = window.location.pathname + window.location.search + nextHash;
                    window.history[replace ? 'replaceState' : 'pushState'](window.history.state, '', nextUrl);
                },

                findArticleByRouteUrl(articleUrl) {
                    const target = this.articleIdentity(articleUrl);
                    const candidates = [];
                    const append = article => {
                        if (!article) return;
                        candidates.push(article);
                        if (Array.isArray(article.relatedArticles)) article.relatedArticles.forEach(append);
                    };
                    (this.articles || []).forEach(append);
                    return candidates.find(article =>
                        [article.originalLink, article.link, article.resolvedLink]
                            .filter(Boolean)
                            .some(link => this.articleIdentity(link) === target)
                    ) || null;
                },

                async openArticleFromRoute(articleUrl) {
                    if (!articleUrl) return;
                    const targetUrl = this.articleRouteUrl(articleUrl);
                    if (this.articleOverlayOpen && this.articleRouteUrl(this.overlayArticle) === targetUrl) return;

                    const previous = this.articleOverlayStack[this.articleOverlayStack.length - 1];
                    if (previous && this.articleRouteUrl(previous.overlayArticle) === targetUrl) {
                        this.articleOverlayStack.pop();
                        this.restoreArticleOverlay(previous, false);
                        return;
                    }

                    // Thread identity finds metadata, but the route determines
                    // the exact page/post, including on a fresh device.
                    const article = {
                        title: '',
                        feedCategory: this.selectedFilterType === 'category' ? this.selectedFilterValue : '',
                        ...this.findArticleByRouteUrl(articleUrl),
                        link: targetUrl,
                        originalLink: targetUrl,
                        resolvedLink: targetUrl
                    };
                    await this.openArticleOverlay(article, {
                        stack: this.articleOverlayOpen,
                        updateHistory: false
                    });
                },

                getFilterFromHash() {
                    const hash = window.location.hash.substring(1);
                    if (hash) {
                        const articleMarker = '?article=';
                        const markerIndex = hash.lastIndexOf(articleMarker);
                        const filterPath = markerIndex === -1 ? hash : hash.slice(0, markerIndex);
                        const encodedArticle = markerIndex === -1 ? '' : hash.slice(markerIndex + articleMarker.length);
                        const parts = filterPath.split('/');
                        let articleUrl = '';
                        try { articleUrl = encodedArticle ? this.normalizeArticleSourceUrl(decodeURIComponent(encodedArticle)) : ''; } catch (e) { }
                        return {
                            type: parts[0],
                            value: parts.length > 1 ? (() => { let value; try { value = decodeURIComponent(parts.slice(1).join('/')); } catch { value = parts.slice(1).join('/'); } return parts[0] === 'smart' ? this.normalizeSmartDestination(value) : value; })() : null,
                            articleUrl
                        };
                    }
                    return null;
                },

                async handleHashChange() {
                    this.hideTooltip();
                    const hashFilter = this.getFilterFromHash();
                    if (!hashFilter) return;
                    if (hashFilter.type !== this.selectedFilterType || hashFilter.value !== this.selectedFilterValue) {
                        this.selectedFilterType = hashFilter.type;
                        this.selectedFilterValue = hashFilter.value;
                        if (hashFilter.type === 'smart') this.smartRegion = String(hashFilter.value).endsWith('_vietnam') ? 'vietnam' : 'global';
                        this.currentPage = 1;
                        this.hasMore = false;
                        this.articles = [];
                        await this.fetchData();
                    }
                    if (hashFilter.articleUrl) {
                        await this.openArticleFromRoute(hashFilter.articleUrl);
                    } else if (this.articleOverlayOpen) {
                        this.closeArticleOverlay({ updateHistory: false, closeAll: true });
                    }
                },
        };
    }
};
