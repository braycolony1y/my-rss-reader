// Render effects belong to the request that inserted this article. A delayed
// nextTick from a replaced article must never reset the newly restored reader.
const ReaderArticleRenderEffects = {
    afterInsert(app, requestId, deferVozWorkUntilPaint) {
        if (!app.articleOverlayOpen || app.overlayRequestId !== requestId) return;
        app.hydrateTwitterEmbeds(document.getElementById('overlay-scroll-container'));
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
        app.checkVozThreadPosition();

        if (
            deferVozWorkUntilPaint
            && app.articleOverlayOpen
            && app.overlayRequestId === requestId
        ) {
            // Allow two rendering opportunities before speculative work.
            // Callback cadence is not proof of compositor presentation.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (
                        !app.articleOverlayOpen
                        || app.overlayRequestId !== requestId
                    ) {
                        return;
                    }

                    const activeVozUrl = app.overlayArticle?.resolvedLink || app.overlayArticle?.link || '';
                    const activeFeedUrl = app.overlayArticle?.feedUrl || '';
                    let vozPriorityWork = Promise.resolve();

                    if (!app.overlayArticle?.sourceDeleted) {
                        if (app.overlayFetchedFromCache) {
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
                                app.checkVozNewPostsInBackground(
                                    activeVozUrl,
                                    activeFeedUrl
                                )
                            );
                        } else if (app.overlayPagination?.nextUrl) {
                            vozPriorityWork = Promise.resolve(
                                app.prefetchThreadPages(
                                    app.overlayPagination,
                                    activeFeedUrl
                                )
                            );
                        }
                    }

                    const deferred = app.vozDeferredArticlePrefetch;
                    if (deferred && deferred.requestId === requestId) {
                        app.vozDeferredArticlePrefetch = null;
                        // Unrelated article prefetch waits until VOZ continuation
                        // discovery/read-ahead has had first use of the source queue.
                        Promise.resolve(vozPriorityWork).finally(() => {
                            if (app.articleOverlayOpen && app.overlayRequestId === requestId) {
                                app.prefetchNextAfter(deferred.article);
                            }
                        });
                    }
                });
            });
        }
    }
};
