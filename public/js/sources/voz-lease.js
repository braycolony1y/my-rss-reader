/*
 * OPENCLI_VOZ_LEASE_CLIENT_V1
 *
 * Automatically pins the ONE existing voz.vn OpenCLI shared browser page
 * whenever the currently selected RSS tab contains only VOZ sources/threads.
 *
 * Detection is data-driven:
 * - a selected feed is VOZ when that feed URL belongs to voz.vn;
 * - a selected category is VOZ-only when every feed in that category is VOZ;
 * - other views qualify only when all currently loaded articles are VOZ
 *   thread URLs.
 *
 * We do NOT hard-code names such as "Forum" or "Điểm báo".
 *
 * Leaving the VOZ-only view releases the pin. The server then applies its
 * ordinary 60-second idle-close policy rather than closing immediately.
 */
const ReaderVozLease = {
    install() {
    if (
        window.__vozOpenCliLeaseClientInstalled
    ) {
        return;
    }

    window.__vozOpenCliLeaseClientInstalled =
        true;

    const ENDPOINT =
        '/api/opencli/voz-lease';

    // Every browser document/tab must own a distinct lease id. sessionStorage
    // can be cloned when a tab is duplicated, which allowed one tab to release
    // another tab's VOZ pin. Stale ids are expired server-side by heartbeat.
    const HEARTBEAT_MS =
        20 * 1000;

    // OPENCLI_VOZ_VIEWER_STABLE_PIN_V4
    // A one-second SPA reconciliation must never tear down the physical VOZ
    // keepalive while the user is still on a VOZ-only view. A short release
    // grace absorbs transient empty/mixed article arrays during pagination and
    // route changes; true navigation away still releases shortly afterwards.
    const RELEASE_GRACE_MS =
        10 * 1000;

    let leaseActive = false;
    let lastWanted = null;
    let reconcileTimer = null;
    let releaseTimer = null;


    function makeViewerId() {
        return (
            crypto?.randomUUID?.() ||
            (
                Date.now().toString(36)
                + '-'
                + Math.random()
                    .toString(36)
                    .slice(2)
            )
        );
    }


    const viewerId =
        makeViewerId();


    function appState() {
        const body =
            document.body;

        if (!body) {
            return null;
        }

        try {
            if (
                window.Alpine &&
                typeof window.Alpine.$data ===
                    'function'
            ) {
                return window.Alpine.$data(
                    body
                );
            }
        }
        catch {
        }

        return (
            body._x_dataStack?.[0] ||
            null
        );
    }


    function parsedUrl(value) {
        try {
            return new URL(
                String(value || ''),
                location.origin
            );
        }
        catch {
            return null;
        }
    }


    function isVozHostUrl(value) {
        const url =
            parsedUrl(value);

        if (!url) {
            return false;
        }

        const hostname =
            url.hostname
                .toLowerCase();

        return (
            hostname === 'voz.vn' ||
            hostname.endsWith(
                '.voz.vn'
            )
        );
    }


    function isVozThreadUrl(value) {
        const url =
            parsedUrl(value);

        if (
            !url ||
            !isVozHostUrl(url.href)
        ) {
            return false;
        }

        return /^\/(?:t|threads)\//i.test(
            url.pathname
        );
    }


    function feedCategory(feed) {
        return String(
            feed?.category ||
            feed?.feedCategory ||
            'Others'
        );
    }


    function feedUrl(feed) {
        return (
            feed?.url ||
            feed?.feedUrl ||
            feed?.link ||
            ''
        );
    }


    function articleUrl(article) {
        return (
            article?.originalLink ||
            article?.resolvedLink ||
            article?.link ||
            ''
        );
    }


    function routedArticleUrl() {
        const hash =
            String(location.hash || '');
        const marker =
            '?article=';
        const index =
            hash.lastIndexOf(marker);

        if (index < 0) {
            return '';
        }

        try {
            return decodeURIComponent(
                hash.slice(
                    index + marker.length
                )
            );
        }
        catch {
            return '';
        }
    }


    function currentViewIsVozOnly(
        state
    ) {
        if (
            !state ||
            state.isLoggedIn === false
        ) {
            return false;
        }

        const type =
            String(
                state.selectedFilterType ||
                ''
            );

        const value =
            String(
                state.selectedFilterValue ||
                ''
            );

        const feeds =
            Array.isArray(state.feeds)
                ? state.feeds
                : [];


        // An open VOZ thread is authoritative even if the backing list is in a
        // transient loading state or contains stale cards from the prior view.
        if (
            isVozThreadUrl(
                articleUrl(
                    state.overlayArticle
                )
            ) ||
            isVozThreadUrl(
                routedArticleUrl()
            )
        ) {
            return true;
        }


        /*
         * Feed selection can be identified before its article list finishes
         * loading, so clicking a VOZ feed can start the shared browser warmup
         * immediately.
         */
        if (
            type === 'feed' &&
            value
        ) {
            const selectedFeeds =
                feeds.filter(
                    feed =>
                        String(
                            feedUrl(feed)
                        ) === value
                );

            if (
                selectedFeeds.length
            ) {
                return selectedFeeds.every(
                    feed =>
                        isVozHostUrl(
                            feedUrl(feed)
                        )
                );
            }

            return isVozHostUrl(
                value
            );
        }


        /*
         * Likewise for categories such as Forum / Điểm báo: derive the answer
         * from their member feed URLs rather than from the category's name.
         */
        if (
            type === 'category' &&
            value
        ) {
            const categoryFeeds =
                feeds.filter(
                    feed =>
                        feedCategory(feed) ===
                        value
                );

            if (
                categoryFeeds.length
            ) {
                return categoryFeeds.every(
                    feed =>
                        isVozHostUrl(
                            feedUrl(feed)
                        )
                );
            }
        }


        /*
         * Generic fallback for other tabs/views.
         * They qualify only when every loaded item is actually a VOZ thread.
         */
        const articles =
            Array.isArray(
                state.displayedArticles
            )
                ? state.displayedArticles
                : (
                    Array.isArray(state.articles)
                        ? state.articles
                        : []
                );

        // Ignore transient/placeholder cards with no article URL. They should
        // not turn an otherwise VOZ-only tab into a non-VOZ view.
        const articleUrls =
            articles
                .map(articleUrl)
                .filter(Boolean);

        if (!articleUrls.length) {
            // Do not briefly drop the VOZ pin while the same VOZ-only tab is
            // reloading/paginating and its article array is temporarily empty.
            return Boolean(
                leaseActive &&
                state.isLoadingArticles
            );
        }

        return articleUrls.every(
            isVozThreadUrl
        );
    }


    async function postLease(
        active,
        {
            unload = false
        } = {}
    ) {
        const body =
            JSON.stringify({
                viewerId,
                active:
                    active === true
            });

        if (
            unload &&
            navigator.sendBeacon
        ) {
            try {
                const payload =
                    new Blob(
                        [body],
                        {
                            type:
                                'application/json'
                        }
                    );

                if (
                    navigator.sendBeacon(
                        ENDPOINT,
                        payload
                    )
                ) {
                    return;
                }
            }
            catch {
            }
        }

        try {
            await fetch(
                ENDPOINT,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type':
                            'application/json'
                    },
                    body,
                    keepalive: true
                }
            );
        }
        catch {
            /*
             * The next click/hash reconciliation or heartbeat retries.
             * Never make navigation/UI depend on this optimization.
             */
        }
    }


    function cancelReleaseTimer() {
        if (!releaseTimer) {
            return;
        }

        clearTimeout(
            releaseTimer
        );
        releaseTimer = null;
    }


    function reconcile(
        {
            force = false
        } = {}
    ) {
        const state =
            appState();

        if (!state) {
            return;
        }

        const wanted =
            currentViewIsVozOnly(
                state
            );

        lastWanted =
            wanted;

        if (wanted) {
            cancelReleaseTimer();

            const wasActive =
                leaseActive;
            leaseActive = true;

            if (
                force ||
                !wasActive
            ) {
                void postLease(true);
            }
            return;
        }

        if (!leaseActive) {
            cancelReleaseTimer();
            return;
        }

        // Do not release on the first transient false result. Re-evaluate after
        // a short stable interval; a VOZ route/article/list that comes back in
        // the meantime cancels this timer.
        if (releaseTimer) {
            return;
        }

        releaseTimer =
            setTimeout(
                () => {
                    releaseTimer = null;

                    const freshState =
                        appState();

                    if (
                        freshState &&
                        currentViewIsVozOnly(
                            freshState
                        )
                    ) {
                        lastWanted = true;
                        void postLease(true);
                        return;
                    }

                    leaseActive = false;
                    lastWanted = false;
                    void postLease(false);
                },
                RELEASE_GRACE_MS
            );
    }


    function scheduleReconcile(
        delay = 0,
        force = false
    ) {
        if (reconcileTimer) {
            clearTimeout(
                reconcileTimer
            );
        }

        reconcileTimer =
            setTimeout(
                () => {
                    reconcileTimer =
                        null;

                    reconcile({
                        force
                    });
                },
                delay
            );
    }


    function install() {
        /*
         * Click is especially useful: Alpine's tab handler normally mutates
         * selectedFilterType/value synchronously. Running just after it means a
         * VOZ category/feed can begin browser bootstrap before its article list
         * has finished loading.
         */
        document.addEventListener(
            'click',
            () => {
                scheduleReconcile(
                    0,
                    false
                );

                /*
                 * A second cheap pass catches async filter state changes.
                 */
                setTimeout(
                    () =>
                        scheduleReconcile(
                            0,
                            false
                        ),
                    120
                );
            },
            true
        );


        window.addEventListener(
            'hashchange',
            () =>
                scheduleReconcile(
                    0,
                    false
                )
        );


        window.addEventListener(
            'popstate',
            () =>
                scheduleReconcile(
                    0,
                    false
                )
        );


        window.addEventListener(
            'pageshow',
            () =>
                scheduleReconcile(
                    0,
                    true
                )
        );


        /*
         * Do NOT release on document.hidden.
         *
         * Merely changing Chrome tabs/minimizing the window does not mean the
         * RSS website was closed or switched away from the VOZ RSS view.
         */


        const releaseOnExit =
            () => {
                cancelReleaseTimer();

                if (!leaseActive) {
                    return;
                }

                leaseActive =
                    false;

                void postLease(
                    false,
                    {
                        unload: true
                    }
                );
            };


        window.addEventListener(
            'pagehide',
            releaseOnExit
        );


        window.addEventListener(
            'beforeunload',
            releaseOnExit
        );


        /*
         * Reconciliation catches article/filter data that changed without a
         * user click. This does not hit the server unless the VOZ-only state
         * actually changes.
         */
        setInterval(
            () =>
                reconcile({
                    force: false
                }),
            1000
        );


        /*
         * Heartbeat keeps BOTH layers alive while this browser tab remains on
         * a VOZ-only view: the logical viewer pin and the existing OpenCLI
         * Browser Bridge session. It never creates/navigates a publisher tab.
         * Each browser tab uses a unique viewerId; stale/crashed tabs expire
         * server-side if heartbeats stop.
         */
        setInterval(
            () => {
                // Once pinned, heartbeat unconditionally until the stable
                // release path above confirms that the tab really left VOZ.
                // This prevents a transient SPA state from allowing Browser
                // Bridge's 60-second physical lease to expire.
                if (leaseActive) {
                    void postLease(
                        true
                    );
                }
            },
            HEARTBEAT_MS
        );


        scheduleReconcile(
            0,
            true
        );
    }


    if (
        document.readyState ===
        'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            install,
            {
                once: true
            }
        );
    }
    else {
        install();
    }
    }
};
