// Owns article / overlay on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderArticleOverlay = {
    create() {
        return {

                // ARTICLE OVERLAY STATE
                articleOverlayOpen: false,
                isLoadingOverlay: false,
                overlayArticle: null,
                articleOverlayStack: [],
                overlayContent: null,
                overlayPagination: null,
                vozThreadNotice: null,
                overlayError: null,
                overlayRemainingAvailable: false,
                
                hoveredArticleUrl: null,
                overlayProgress: { message: '' },
                overlayProgressInterval: null,
                overlayRequestId: '',
                overlayFetchStrategy: '',
                overlayFetchedFromCache: false,
                overlayHasNativeAudio: false,
                overlayMethodResults: {},
                overlayAttemptedStrategies: [],
                overlayRejectedStrategies: [],
                overlayMethodPreferences: {},
                overlayTryingMethod: false,
                overlayMethodError: '',

                articleFetchStrategyLabel(strategy) {
                    return ({
                        direct: 'Publisher website',
                        cloudflare: 'Cloudflare reader proxy',
                        vietserver: 'Vietnam reader proxy',
                        allorigins: 'AllOrigins backup proxy',
                        jina: 'Jina Reader',
                        opencli: 'OpenCLI browser reader',
                        'opencli-fetch': 'OpenCLI browser fetch'
                    })[strategy] || strategy;
                },

                overlaySuccessfulStrategies() {
                    return Object.keys(this.overlayMethodResults || {});
                },

                applyOverlayArticleData(data, fallbackArticle = null) {
                    if (!data || data.error) return;
                    if (!this.articleContentCache) this.articleContentCache = new Map();
                    const targetUrl = data.url || fallbackArticle?.originalLink || fallbackArticle?.link || this.overlayArticle?.originalLink || this.overlayArticle?.link;
                    if (targetUrl) {
                        this.articleContentCache.set(targetUrl, data);
                        if (this.articleContentCache.size > 60) {
                            const firstKey = this.articleContentCache.keys().next().value;
                            this.articleContentCache.delete(firstKey);
                        }
                    }
                    const strategy = data.fetchStrategy || '';
                    if (strategy && strategy !== 'none') this.overlayMethodResults = { ...this.overlayMethodResults, [strategy]: { ...data } };
                    this.stopArticleSpeech();
                    this.overlayArticle.cacheSyncStatus = data.sync_status || null;
                    this.overlayArticle.cacheLastSync = data.last_successful_sync_at || null;
                    this.overlayArticle.sourceDeleted = data.sourceDeleted === true;
                    this.overlayArticle.sourceDeletedHasCache = data.sourceDeletedHasCache !== false && Boolean(data.content);
                    this.overlayArticle.sourceDeletedKind = data.sourceDeletedKind || (this.isVozArticle(this.overlayArticle) ? 'thread' : 'article');
                    // VOZ_TARGET_PAGE_FIRST_PAINT_V2
                    //
                    // Capture the request that owns this render. VOZ target-page
                    // fetching is latency-critical: page read-ahead must not
                    // compete until the requested/resume page has actually painted.
                    const applyRequestId = this.overlayRequestId;

                    this.overlayPagination = data.pagination || null;

                    // VOZ_TARGET_PAGE_FIRST_LAST_PAGE_FIX_V1
                    //
                    // Every VOZ render gets the first-paint gate, including the
                    // final page where pagination.nextUrl does not exist.
                    //
                    // nextUrl controls only whether thread read-ahead exists;
                    // it must not control release of deferred article prefetch.
                    const deferVozWorkUntilPaint =
                        this.isVozArticle(this.overlayArticle)
                        && !this.overlayArticle.sourceDeleted;

                    // Preserve the old behavior for non-VOZ paginated sources.
                    if (
                        !this.overlayArticle.sourceDeleted
                        && this.overlayPagination?.nextUrl
                        && !deferVozWorkUntilPaint
                    ) {
                        this.prefetchThreadPages(
                            this.overlayPagination,
                            this.overlayArticle.feedUrl || ''
                        );
                    }

                    this.overlayContent = this.formatSourceTimeMarkup(data.content);
                    this.overlayHasNativeAudio = /<audio\b/i.test(this.overlayContent || '');
                    if (!this.overlayHasNativeAudio) this.prepareArticleSpeech();
                    this.overlayArticle.overlayTitle = this.stripHtml(data.sourceDeleted
                        ? (fallbackArticle?.title || this.overlayArticle.title || data.title)
                        : (data.title || fallbackArticle?.title || this.overlayArticle.title));
                    this.overlayArticle.overlayImage = data.image || fallbackArticle?.image || this.overlayArticle.image;
                    this.overlayArticle.overlayImageCaption = data.imageCaption || fallbackArticle?.imageCaption || this.overlayArticle.imageCaption || '';
                    this.overlayArticle.overlayAuthor = data.author || '';
                    this.overlayArticle.overlayAuthorAvatar = data.authorAvatar || fallbackArticle?.authorAvatar || this.overlayArticle.authorAvatar || '';
                    this.overlayArticle.overlayDate = data.date || fallbackArticle?.pubDate || this.overlayArticle.pubDate;
                    this.overlayArticle.primaryArticleUrl = data.primaryArticleUrl || this.overlayArticle.primaryArticleUrl || '';
                    this.overlayArticle.primarySource = data.primarySource || this.overlayArticle.primarySource || null;
                    this.overlayArticle.primaryArticleFetched = data.primaryArticleFetched === true;
                    this.overlayArticle.partialContent = data.partialContent === true;
                    this.overlayArticle.partialContentReason = data.partialContentReason || '';
                    
                    if (data.image && !this.overlayArticle.image) this.overlayArticle.image = data.image;
                    if (data.imageCaption && !this.overlayArticle.imageCaption) this.overlayArticle.imageCaption = data.imageCaption;
                    if (data.author && !this.overlayArticle.author) this.overlayArticle.author = data.author;
                    if (data.authorAvatar && !this.overlayArticle.authorAvatar) this.overlayArticle.authorAvatar = data.authorAvatar;
                    this.overlayArticle.siteName = data.siteName || this.overlayArticle.siteName || this.overlayArticle.feedTitle || '';
                    this.overlayArticle.isCached = Boolean(data.cached);
                    if (data.url) {
                        if (data.url !== this.overlayArticle.link) {
                            this.overlayArticle.originalLink ||= this.overlayArticle.link;
                            if (this.isGoogleNewsArticleUrl(this.overlayArticle.link) && !this.isGoogleNewsArticleUrl(data.url)) {
                                this.overlayArticle.link = data.url;
                            }
                        }
                        // Keep the exact page that produced the rendered content.
                        // VOZ /post-{id} URLs resolve to the page containing that
                        // post; background updates must refresh this page, not the
                        // feed's original /unread URL.
                        this.overlayArticle.resolvedLink = data.url;
                        if (!this.isGoogleNewsArticleUrl(data.url)) this.updateArticleRoute(this.overlayArticle, true);
                    }
                    this.overlayFetchStrategy = strategy;
                    this.overlayFetchedFromCache = data.cached === true;
                    this.overlayMethodPreferences = { ...this.overlayMethodPreferences, ...(data.methodPreferences || {}) };
                    this.overlayAttemptedStrategies = [...new Set([
                        ...this.overlayAttemptedStrategies,
                        ...(data.attemptedStrategies || []),
                        strategy
                    ].filter(Boolean))];
                    this.$nextTick(() => {
                        this.hydrateTwitterEmbeds(document.getElementById('overlay-scroll-container'));
                        if (window.Hls) {
                            document.querySelectorAll('.article-rendered-content video').forEach(video => {
                                let src = video.getAttribute('src');
                                if (!src) {
                                    const sourceTag = video.querySelector('source[src*=".m3u8"], source[type="application/x-mpegURL"]');
                                    if (sourceTag) src = sourceTag.getAttribute('src');
                                }
                                if (src && src.includes('.m3u8')) {
                                    if (Hls.isSupported()) {
                                        video.removeAttribute('src');
                                        video.querySelectorAll('source').forEach(s => s.remove());
                                        const hls = new Hls();
                                        hls.loadSource(src);
                                        hls.attachMedia(video);
                                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                                        video.src = src;
                                    }
                                }
                            });
                        }
                        const articleScroll =
                            document.getElementById(
                                'overlay-scroll-container'
                            );

                        if (articleScroll) {
                            articleScroll.scrollTop = 0;
                        }

                        // Find/scroll the remembered post before releasing any
                        // speculative VOZ work.
                        this.checkVozThreadPosition();

                        if (
                            deferVozWorkUntilPaint
                            && this.articleOverlayOpen
                            && this.overlayRequestId === applyRequestId
                        ) {
                            // First RAF commits DOM/layout.
                            // Second RAF lets the target page actually paint.
                            requestAnimationFrame(() => {
                                requestAnimationFrame(() => {
                                    if (
                                        !this.articleOverlayOpen
                                        || this.overlayRequestId !== applyRequestId
                                    ) {
                                        return;
                                    }

                                    const activeVozUrl = this.overlayArticle?.resolvedLink || this.overlayArticle?.link || '';
                                    const activeFeedUrl = this.overlayArticle?.feedUrl || '';
                                    let vozPriorityWork = Promise.resolve();

                                    if (!this.overlayArticle?.sourceDeleted) {
                                        if (this.overlayFetchedFromCache) {
                                            // VOZ_FRONTIER_PARALLEL_P0_V2
                                            //
                                            // A cached page can be stale in TWO independent ways:
                                            //   1) newer posts may have arrived on this same page;
                                            //   2) the thread may already have rolled over to page N+1.
                                            //
                                            // Refresh the exact current page and probe page N+1 in
                                            // parallel. Neither one is allowed to block the other.
                                            // This is shared by ordinary VOZ threads and Cache-board
                                            // threads; Cache-board reconciliation preserves historical
                                            // cached post bodies instead of discarding them.
                                            vozPriorityWork = Promise.resolve(
                                                this.checkVozNewPostsInBackground(
                                                    activeVozUrl,
                                                    activeFeedUrl
                                                )
                                            );
                                        } else if (this.overlayPagination?.nextUrl) {
                                            vozPriorityWork = Promise.resolve(
                                                this.prefetchThreadPages(
                                                    this.overlayPagination,
                                                    activeFeedUrl
                                                )
                                            );
                                        }
                                    }

                                    const deferred = this.vozDeferredArticlePrefetch;
                                    if (deferred && deferred.requestId === applyRequestId) {
                                        this.vozDeferredArticlePrefetch = null;
                                        // Unrelated article prefetch waits until VOZ continuation
                                        // discovery/read-ahead has had first use of the source queue.
                                        Promise.resolve(vozPriorityWork).finally(() => {
                                            if (this.articleOverlayOpen && this.overlayRequestId === applyRequestId) {
                                                this.prefetchNextAfter(deferred.article);
                                            }
                                        });
                                    }
                                });
                            });
                        }
                    });
                },

                switchOverlayFetchStrategy(strategy) {
                    const data = this.overlayMethodResults[strategy];
                    if (!data) return;
                    this.applyOverlayArticleData(data, this.overlayArticle);
                    this.overlayFetchedFromCache = data.cached === true;
                    this.overlayMethodError = '';
                },

                async setArticleFetchPreference(strategy, preference) {
                    const current = this.overlayMethodPreferences[strategy] || '';
                    const nextPreference = current === preference ? '' : preference;
                    const previous = current;
                    this.overlayMethodPreferences = { ...this.overlayMethodPreferences, [strategy]: nextPreference };
                    try {
                        const response = await fetch('/api/article-fetch-preference', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                url: this.overlayArticle?.link,
                                strategy,
                                preference: nextPreference
                            })
                        });
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error || 'Could not save method preference.');
                        this.overlayMethodPreferences = data.preferences || this.overlayMethodPreferences;
                    } catch (error) {
                        this.overlayMethodPreferences = { ...this.overlayMethodPreferences, [strategy]: previous };
                        this.overlayMethodError = error.message;
                    }
                },

                async clearArticleCache() {
                    if (!this.overlayArticle || !this.overlayFetchedFromCache) return;
                    if (this.overlayArticle.sourceDeleted) {
                        this.overlayMethodError = 'Deleted-source snapshots are protected and cannot be refreshed.';
                        return;
                    }
                    const targetUrl = this.articleReaderUrl(this.overlayArticle);
                    if (!targetUrl) return;

                    try {
                        const res = await fetch('/api/clear-article-cache', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url: targetUrl })
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) throw new Error(data.error || 'Failed to clear cache.');
                        if (this.articleContentCache) this.articleContentCache.delete(targetUrl);
                        this.overlayArticle.isCached = false;
                        this.openArticleOverlay(this.overlayArticle);
                    } catch (error) {
                        this.overlayMethodError = error.message;
                    }
                },

                async rejectAndTryNextArticleMethod() {
                    if (this.overlayTryingMethod || !this.overlayFetchStrategy || !this.overlayArticle) return;
                    if (this.overlayArticle.sourceDeleted) {
                        this.overlayMethodError = 'Deleted-source snapshots are protected and cannot reject reader methods.';
                        return;
                    }
                    const rejected = this.overlayFetchStrategy;
                    const targetUrl = this.articleReaderUrl(this.overlayArticle);
                    this.overlayRejectedStrategies = [...new Set([...this.overlayRejectedStrategies, rejected])];
                    this.overlayTryingMethod = true;
                    this.overlayMethodError = '';
                    const requestId = 'article-method-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
                    this.releaseArticleReaderSession();
                    this.overlayRequestId = requestId;
                    this.overlayProgress = { message: 'Rejecting this result and choosing the next reader method…' };
                    if (this.overlayProgressInterval) clearInterval(this.overlayProgressInterval);
                    const updateProgress = async () => {
                        try {
                            if (!this.articleOverlayOpen || this.overlayRequestId !== requestId) return;
                            const response = await fetch('/api/article-content-progress?' + new URLSearchParams({ id: requestId, url: targetUrl }));
                            if (!response.ok || this.overlayRequestId !== requestId) return;
                            this.overlayProgress = await response.json();
                        } catch (e) { }
                    };
                    this.overlayProgressInterval = setInterval(updateProgress, 400);
                    const exclude = [...new Set(this.overlayAttemptedStrategies)].join(',');
                    try {
                        const params = new URLSearchParams({
                            url: targetUrl,
                            requestId,
                            reject: rejected,
                            interactive: '1',
                            exclude,
                            title: this.overlayArticle.title || '',
                            description: String(this.overlayArticle.content || '').slice(0, 1200),
                            feedTitle: this.overlayArticle.feedTitle || '',
                            feedUrl: this.overlayArticle.feedUrl || '',
                            feedIcon: this.overlayArticle.feedIcon || ''
                        });
                        const response = await fetch('/api/article-content?' + params.toString());
                        const data = await response.json();
                        if (!this.articleOverlayOpen || this.overlayRequestId !== requestId) return;
                        this.overlayAttemptedStrategies = [...new Set([...this.overlayAttemptedStrategies, ...(data.attemptedStrategies || [])])];
                        if (!response.ok || data.error) throw new Error(data.error || 'No other reader method could load this article.');
                        this.applyOverlayArticleData(data, this.overlayArticle);
                    } catch (error) {
                        if (this.overlayRequestId === requestId) this.overlayMethodError = error.message;
                    } finally {
                        if (this.overlayRequestId === requestId) {
                            if (this.overlayProgressInterval) clearInterval(this.overlayProgressInterval);
                            this.overlayProgressInterval = null;
                            this.overlayTryingMethod = false;
                        }
                    }
                },

                captureArticleOverlay() {
                    const articleScroll = document.getElementById('overlay-scroll-container');
                    return {
                        overlayArticle: this.overlayArticle ? { ...this.overlayArticle } : null,
                        overlayContent: this.overlayContent,
                        overlayPagination: this.overlayPagination,
                        vozThreadNotice: this.vozThreadNotice,
                        overlayError: this.overlayError,
                        overlayRemainingAvailable: this.overlayRemainingAvailable,
                        overlayFetchStrategy: this.overlayFetchStrategy,
                        overlayFetchedFromCache: this.overlayFetchedFromCache,
                        overlayHasNativeAudio: this.overlayHasNativeAudio,
                        overlayMethodResults: { ...this.overlayMethodResults },
                        overlayAttemptedStrategies: [...this.overlayAttemptedStrategies],
                        overlayRejectedStrategies: [...this.overlayRejectedStrategies],
                        overlayMethodPreferences: { ...this.overlayMethodPreferences },
                        aiSummary: this.aiSummary,
                        aiSummaryLoading: this.aiSummaryLoading,
                        aiSummaryExpanded: this.aiSummaryExpanded,
                        aiSummaryError: this.aiSummaryError,
                        vozSummaryProgress: this.vozSummaryProgress,
                        currentPrefetchQueue: [...(this.currentPrefetchQueue || [])],
                        scrollTop: articleScroll?.scrollTop || 0
                    };
                },

                restoreArticleOverlay(snapshot, updateHistory = true) {
                    if (!snapshot?.overlayArticle) return;
                    this.overlayRequestId = '';
                    this.articleOverlayOpen = true;
                    this.isLoadingOverlay = false;
                    this.overlayArticle = { ...snapshot.overlayArticle };
                    this.overlayContent = this.formatSourceTimeMarkup(snapshot.overlayContent);
                    this.overlayPagination = snapshot.overlayPagination;
                    this.vozThreadNotice = snapshot.vozThreadNotice;
                    this.overlayError = snapshot.overlayError;
                    this.overlayRemainingAvailable = snapshot.overlayRemainingAvailable;
                    this.overlayFetchStrategy = snapshot.overlayFetchStrategy;
                    this.overlayFetchedFromCache = snapshot.overlayFetchedFromCache;
                    this.overlayHasNativeAudio = snapshot.overlayHasNativeAudio;
                    this.overlayMethodResults = { ...snapshot.overlayMethodResults };
                    this.overlayAttemptedStrategies = [...snapshot.overlayAttemptedStrategies];
                    this.overlayRejectedStrategies = [...snapshot.overlayRejectedStrategies];
                    this.overlayMethodPreferences = { ...snapshot.overlayMethodPreferences };
                    this.aiSummary = snapshot.aiSummary;
                    this.aiSummaryLoading = snapshot.aiSummaryLoading;
                    this.aiSummaryExpanded = snapshot.aiSummaryExpanded;
                    this.aiSummaryError = snapshot.aiSummaryError;
                    this.vozSummaryProgress = snapshot.vozSummaryProgress;
                    this.currentPrefetchQueue = [...snapshot.currentPrefetchQueue];
                    this.overlayProgress = { message: '' };
                    document.body.style.overflow = 'hidden';
                    if (updateHistory) this.updateArticleRoute(this.overlayArticle, true);
                    this.$nextTick(() => {
                        const articleScroll = document.getElementById('overlay-scroll-container');
                        this.hydrateTwitterEmbeds(articleScroll);
                        if (articleScroll) articleScroll.scrollTop = snapshot.scrollTop || 0;
                    });
                },

                async openRelatedArticle(article, event = null) {
                    if (event) {
                        event.preventDefault();
                        event.stopPropagation();
                    }
                    if (!article?.link && !article?.originalLink) return;
                    if (this.articleIdentity(article) === this.articleIdentity(this.overlayArticle)) return;
                    await this.openArticleOverlay(article, { stack: true });
                },

                releaseArticleReaderSession() {
                    if (!this.overlayRequestId) return;
                    fetch('/api/article-reader-session/close', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ requestId: this.overlayRequestId }), keepalive: true
                    }).catch(() => {});
                },

                async openArticleOverlay(article, options = {}) {
                    if (this.isRedditArticle(article)) {
                        window.open(this.articleReaderUrl(article), '_blank', 'noopener,noreferrer');
                        this.markAsReadExplicit(article.originalLink || article.link);
                        return;
                    }
                    this.releaseArticleReaderSession();
                    if (this.articlePdfState === 'preparing') this.cancelArticlePdf({ silent: true });
                    if (this.articlePdfResetTimer) clearTimeout(this.articlePdfResetTimer);
                    this.articlePdfResetTimer = null;
                    this.articlePdfState = 'idle';
                    this.articlePdfProgress = { current: 0, total: 0, message: '' };
                    this.hideTooltip();
                    const shouldStack = options.stack === true && this.articleOverlayOpen && this.overlayArticle;
                    if (shouldStack) this.articleOverlayStack.push(this.captureArticleOverlay());
                    else if (!this.articleOverlayOpen) this.articleOverlayStack = [];
                    if (options.updateHistory !== false) this.updateArticleRoute(article);
                    const requestId = 'article-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
                    let targetUrl = this.articleReaderUrl(article);
                    let resumePage = null;
                    const explicitPageNumber = this.vozThreadPageNumberFromUrl(targetUrl);
                    const hasExplicitPage = Number.isSafeInteger(explicitPageNumber) && explicitPageNumber > 0;
                    const isVoz = targetUrl.includes('voz.vn') || article.siteName === 'VOZ';
                    if (isVoz && !hasExplicitPage && !/\/post-\d+(?:[/?#]|$)/i.test(targetUrl)) {
                        const threadMatch = targetUrl.match(/threads\/[^\/.]+\.(\d+)/i) || targetUrl.match(/\b(\d{5,8})\b/);
                        const threadId = threadMatch ? threadMatch[1] : targetUrl;
                        const prefKey = 'voz_last_read_post_' + threadId;
                        const lastReadRaw = this.vozReadingPositionRaw(prefKey);
                        
                        let lastRead = null;
                        let lastReadAbsId = null;
                        if (lastReadRaw) {
                            if (lastReadRaw.startsWith('{')) {
                                try {
                                    const parsed = JSON.parse(lastReadRaw);
                                    lastRead = parsed.index;
                                    lastReadAbsId = parsed.absId;
                                    resumePage = Number(parsed.page) || (String(parsed.index) !== String(parsed.absId)
                                        ? Math.ceil(Number(parsed.index) / 20) : null);
                                } catch(e) {}
                            } else {
                                lastRead = lastReadRaw;
                            }
                        }

                        if (lastReadAbsId) {
                            // VOZ_DIRECT_SAVED_PAGE_V5
                            //
                            // page + absId are saved together. Load the known page
                            // directly so /post-ID redirect verification is not on
                            // the critical open path. absId is still used below by
                            // checkVozThreadPosition() for the exact in-page jump.
                            if (Number.isSafeInteger(resumePage) && resumePage > 0) {
                                // VOZ_CANONICAL_SAVED_PAGE_V6
                                //
                                // Last-read resume uses one stable page key.
                                // Do not let /unread become ?page=N here because
                                // the existing VOZ page cache/read-ahead commonly
                                // uses /page-N.
                                const baseThreadUrl = targetUrl
                                    .split(/[?#]/)[0]
                                    .replace(
                                        /\/(?:unread|latest|page-\d+|post-\d+)\/?$/i,
                                        ''
                                    )
                                    .replace(/\/+$/, '');

                                targetUrl = resumePage > 1
                                    ? baseThreadUrl + '/page-' + resumePage
                                    : baseThreadUrl;
                            } else {
                                const baseThreadUrl = targetUrl
                                    .split(/[?#]/)[0]
                                    .replace(/\/unread\/?(?:[?#].*)?$/i, '')
                                    .replace(/\/(?:page-\d+|post-\d+|unread|latest)\/?$/, '')
                                    .replace(/\/$/, '');

                                targetUrl =
                                    baseThreadUrl + '/post-' + lastReadAbsId;
                            }
                        } else if (lastRead && Number(lastRead) > 1) {
                            const targetPage = Number.isSafeInteger(resumePage) && resumePage > 0
                                ? resumePage : Math.ceil(Number(lastRead) / 20);
                            if (targetPage > 1) {
                                targetUrl = this.vozThreadPageUrlFrom(targetUrl, targetPage);
                            }
                        }
                    }
                    this.stopArticleSpeech();
                    this.articleOverlayOpen = true;
                    this.isLoadingOverlay = true;
                    this.vozInitialThreadLoad = !hasExplicitPage;
                    this.vozResumePending = this.vozInitialThreadLoad;
                    this.overlayContent = null;
                    this.overlayPagination = null;
                    this.overlayError = null;
                    this.overlayRemainingAvailable = false;
                    this.overlayFetchStrategy = '';
                    this.overlayFetchedFromCache = false;
                    this.overlayHasNativeAudio = false;
                    this.overlayMethodResults = {};
                    this.overlayAttemptedStrategies = [];
                    this.overlayRejectedStrategies = [];
                    this.overlayMethodPreferences = {};
                    this.overlayTryingMethod = false;
                    this.overlayMethodError = '';
                    this.setArticleCopyState('idle');
                    this.overlayRequestId = requestId;
                    this.overlayProgress = { message: 'Preparing article reader…' };
                    this.overlayArticle = { ...article };
                    if (this.cacheMember(article) && !isVoz) this.articleContentCache?.delete(this.articleReaderUrl(article)); // VOZ_KEEP_RAM_CACHE_V5
                    this.lastVozMeasureAt = 0;
                    this.lastTrackedVozPost = '';
                    const articleScroll = document.getElementById('overlay-scroll-container');
                    if (articleScroll) articleScroll.scrollTop = 0;
                    this.markAsReadExplicit(article.originalLink || article.link);
                    this.recordRecentlyRead(article.originalLink || article.link);
                    document.body.style.overflow = 'hidden';

                    // AI Summary: reset and fetch
                    this.aiSummary = null;
                    this.aiSummaryLoading = true;
                    this.aiSummaryExpanded = false;
                    this.aiSummaryError = null;
                    this.vozSummaryProgress = null;
                    if (this.aiSummaryPollTimer) clearInterval(this.aiSummaryPollTimer);
                    this.aiSummaryPollTimer = null;
                    if (this.isVozArticle(article) && article.vozSummary) {
                        this.aiSummary = article.vozSummary;
                        this.aiSummaryLoading = false;
                    } else {
                        this.aiSummary = { status: 'manual' }; // Default to manual state without checking cache
                    }

                    const sourceArray = this.displayedArticles || [];
                    const currentIndex = sourceArray.findIndex(a => (a.originalLink || a.link || a.id) === targetUrl || a.link === article.link);
                    
                    const prefetchTargets = [];
                    if (currentIndex !== -1) {
                        for (let i = currentIndex + 1; i < Math.min(sourceArray.length, currentIndex + 6); i++) {
                            const nextArticle = sourceArray[i];
                            if (this.isRedditArticle(nextArticle)) continue;
                            const u = this.articleReaderUrl(nextArticle);
                            if (u && u !== targetUrl) {
                                prefetchTargets.push({
                                    url: u,
                                    title: nextArticle?.title || '',
                                    description: String(nextArticle?.content || '').slice(0, 1200),
                                    feedTitle: nextArticle?.feedTitle || '',
                                    feedUrl: nextArticle?.feedUrl || '',
                                    feedIcon: nextArticle?.feedIcon || ''
                                });
                            }
                        }
                    }

                    if (isVoz) {
                        // Do not let unrelated article prefetch compete with
                        // the exact VOZ page the user is opening/resuming.
                        //
                        // applyOverlayArticleData() releases this only after
                        // the requested page is rendered, resume positioning
                        // has run, and the browser has painted it.
                        this.vozDeferredArticlePrefetch = {
                            requestId,
                            article
                        };
                    } else {
                        this.prefetchNextAfter(article);
                    }

                    const resumePostId = targetUrl.match(/\/post-(\d+)\/?$/)?.[1];
                    if (resumePostId && Number.isSafeInteger(resumePage) && resumePage > 0) {
                        // Prefer the saved page over a publisher post redirect,
                        // but only display it if the permanent post ID is present.
                        const hintedUrl = this.vozThreadPageUrlFrom(targetUrl, resumePage);
                        try {
                            const hinted = await this.fetchThreadPage(hintedUrl, article.feedUrl || '');
                            if (!this.articleOverlayOpen || this.overlayRequestId !== requestId) return;
                            if (new RegExp('data-absolute-post-id=["\x27]' + resumePostId + '["\x27]').test(hinted.content || '')) targetUrl = hintedUrl;
                        } catch { /* A moved post or failed hint falls back to its permanent redirect. */ }
                        if (!this.articleOverlayOpen || this.overlayRequestId !== requestId) return;
                    }

                    if (this.isMismatchedThreadPage(targetUrl, this.articleContentCache?.get(targetUrl))) {
                        this.articleContentCache.delete(targetUrl);
                    }
                    if (this.articleContentCache && this.articleContentCache.has(targetUrl)) {
                        const cachedData = this.articleContentCache.get(targetUrl);
                        cachedData.cached = true; // Frontend cache hit counts as cached
                        if (this.overlayRequestId !== requestId || !this.articleOverlayOpen) return;
                        
                        this.currentPrefetchQueue = prefetchTargets.map(target => ({ 
                            url: target.url,
                            isCached: this.articleContentCache.has(target.url)
                        }));
                        
                        this.applyOverlayArticleData(cachedData, article);
                        this.isLoadingOverlay = false;
                        return;
                    }

                    if (this.overlayProgressInterval) clearInterval(this.overlayProgressInterval);
                    const updateProgress = async () => {
                        try {
                            if (!this.articleOverlayOpen || this.overlayRequestId !== requestId) return;
                            const progressResponse = await fetch('/api/article-content-progress?' + new URLSearchParams({ id: requestId, url: targetUrl }));
                            if (!progressResponse.ok || this.overlayRequestId !== requestId) return;
                            const progress = await progressResponse.json();
                            this.overlayProgress = progress;
                        } catch (e) { }
                    };
                    this.overlayProgressInterval = setInterval(updateProgress, 400);

                    try {
                        const params = new URLSearchParams({
                            url: targetUrl,
                            requestId,
                            interactive: '1',
                            title: article.title || '',
                            description: String(article.content || '').slice(0, 1200),
                            feedTitle: article.feedTitle || '',
                            feedUrl: article.feedUrl || '',
                            feedIcon: article.feedIcon || ''
                        });
                        if (isVoz) params.set('threadPage', '1');
                        if (resumePage > 0) params.set('resumePage', String(resumePage));
                        if (prefetchTargets.length > 0) {
                            params.set('prefetchTargets', JSON.stringify(prefetchTargets));
                        }
                        const res = await fetch('/api/article-content?' + params.toString());
                        if (this.overlayRequestId !== requestId || !this.articleOverlayOpen) return;
                        if (res.ok) {
                            const data = await res.json();
                            if (this.overlayRequestId !== requestId || !this.articleOverlayOpen) return;
                            if (data.error) {
                                this.overlayError = data.error;
                                this.overlayRemainingAvailable = data.remainingAvailable === true;
                            } else {
                                this.currentPrefetchQueue = data.prefetchQueue || [];
                                this.applyOverlayArticleData(data, article);
                            }
                        } else {
                            this.overlayError = 'Failed to load article content.';
                        }
                    } catch (e) {
                        if (this.overlayRequestId === requestId) this.overlayError = 'Network error: ' + e.message;
                    } finally {
                        if (this.overlayRequestId === requestId) {
                            if (this.overlayProgressInterval) clearInterval(this.overlayProgressInterval);
                            this.overlayProgressInterval = null;
                            this.isLoadingOverlay = false;
                        }
                    }
                },

                handleArticleClick(e) {
                    if (this.toggleSourceTime(e)) return;
                    const relatedLink = e.target.closest('.embedded-suggested-card a, a.styled-rel-card, a.tuoitre-event-stream__item-link');
                    if (relatedLink?.href) {
                        const matched = this.findArticleByRouteUrl(relatedLink.href);
                        this.openRelatedArticle(matched || {
                            link: relatedLink.href,
                            originalLink: relatedLink.href,
                            title: relatedLink.textContent?.trim() || ''
                        }, e);
                        return;
                    }
                    const spoiler = e.target.closest('.bbCodeBlock--spoiler');
                    if (spoiler) {
                        spoiler.classList.toggle('revealed');
                    }
                    const unfurl = e.target.closest('.bbCodeBlock--unfurl, .fauxBlockLink');
                    if (unfurl) {
                        const link = unfurl.getAttribute('data-url') || unfurl.querySelector('a')?.href;
                        if (link) {
                            e.preventDefault();
                            e.stopPropagation();
                            window.open(link, '_blank', 'noopener,noreferrer');
                        }
                    }
                },
            
            closeArticleOverlay(options = {}) {
                    // VOZ_FLUSH_POSITION_ON_CLOSE_V5
                    if (
                        Object.keys(this.pendingPreferences || {}).some(
                            key => key.startsWith('voz_last_read_post_')
                        )
                    ) {
                        this.flushUserPreferences().catch(() => {});
                    }

                    this.releaseArticleReaderSession();
                    const closeOptions = options && options.constructor === Object ? options : {};
                    if (this.articlePdfState === 'preparing') this.cancelArticlePdf({ silent: true });
                    this.stopArticleSpeech();
                    if (this.vozScrollRaf) cancelAnimationFrame(this.vozScrollRaf);
                    this.vozScrollRaf = 0;
                    this.lastVozMeasureAt = 0;
                    this.lastTrackedVozPost = '';
                    if (this.overlayProgressInterval) clearInterval(this.overlayProgressInterval);
                    this.overlayProgressInterval = null;
                    if (this.vozPollingInterval) clearInterval(this.vozPollingInterval);
                    this.vozPollingInterval = null;
                    this.overlayRequestId = '';
                    if (this.articleOverlayStack.length > 0 && closeOptions.closeAll !== true) {
                        const previous = this.articleOverlayStack.pop();
                        this.restoreArticleOverlay(previous, closeOptions.updateHistory !== false);
                        return;
                    }
                    this.articleOverlayOpen = false;
                    this.overlayContent = null;
                    this.overlayPagination = null;
                    this.overlayError = null;
                    this.overlayFetchStrategy = '';
                    this.overlayFetchedFromCache = false;
                    this.overlayHasNativeAudio = false;
                    this.overlayMethodResults = {};
                    this.overlayAttemptedStrategies = [];
                    this.overlayRejectedStrategies = [];
                    this.overlayMethodPreferences = {};
                    this.overlayTryingMethod = false;
                    this.overlayMethodError = '';
                    this.setArticleCopyState('idle');
                    this.overlayProgress = { message: '' };
                    this.overlayArticle = null;
                    this.isLoadingOverlay = false;
                    // AI Summary cleanup
                    this.aiSummary = null;
                    this.aiSummaryLoading = false;
                    this.aiSummaryExpanded = false;
                    this.aiSummaryError = null;
                    this.vozSummaryProgress = null;
                    if (this.aiSummaryPollTimer) clearInterval(this.aiSummaryPollTimer);
                    this.aiSummaryPollTimer = null;
                    // Let Voz Summary run in background
                    // No need to cancel, but we could clear the poll timer if we want
                    if (this.vozSummaryPollTimer) clearInterval(this.vozSummaryPollTimer);
                    document.body.style.overflow = '';
                    this.articleOverlayStack = [];
                    if (closeOptions.updateHistory !== false) this.clearArticleRoute(true);
                },
        };
    }
};
