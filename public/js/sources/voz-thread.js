// Owns sources / voz-thread on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderSourcesVozThread = {
    create() {
        return {
                vozScrollRaf: 0,
                lastVozMeasureAt: 0,
                lastTrackedVozPost: '',

                checkVozThreadPosition() {
                    this.vozThreadNotice = null;
                    if (!this.overlayArticle) return;
                    const url = this.overlayArticle.resolvedLink || this.overlayArticle.link || '';
                    const isVoz = url.includes('voz.vn') || this.overlayArticle.siteName === 'VOZ';
                    if (!isVoz) return;
                    const threadMatch = url.match(/threads\/[^\/.]+\.(\d+)/i) || url.match(/\b(\d{5,8})\b/);
                    const threadId = threadMatch ? threadMatch[1] : url;
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
                            } catch(e) {}
                        } else {
                            lastRead = lastReadRaw;
                        }
                    }
                    
                    if (this.vozPollingInterval) {
                        clearInterval(this.vozPollingInterval);
                        this.vozPollingInterval = null;
                    }

                    if (!(lastRead && Number(lastRead) > 1 && this.vozInitialThreadLoad)) this.vozResumePending = false;
                    if (lastRead && Number(lastRead) > 1 && this.vozInitialThreadLoad) {
                        const requestId = this.overlayRequestId;
                        let attempts = 0;
                        const checkAndScroll = () => {
                            if (!this.articleOverlayOpen || this.overlayRequestId !== requestId) return;
                            const postEl = lastReadAbsId ? Array.from(document.querySelectorAll('.voz-post[data-absolute-post-id]')).find(el => el.getAttribute('data-absolute-post-id') === String(lastReadAbsId)) : document.getElementById('voz-post-' + lastRead);
                            if (postEl && postEl.offsetParent !== null) {
                                setTimeout(() => { if (this.overlayRequestId === requestId) this.vozResumePending = false; }, 50); // VOZ_RESUME_TRACKING_50MS_V5
                                lastRead = postEl.getAttribute('data-post-index') || lastRead;
                                const existingNotice = document.getElementById('voz-inline-notice');
                                if (existingNotice) existingNotice.remove();
                                
                                const inlineNotice = document.createElement('div');
                                inlineNotice.id = 'voz-inline-notice';
                                inlineNotice.className = `mb-3 px-4 py-2.5 rounded-2xl border flex justify-between items-center text-sm font-medium shadow-sm transition ${this.theme === 'glass-light' ? 'bg-blue-500/10 text-blue-700 border-blue-500/20' : 'bg-blue-500/10 text-blue-300 border-blue-500/20'}`;
                                inlineNotice.innerHTML = `<span>📍 Bạn đã quay lại đúng vị trí bài viết #${lastRead} mà bạn đang đọc lần trước!</span><button class="hover:opacity-80 ml-4 font-bold text-lg transition ${this.theme === 'glass-light' ? 'text-blue-600' : 'text-blue-400'}" onclick="this.parentElement.style.opacity='0'; setTimeout(()=>this.parentElement.remove(), 200)" title="Đóng">&times;</button>`;
                                postEl.parentElement.insertBefore(inlineNotice, postEl);
                                
                                inlineNotice.scrollIntoView({ behavior: 'auto', block: 'center' });
                            } else if (attempts < 6 /* VOZ_FAST_RESUME_DOM_V5 */) {
                                attempts++;
                                setTimeout(checkAndScroll, 50); // max ~300ms after nextTick
                            } else {
                                this.vozResumePending = false;
                                const targetPage = Math.ceil(Number(lastRead) / 20);
                                const currentPage = this.overlayPagination ? this.overlayPagination.currentPage : 1;
                                if (targetPage !== currentPage && this.overlayPagination?.pages?.some(p => p.page === targetPage)) {
                                    const pageObj = this.overlayPagination.pages.find(p => p.page === targetPage);
                                    this.vozThreadNotice = {
                                        text: `📍 Lần trước bạn đang đọc bài #${lastRead} (Trang ${targetPage}).`,
                                        actionText: `Chuyển sang Trang ${targetPage} →`,
                                        action: () => this.navigateToThreadPage(pageObj.url, true)
                                    };
                                } else {
                                    // Post not found and no matching page in pagination — construct page URL
                                    const targetPage = Math.ceil(Number(lastRead) / 20);
                                    const currentPage = this.overlayPagination ? this.overlayPagination.currentPage : 1;
                                    if (targetPage > 1 && targetPage !== currentPage) {
                                        // Build the target page URL from the thread URL
                                        const baseThreadUrl = this.overlayArticle.originalLink || this.overlayArticle.link || url;
                                        const targetPageUrl = lastReadAbsId
                                            ? this.vozThreadPageUrlFrom(baseThreadUrl, 1).replace(/\/$/, '') + '/post-' + lastReadAbsId
                                            : this.vozThreadPageUrlFrom(baseThreadUrl, targetPage);
                                        this.vozThreadNotice = {
                                            text: `📍 Lần trước bạn đã đọc đến bài #${lastRead}.`,
                                            actionText: 'Tới bài',
                                            action: () => this.navigateToThreadPage(targetPageUrl, true)
                                        };
                                    } else {
                                        // Same page — exact post not found (likely deleted), scroll to closest automatically
                                        let closest = null;
                                        let minDiff = Infinity;
                                        document.querySelectorAll('[id^="voz-post-"]').forEach(el => {
                                            const num = parseInt(el.id.replace('voz-post-', ''));
                                            if (!isNaN(num)) {
                                                const diff = Math.abs(num - Number(lastRead));
                                                if (diff < minDiff) { minDiff = diff; closest = el; }
                                            }
                                        });
                                        if (closest) {
                                            const closestId = closest.id.replace('voz-post-', '');
                                            const existingNotice = document.getElementById('voz-inline-notice');
                                            if (existingNotice) existingNotice.remove();
                                            const inlineNotice = document.createElement('div');
                                            inlineNotice.id = 'voz-inline-notice';
                                            inlineNotice.className = `mb-3 px-4 py-2.5 rounded-2xl border flex justify-between items-center text-sm font-medium shadow-sm transition ${this.theme === 'glass-light' ? 'bg-orange-500/10 text-orange-700 border-orange-500/20' : 'bg-orange-500/10 text-orange-300 border-orange-500/20'}`;
                                            inlineNotice.innerHTML = `<span>📍 Bài #${lastRead} không tìm thấy, nhảy đến bài #${closestId}!</span><button class="hover:opacity-80 ml-4 font-bold text-lg transition text-orange-500" onclick="this.parentElement.style.opacity='0'; setTimeout(()=>this.parentElement.remove(), 200)" title="Đóng">&times;</button>`;
                                            closest.parentElement.insertBefore(inlineNotice, closest);
                                            closest.scrollIntoView({ behavior: 'auto', block: 'center' });
                                        }
                                    }
                                }
                            }
                        };
                        checkAndScroll();
                    }
                },

                vozResumePending: false,
                trackVozThreadScroll(event) {
                    if (this.vozResumePending) return;
                    if (!this.overlayArticle || !this.articleOverlayOpen) return;
                    const url = this.overlayArticle.link || '';
                    if (!url.includes('voz.vn') && this.overlayArticle.siteName !== 'VOZ') return;
                    const container = event.currentTarget || event.target;
                    if (!container || this.vozScrollRaf) return;
                    this.vozScrollRaf = requestAnimationFrame(() => {
                        this.vozScrollRaf = 0;
                        if (!this.overlayArticle || !this.articleOverlayOpen) return;
                        const now = performance.now();
                        if (now - this.lastVozMeasureAt < 120) return;
                        this.lastVozMeasureAt = now;
                        const posts = Array.from(container.querySelectorAll('.voz-post[data-post-index]'));
                        if (!posts.length) return;
                        const containerRect = container.getBoundingClientRect();
                        let topPost = posts[0];
                        for (const post of posts) {
                            if (post.getBoundingClientRect().top >= containerRect.top - 50) {
                                topPost = post;
                                break;
                            }
                        }
                        const index = topPost.getAttribute('data-post-index');
                        const absId = topPost.getAttribute('data-absolute-post-id');
                        if (!index || index === this.lastTrackedVozPost) return;
                        this.lastTrackedVozPost = index;
                        const currentUrl = this.overlayArticle.link || '';
                        const threadMatch = currentUrl.match(/threads\/[^\/.]+\.(\d+)/i) || currentUrl.match(/\b(\d{5,8})\b/);
                        const threadId = threadMatch ? threadMatch[1] : currentUrl;
                        
                        const saveData = absId ? JSON.stringify({ index, absId, page: this.overlayPagination?.currentPage || Math.ceil(Number(index) / 20) }) : index;
                        this.syncUserPreferenceDebounced('voz_last_read_post_' + threadId, saveData);
                    });
                },

                vozReadingPositionRaw(prefKey) {
                    let local;
                    try { local = localStorage.getItem(prefKey); } catch (_) {}
                    const originalLocal = local;
                    const shared = this.userPreferences[prefKey];
                    const parse = raw => {
                        try { return typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : null; } catch (_) { return null; }
                    };
                    const sharedPosition = parse(shared);
                    const sharedPage = Number(sharedPosition?.page);
                    // Upgrade legacy plain-number records to the shared record
                    // that stores a page and permanent ID together. Structured
                    // device positions continue to take precedence.
                    if (local && !parse(local) && sharedPosition?.absId
                        && Number.isSafeInteger(sharedPage) && sharedPage > 0) local = shared;
                    let raw = local || shared;
                    const position = parse(raw);
                    if (position?.absId && String(position.index) === String(position.absId)) {
                        const page = Number(position.page);
                        const derivedPage = Math.ceil(Number(position.index) / 20);
                        if (Number.isSafeInteger(page) && page > 0 && page !== derivedPage) {
                            // Keep the permanent ID for the exact in-page jump.
                            position.index = String((page - 1) * 20 + 1);
                        } else {
                            // The old page was calculated from a global ID;
                            // resume through the permanent post redirect instead.
                            delete position.page;
                        }
                        raw = JSON.stringify(position);
                    }
                    if (raw && raw !== originalLocal) {
                        try { localStorage.setItem(prefKey, raw); } catch (_) {}
                    }
                    return raw;
                },

                vozThreadPageNumberFromUrl(url = '') {
                    try {
                        const parsed = new URL(String(url || ''), window.location.origin);
                        const queryPage = Number.parseInt(parsed.searchParams.get('page'), 10);
                        if (Number.isSafeInteger(queryPage) && queryPage > 0) return queryPage;
                        const match = parsed.pathname.match(/\/page-(\d+)\/?$/i);
                        if (match) {
                            const page = Number.parseInt(match[1], 10);
                            if (Number.isSafeInteger(page) && page > 0) return page;
                        }
                    } catch (_) {}
                    return null;
                },

                vozThreadPageUrlFrom(url = '', page = 1) {
                    const pageNumber = Number.parseInt(page, 10);
                    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) return String(url || '');
                    try {
                        const parsed = new URL(String(url || ''), window.location.origin);
                        const hadQueryPage = parsed.searchParams.has('page');
                        const preferQuery = hadQueryPage;
                        parsed.hash = '';
                        parsed.pathname = parsed.pathname
                            .replace(/\/(?:unread|latest|page-\d+|post-\d+)\/?$/i, '')
                            .replace(/\/+$/, '');
                        parsed.searchParams.delete('page');
                        if (pageNumber > 1) {
                            if (preferQuery) {
                                if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
                                parsed.searchParams.set('page', String(pageNumber));
                            } else {
                                parsed.pathname += '/page-' + pageNumber;
                            }
                        }
                        return parsed.href;
                    } catch (_) {
                        const raw = String(url || '');
                        const queryStyle = /[?&]page=\d+/i.test(raw);
                        const base = raw
                            .replace(/#.*$/, '')
                            .replace(/([?&])page=\d+(&?)/i, (m, lead, tail) => lead === '?' && tail ? '?' : tail ? lead : '')
                            .replace(/[?&]$/, '')
                            .replace(/\/(?:unread|latest|page-\d+|post-\d+)\/?$/i, '')
                            .replace(/\/+$/, '');
                        if (pageNumber <= 1) return base;
                        return queryStyle
                            ? base + (base.includes('?') ? '&' : '?') + 'page=' + pageNumber
                            : base + '/page-' + pageNumber;
                    }
                },

                alignVozPaginationForCurrentView(livePagination, currentUrl, currentPage, nextUrl) {
                    const current = Number(currentPage) || this.vozThreadPageNumberFromUrl(currentUrl) || 1;
                    const known = new Map();
                    // A fresh view of this page replaces stale page links. Keep
                    // only a continuation independently verified in this view.
                    const replacesCurrent = Number(livePagination?.currentPage) === current;
                    const verified = this.vozVerifiedContinuation;
                    const verifiedNextUrl = verified?.requestId === this.overlayRequestId
                        && verified.currentPage === current ? verified.url : null;
                    nextUrl = nextUrl || verifiedNextUrl;
                    const existingPages = !replacesCurrent && Array.isArray(this.overlayPagination?.pages) ? this.overlayPagination.pages : [];
                    const livePages = Array.isArray(livePagination?.pages) ? livePagination.pages : [];
                    for (const entry of [...existingPages, ...livePages]) {
                        const page = Number(entry?.page);
                        if (!Number.isSafeInteger(page) || page < 1) continue;
                        known.set(page, {
                            ...entry,
                            page,
                            url: entry?.url || this.vozThreadPageUrlFrom(currentUrl, page),
                            isCurrent: page === current
                        });
                    }
                    if (!known.has(current)) {
                        known.set(current, {
                            page: current,
                            url: this.vozThreadPageUrlFrom(currentUrl, current),
                            isCurrent: true
                        });
                    }
                    const nextPage = current + 1;
                    if (nextUrl && !known.has(nextPage)) {
                        known.set(nextPage, { page: nextPage, url: nextUrl, isCurrent: false });
                    }
                    return {
                        ...(this.overlayPagination || {}),
                        ...(livePagination || {}),
                        currentPage: current,
                        pages: [...known.values()].sort((a, b) => a.page - b.page)
                            .map(entry => ({ ...entry, isCurrent: entry.page === current })),
                        prevUrl: current > 1
                            ? (known.get(current - 1)?.url || livePagination?.prevUrl || this.vozThreadPageUrlFrom(currentUrl, current - 1))
                            : null,
                        nextUrl: nextUrl || known.get(nextPage)?.url || livePagination?.nextUrl || null
                    };
                },

                async probeVozLiveContinuationFromTail(url, feedUrl = '') {
                    if (!this.articleOverlayOpen || !this.overlayArticle || this.overlayArticle.sourceDeleted) return null;

                    const requestId = this.overlayRequestId;
                    const currentPage = Number(this.overlayPagination?.currentPage)
                        || this.vozThreadPageNumberFromUrl(url)
                        || 1;
                    const nextUrl = this.vozThreadPageUrlFrom(url, currentPage + 1);
                    if (!nextUrl || nextUrl === url) return null;

                    if (!this.vozTailProbeRequests) this.vozTailProbeRequests = new Map();
                    const baseKey = this.vozThreadPageUrlFrom(url, 1);
                    const key = `${baseKey}|${currentPage + 1}`;
                    if (this.vozTailProbeRequests.has(key)) return this.vozTailProbeRequests.get(key);

                    const request = (async () => {
                        try {
                            console.log(
                                `[VOZ FRONTIER] P0 probe live page ${currentPage + 1} while reading page ${currentPage}: ${nextUrl}`
                            );

                            // liveContinuation=true MUST bypass both frontend and
                            // server caches. This request is the authoritative
                            // "does page N+1 exist live now?" probe.
                            const data = await this.fetchThreadPage(nextUrl, feedUrl, false, true);

                            if (!this.articleOverlayOpen || this.overlayRequestId !== requestId) return null;

                            const returnedPage = Number(data?.pagination?.currentPage);
                            const postIds = content => [...String(content || '').matchAll(/data-absolute-post-id=["'](\d+)["']/g)].map(match => match[1]);
                            const currentIds = new Set(postIds(this.overlayContent));
                            const nextIds = postIds(data?.content);
                            const hasNewPosts = currentIds.size > 0 && nextIds.some(id => !currentIds.has(id));

                            if (!data?.content || returnedPage !== currentPage + 1 || !hasNewPosts) {
                                this.articleContentCache?.delete(nextUrl);
                                console.log(
                                    `[VOZ FRONTIER] No live continuation beyond page ${currentPage}`
                                );
                                return null;
                            }

                            console.log(
                                `[VOZ FRONTIER] Live continuation found: page ${currentPage} -> ${returnedPage}`
                            );

                            this.vozVerifiedContinuation = { requestId, currentPage, url: nextUrl };

                            this.overlayPagination = this.alignVozPaginationForCurrentView(
                                data.pagination,
                                url,
                                currentPage,
                                nextUrl
                            );

                            const currentKeys = [
                                url,
                                this.vozThreadPageUrlFrom(url, currentPage)
                            ];
                            for (const keyUrl of currentKeys) {
                                const currentCached = this.articleContentCache?.get(keyUrl);
                                if (currentCached) currentCached.pagination = this.overlayPagination;
                            }

                            // Page N+1 is already warm from the P0 probe. Normal
                            // two-logical-page read-ahead can therefore consume
                            // that in-memory page and fetch N+2 at P1 without
                            // re-fetching N+1 live.
                            this.prefetchThreadPages(
                                { ...this.overlayPagination, nextUrl },
                                feedUrl,
                                false
                            );

                            return data;
                        } catch (error) {
                            console.warn(
                                `[VOZ FRONTIER] Live page ${currentPage + 1} probe failed: ${error?.message || error}`
                            );
                            return null;
                        }
                    })().finally(() => this.vozTailProbeRequests?.delete(key));

                    this.vozTailProbeRequests.set(key, request);
                    return request;
                },

                async checkVozNewPostsInBackground(url, feedUrl = '') {
                    const requestId = this.overlayRequestId;
                    const currentPageNum = Number(this.overlayPagination?.currentPage)
                        || this.vozThreadPageNumberFromUrl(url)
                        || 1;
                    const currentLiveUrl = this.vozThreadPageUrlFrom(url, currentPageNum);

                    // Start N+1 immediately. Do not wait for the current-page
                    // refresh: a 524/slow page N must never hide a live page N+1.
                    const nextProbe = Promise.resolve(
                        this.probeVozLiveContinuationFromTail(currentLiveUrl, feedUrl)
                    );

                    const currentRefresh = (async () => {
                        try {
                            const freshData = await this.fetchThreadPage(
                                currentLiveUrl,
                                feedUrl,
                                false,
                                true
                            );

                            if (!freshData || freshData.error) return null;

                            // Never let a background refresh for an old article
                            // write into the newly opened article.
                            if (!this.articleOverlayOpen || this.overlayRequestId !== requestId) return null;

                            const activeUrl =
                                this.overlayArticle?.resolvedLink
                                || this.overlayArticle?.link
                                || this.overlayArticle?.originalLink
                                || '';

                            const activeBase = this.vozThreadPageUrlFrom(activeUrl, 1);
                            const requestedBase = this.vozThreadPageUrlFrom(url, 1);
                            if (activeBase !== requestedBase) return null;

                            const renderedContainer = document.querySelector(
                                '#overlay-scroll-container .article-rendered-content'
                            );
                            const freshPostsCount = (
                                freshData.content?.match(/class=["'][^"']*voz-post[^"']*["']/gi)
                                || []
                            ).length;
                            const freshPageNum = Number(freshData.pagination?.currentPage)
                                || this.vozThreadPageNumberFromUrl(freshData.url || currentLiveUrl)
                                || 1;

                            // Never splice posts from another VOZ page into the
                            // page currently being read.
                            if (freshPageNum !== currentPageNum) return null;

                            if (freshPostsCount > 0) {
                                const parser = new DOMParser();
                                const doc = parser.parseFromString(freshData.content, 'text/html');
                                this.updateSourceTimes(doc);
                                const freshPosts = Array.from(doc.querySelectorAll('.voz-post'));
                                let contentUpdated = false;

                                if (renderedContainer && this.overlayRequestId === requestId) {
                                    const currentPosts = Array.from(
                                        renderedContainer.querySelectorAll('.voz-post')
                                    );
                                    const postId = node =>
                                        node.getAttribute('data-absolute-post-id')
                                        || node.id
                                        || '';
                                    const freshById = new Map(
                                        freshPosts
                                            .map(node => [postId(node), node])
                                            .filter(([id]) => id)
                                    );
                                    const freshIds = new Set(freshById.keys());
                                    const currentById = new Map(
                                        currentPosts
                                            .map(node => [postId(node), node])
                                            .filter(([id]) => id)
                                    );
                                    const currentIds = currentPosts.map(postId);
                                    const preserveCachedBodies =
                                        this.boardFolderFor(this.overlayArticle) === 'cache';
                                    const after = new Map();
                                    const leading = [];

                                    // Cache-board only: posts that disappeared
                                    // live remain historical overlays at their
                                    // original sequence location. Normal VOZ
                                    // threads follow the live page exactly.
                                    if (preserveCachedBodies) {
                                        for (let i = 0; i < currentPosts.length; i++) {
                                            const id = currentIds[i];
                                            if (!id || freshIds.has(id)) continue;

                                            let previousLive = '';
                                            for (let j = i - 1; j >= 0; j--) {
                                                if (freshIds.has(currentIds[j])) {
                                                    previousLive = currentIds[j];
                                                    break;
                                                }
                                            }

                                            const node = currentPosts[i].cloneNode(true);
                                            if (previousLive) {
                                                if (!after.has(previousLive)) after.set(previousLive, []);
                                                after.get(previousLive).push(node);
                                            } else {
                                                leading.push(node);
                                            }
                                        }
                                    }

                                    const fragment = document.createDocumentFragment();
                                    leading.forEach(node => fragment.appendChild(node));

                                    freshPosts.forEach(freshPost => {
                                        const id = postId(freshPost);
                                        const sourceNode =
                                            preserveCachedBodies && currentById.has(id)
                                                ? currentById.get(id)
                                                : freshPost;

                                        fragment.appendChild(sourceNode.cloneNode(true));
                                        (after.get(id) || []).forEach(node =>
                                            fragment.appendChild(node)
                                        );
                                    });

                                    const beforeHtml = renderedContainer.innerHTML;
                                    renderedContainer.replaceChildren(fragment);
                                    contentUpdated = beforeHtml !== renderedContainer.innerHTML;
                                    this.overlayContent = renderedContainer.innerHTML;

                                    this.overlayPagination =
                                        this.alignVozPaginationForCurrentView(
                                            freshData.pagination,
                                            currentLiveUrl,
                                            currentPageNum,
                                            freshData.pagination?.nextUrl || null
                                        );

                                    this.hydrateTwitterEmbeds(renderedContainer);

                                    const cacheKeys = [
                                        url,
                                        currentLiveUrl,
                                        freshData.url
                                    ].filter(Boolean);

                                    for (const cacheUrl of new Set(cacheKeys)) {
                                        const cached = this.articleContentCache?.get(cacheUrl);
                                        if (cached) {
                                            cached.content = this.overlayContent;
                                            cached.pagination = this.overlayPagination;
                                        }
                                    }
                                }

                                if (
                                    this.overlayPagination?.nextUrl
                                    && this.overlayRequestId === requestId
                                ) {
                                    this.prefetchThreadPages(
                                        this.overlayPagination,
                                        this.overlayArticle.feedUrl || '',
                                        false
                                    );
                                }

                                if (contentUpdated && (freshData.url || currentLiveUrl)) {
                                    const cacheKey =
                                        'article_cache_v26_' + (freshData.url || currentLiveUrl);
                                    try {
                                        localStorage.setItem(
                                            cacheKey,
                                            JSON.stringify({
                                                data: {
                                                    ...freshData,
                                                    content: this.overlayContent,
                                                    pagination: this.overlayPagination
                                                },
                                                timestamp: Date.now()
                                            })
                                        );
                                    } catch(e) {}
                                }
                            }

                            return freshData;
                        } catch (error) {
                            console.warn(
                                `[VOZ FRONTIER] Current-page live refresh failed for page ${currentPageNum}: ${error?.message || error}`
                            );
                            return null;
                        }
                    })();

                    const results = await Promise.allSettled([
                        currentRefresh,
                        nextProbe
                    ]);

                    return results;
                },

                isMismatchedThreadPage(targetUrl, data) {
                    if (!this.isVozArticle({ link: targetUrl })) return false;
                    const requestedPage = this.vozThreadPageNumberFromUrl(targetUrl)
                        || (/\/t\/[^/?#]+\/?(?:[?#].*)?$/.test(String(targetUrl)) ? 1 : null);
                    const returnedPage = Number(data?.pagination?.currentPage);
                    return requestedPage !== null && Number.isSafeInteger(returnedPage)
                        && returnedPage > 0 && returnedPage !== requestedPage;
                },

                fetchThreadPage(targetUrl, feedUrl = '', prefetch = false, liveContinuation = false) {
                    if (!this.articleContentCache) this.articleContentCache = new Map();
                    const cached = this.articleContentCache.get(targetUrl);
                    const mismatchedCache = this.isMismatchedThreadPage(targetUrl, cached);
                    if (mismatchedCache) this.articleContentCache.delete(targetUrl);

                    // Normal navigation/read-ahead is cache-first. A live frontier
                    // probe is the opposite: it MUST bypass the in-memory page too,
                    // otherwise a stale cached last page can masquerade as live.
                    if (cached && !mismatchedCache && !liveContinuation) return Promise.resolve(cached);

                    if (!this.threadPageRequests) this.threadPageRequests = new Map();
                    const requestKey = liveContinuation ? `live:${targetUrl}` : targetUrl;
                    if (this.threadPageRequests.has(requestKey)) return this.threadPageRequests.get(requestKey);

                    const request = (async () => {
                        const params = new URLSearchParams({
                            url: targetUrl,
                            feedUrl,
                            threadPage: '1'
                        });

                        // liveContinuation is P0 interactive frontier work.
                        // Do not mark it as ordinary P1/P2 prefetch.
                        if (prefetch && !liveContinuation) params.set('prefetch', '1');
                        if (mismatchedCache) params.set('bypassCache', 'true');

                        if (liveContinuation) {
                            params.set('bypassCache', 'true');
                            params.set('bypassBoardCache', '1');
                            params.set('frontier', '1');
                        }

                        const controller = liveContinuation ? new AbortController() : null;
                        const timeout = controller
                            ? setTimeout(() => controller.abort(), 35_000)
                            : null;

                        try {
                            const res = await fetch(
                                '/api/article-content?' + params.toString(),
                                controller ? { signal: controller.signal } : undefined
                            );
                            const data = await res.json();

                            if (liveContinuation && data?.liveRefreshFailed) {
                                throw new Error(
                                    data.liveRefreshError
                                    || 'Live VOZ refresh failed; stale cache was returned'
                                );
                            }

                            if (!res.ok || data.error || !data.content) {
                                throw new Error(
                                    data.error || 'Trang không tồn tại hoặc lỗi tải'
                                );
                            }
                            if (this.isMismatchedThreadPage(targetUrl, data)) {
                                throw new Error(`The source returned page ${data.pagination.currentPage} instead of the requested page. Please try again.`);
                            }

                            this.articleContentCache.set(targetUrl, data);
                            if (this.articleContentCache.size > 60) {
                                this.articleContentCache.delete(
                                    this.articleContentCache.keys().next().value
                                );
                            }

                            return data;
                        } finally {
                            if (timeout) clearTimeout(timeout);
                        }
                    })();

                    this.threadPageRequests.set(requestKey, request);
                    request.finally(() => this.threadPageRequests.delete(requestKey)).catch(() => {});
                    return request;
                },

                async prefetchThreadPages(pagination, feedUrl = '', liveContinuation = false) {
                    const requestId = this.overlayRequestId;
                    let nextUrl = pagination?.nextUrl;
                    // Read ahead directly instead of waiting behind the article queue.
                    // A click joins this same promise, including while the fetch is running.
                    for (let depth = 0; depth < 2 && nextUrl; depth++) {
                        if (!this.articleOverlayOpen || this.overlayRequestId !== requestId) return;
                        try {
                            const data = await this.fetchThreadPage(nextUrl, feedUrl, true, liveContinuation);
                            nextUrl = data.pagination?.nextUrl;
                        } catch { return; }
                    }
                },

                compactVozPaginationPages() {
                    const pages = Array.isArray(this.overlayPagination?.pages)
                        ? this.overlayPagination.pages
                        : [];

                    if (!pages.length) return [];

                    const normalized = pages
                        .map(p => ({
                            ...p,
                            page: Number(p.page),
                            type: 'page',
                            key: `page-${p.page}`
                        }))
                        .filter(p => Number.isFinite(p.page))
                        .sort((a, b) => a.page - b.page);

                    if (normalized.length <= 9) return normalized;

                    const current =
                        Number(this.overlayPagination?.currentPage) ||
                        normalized.find(p => p.isCurrent)?.page ||
                        normalized[0].page;

                    const first = normalized[0].page;
                    const last = normalized[normalized.length - 1].page;

                    // Desktop: current ±2
                    // Mobile: current ±1
                    const radius = window.innerWidth <= 640 ? 1 : 2;

                    const wanted = new Set([first, last]);

                    for (let page = current - radius; page <= current + radius; page++) {
                        if (page >= first && page <= last) wanted.add(page);
                    }

                    const byPage = new Map(
                        normalized.map(p => [p.page, p])
                    );

                    const selected = [...wanted]
                        .sort((a, b) => a - b)
                        .filter(page => byPage.has(page));

                    const result = [];
                    let previous = null;

                    for (const page of selected) {
                        if (previous !== null && page - previous > 1) {
                            result.push({
                                type: 'ellipsis',
                                key: `ellipsis-${previous}-${page}`
                            });
                        }

                        result.push(byPage.get(page));
                        previous = page;
                    }

                    return result;
                },

                async navigateToThreadPage(targetUrl, isResume = false) {
                    if (!targetUrl || this.isLoadingOverlay) return;
                    const requestId = 'thread-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
                    this.overlayRequestId = requestId;
                    this.vozInitialThreadLoad = isResume;
                    this.vozResumePending = isResume;
                    this.lastVozMeasureAt = 0;
                    this.lastTrackedVozPost = '';
                    this.stopArticleSpeech();
                    this.isLoadingOverlay = true;
                    this.overlayContent = null;
                    this.overlayError = null;
                    const threadScroll = document.getElementById('overlay-scroll-container');
                    if (threadScroll) threadScroll.scrollTop = 0;
                    if (this.overlayArticle) {
                        this.overlayArticle.originalLink ||= this.overlayArticle.link;
                        this.overlayArticle.link = targetUrl;
                    }
                    try {
                        const data = await this.fetchThreadPage(targetUrl, this.overlayArticle?.feedUrl || '');
                        if (!this.articleOverlayOpen || this.overlayRequestId !== requestId) return;
                        this.applyOverlayArticleData(data, this.overlayArticle);
                    } catch (e) {
                        if (this.overlayRequestId === requestId) this.overlayError = e.message;
                    } finally {
                        if (this.overlayRequestId === requestId) this.isLoadingOverlay = false;
                    }
                },
        };
    }
};
