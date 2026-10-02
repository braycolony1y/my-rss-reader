/*
 * Board cache active-view priority.
 *
 * The cache scheduler gives the currently viewed thread first priority in
 * its HOT lane. Heartbeats are intentionally lightweight and do not trigger
 * an extra cache scan every 30 seconds.
 */
const ReaderBoardView = {
    install() {
    if (window.__boardCacheViewHeartbeatInstalled) {
        return;
    }

    window.__boardCacheViewHeartbeatInstalled = true;

    const ENDPOINT =
        '/api/board-cache/view';

    const HEARTBEAT_MS =
        30 * 1000;

    const viewerId = (() => {
        const key =
            'board-cache-viewer-id';

        let value =
            sessionStorage.getItem(key);

        if (!value) {
            value =
                typeof crypto?.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : `viewer-${Date.now()}-${Math.random()
                        .toString(36)
                        .slice(2)}`;

            sessionStorage.setItem(
                key,
                value
            );
        }

        return value;
    })();

    let activeArticle = null;

    function boardArticleFromLocation() {
        const raw =
            location.hash.startsWith('#')
                ? location.hash.slice(1)
                : location.hash;

        const queryIndex =
            raw.indexOf('?');

        if (queryIndex < 0) {
            return null;
        }

        const page =
            raw.slice(0, queryIndex);

        if (page !== 'board') {
            return null;
        }

        const params =
            new URLSearchParams(
                raw.slice(queryIndex + 1)
            );

        const article =
            params.get('article');

        return article
            ? article.trim()
            : null;
    }

    function send(
        url,
        active,
        {
            kick = false,
            beacon = false
        } = {}
    ) {
        if (!url) return;

        const payload = JSON.stringify({
            url,
            viewerId,
            active,
            kick
        });

        if (
            beacon &&
            navigator.sendBeacon
        ) {
            const body =
                new Blob(
                    [payload],
                    {
                        type:
                            'application/json'
                    }
                );

            navigator.sendBeacon(
                ENDPOINT,
                body
            );

            return;
        }

        fetch(
            ENDPOINT,
            {
                method: 'POST',
                headers: {
                    'Content-Type':
                        'application/json'
                },
                body: payload,
                keepalive: true
            }
        ).catch(() => {});
    }

    function reconcileView() {
        const next =
            boardArticleFromLocation();

        if (next === activeArticle) {
            return;
        }

        if (activeArticle) {
            send(
                activeArticle,
                false
            );
        }

        activeArticle =
            next;

        if (activeArticle) {
            /*
             * kick=true only when opened/switched so it can start a cache
             * scheduling cycle immediately if one isn't already running.
             */
            send(
                activeArticle,
                true,
                { kick: true }
            );
        }
    }

    function heartbeat() {
        /*
         * Also reconcile here in case the SPA changed history/hash in a way
         * that did not produce the expected navigation event.
         */
        reconcileView();

        if (activeArticle) {
            send(
                activeArticle,
                true
            );
        }
    }

    function closeActiveView() {
        if (!activeArticle) {
            return;
        }

        send(
            activeArticle,
            false,
            { beacon: true }
        );
    }

    window.addEventListener(
        'hashchange',
        reconcileView
    );

    window.addEventListener(
        'popstate',
        reconcileView
    );

    /*
     * When returning from a suspended/background tab, refresh the lease
     * immediately.
     */
    document.addEventListener(
        'visibilitychange',
        () => {
            reconcileView();

            if (
                !document.hidden &&
                activeArticle
            ) {
                send(
                    activeArticle,
                    true
                );
            }
        }
    );

    window.addEventListener(
        'pagehide',
        closeActiveView
    );

    setInterval(
        heartbeat,
        HEARTBEAT_MS
    );

    reconcileView();
    }
};
