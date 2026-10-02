/*
 * SMART_VIEWPORT_CLIENT_V1
 *
 * The page-level Smart queue is not enough when the reader quickly scrolls
 * from story #2 to #15 (or back upward). Report the cards physically visible
 * inside #scroll-container so the server can re-promote them dynamically.
 *
 * No /api/data refetch is performed here.
 */
const ReaderSmartViewport = {
    install() {
    if (window.__smartViewportPriorityInstalled) {
        return;
    }

    window.__smartViewportPriorityInstalled = true;

    const ENDPOINT =
        '/api/ai/briefing-viewport';

    const SCROLL_REPUSH_PX = 80;
    const DEBOUNCE_MS = 80;
    const HEARTBEAT_MS = 5000;
    const MAX_VISIBLE = 8;

    let timer = null;
    let observer = null;
    let heartbeat = null;

    let lastSignature = '';
    let lastScrollTop = -1;
    let lastGeneration = 0;
    let forceNext = true;

    function nextGeneration() {
        lastGeneration =
            Math.max(
                Date.now(),
                lastGeneration + 1
            );

        return lastGeneration;
    }

    function root() {
        return document.getElementById(
            'scroll-container'
        );
    }

    function isTopActive(sc) {
        return (
            sc &&
            sc.dataset.smartTop === '1' &&
            Boolean(
                sc.dataset.smartView
            ) &&
            !document.hidden
        );
    }

    function visibleCards(sc) {
        const rootRect =
            sc.getBoundingClientRect();

        const center =
            (
                rootRect.top +
                rootRect.bottom
            ) / 2;

        const result = [];

        for (
            const card
            of sc.querySelectorAll(
                '.article-card[data-smart-cluster-id]'
            )
        ) {
            const id =
                String(
                    card.dataset
                        .smartClusterId ||
                    ''
                ).trim();

            if (!id) {
                continue;
            }

            const rect =
                card.getBoundingClientRect();

            const overlap =
                Math.max(
                    0,
                    Math.min(
                        rect.bottom,
                        rootRect.bottom
                    ) -
                    Math.max(
                        rect.top,
                        rootRect.top
                    )
                );

            const minimumVisible =
                Math.min(
                    80,
                    Math.max(
                        30,
                        rect.height * 0.12
                    )
                );

            if (
                overlap <
                minimumVisible
            ) {
                continue;
            }

            result.push({
                id,
                page:
                    Math.max(
                        1,
                        Number(
                            card.dataset
                                .smartCardPage
                        ) || 1
                    ),
                centerDistance:
                    Math.abs(
                        (
                            rect.top +
                            rect.bottom
                        ) / 2 -
                        center
                    )
            });
        }

        result.sort(
            (a, b) =>
                a.centerDistance -
                b.centerDistance
        );

        return result.slice(
            0,
            MAX_VISIBLE
        );
    }

    function sendViewport(
        {
            force = false
        } = {}
    ) {
        const sc = root();

        if (!isTopActive(sc)) {
            lastSignature = '';
            lastScrollTop = -1;
            return;
        }

        const cards =
            visibleCards(sc);

        if (!cards.length) {
            return;
        }

        // The card closest to viewport center defines the active page.
        // Visible cards straddling the boundary are still promoted together.
        const page =
            cards[0]?.page ||
            Math.max(
                1,
                Number(
                    sc.dataset
                        .smartCurrentPage
                ) || 1
            );

        const ids =
            cards.map(
                card => card.id
            );

        const signature =
            JSON.stringify([
                sc.dataset.smartView,
                sc.dataset.smartFilter,
                sc.dataset.smartRegion,
                page,
                ids
            ]);

        const scrollTop =
            Number(sc.scrollTop) || 0;

        const moved =
            lastScrollTop < 0 ||
            Math.abs(
                scrollTop -
                lastScrollTop
            ) >=
                SCROLL_REPUSH_PX;

        if (
            !force &&
            !forceNext &&
            signature ===
                lastSignature &&
            !moved
        ) {
            return;
        }

        forceNext = false;
        lastSignature = signature;
        lastScrollTop = scrollTop;

        const generation =
            nextGeneration();

        fetch(
            ENDPOINT,
            {
                method: 'POST',
                headers: {
                    'Content-Type':
                        'application/json'
                },
                keepalive: true,
                body:
                    JSON.stringify({
                        smartViewToken:
                            sc.dataset
                                .smartView,
                        filterValue:
                            sc.dataset
                                .smartFilter ||
                            '',
                        smartRegion:
                            sc.dataset
                                .smartRegion ||
                            '',
                        page,
                        visibleClusterIds:
                            ids,
                        generation
                    })
            }
        ).then(async response => {
            if (!response.ok) throw new Error('Viewport update failed');
            const data = await response.json();
            if (generation !== lastGeneration || !isTopActive(sc) || data.staleViewport) return;
            window.dispatchEvent(new CustomEvent('briefing-viewport-updated', {
                detail: { smartViewToken: sc.dataset.smartView, updates: data.updates || [] }
            }));
        }).catch(() => {
            if (generation === lastGeneration) forceNext = true;
        });
    }

    function schedule(
        force = false
    ) {
        if (force) {
            forceNext = true;
        }

        if (timer) {
            clearTimeout(timer);
        }

        timer =
            setTimeout(
                () => {
                    timer = null;

                    sendViewport({
                        force:
                            forceNext
                    });
                },
                DEBOUNCE_MS
            );
    }

    function install() {
        const sc = root();

        if (!sc) {
            setTimeout(
                install,
                250
            );
            return;
        }

        sc.addEventListener(
            'scroll',
            () => schedule(false),
            {
                passive: true
            }
        );

        window.addEventListener(
            'resize',
            () => schedule(true),
            {
                passive: true
            }
        );

        document.addEventListener(
            'visibilitychange',
            () => {
                if (!document.hidden) {
                    schedule(true);
                }
            }
        );

        observer =
            new MutationObserver(
                () => schedule(true)
            );

        observer.observe(
            sc,
            {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: [
                    'data-smart-view',
                    'data-smart-top',
                    'data-smart-cluster-id',
                    'data-smart-card-page'
                ]
            }
        );

        heartbeat =
            setInterval(
                () => {
                    if (
                        isTopActive(sc)
                    ) {
                        sendViewport({
                            force: true
                        });
                    }
                },
                HEARTBEAT_MS
            );

        schedule(true);
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
