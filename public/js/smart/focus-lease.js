/*
 * Active Smart-tab AI reservation.
 *
 * The server only hard-reserves Antigravity while:
 *   1. this browser tab is visible, and
 *   2. a currently-active Smart briefing AI job exists.
 *
 * The AI-job side of that condition is evaluated server-side; this browser
 * lease only tells the scheduler whether the user is still actively here.
 */
const ReaderSmartFocus = {
    install() {
    if (
        window
            .__antigravityBriefingFocusInstalled
    ) {
        return;
    }

    window
        .__antigravityBriefingFocusInstalled =
        true;

    const ENDPOINT =
        '/api/ai/briefing-focus';

    const HEARTBEAT_MS =
        30 * 1000;

    const viewerId = (() => {
        const key =
            'ai-briefing-focus-viewer';

        let id =
            sessionStorage.getItem(key);

        if (!id) {
            id =
                typeof crypto?.randomUUID ===
                'function'
                    ? crypto.randomUUID()
                    : `briefing-${Date.now()}-${Math.random()
                        .toString(36)
                        .slice(2)}`;

            sessionStorage.setItem(
                key,
                id
            );
        }

        return id;
    })();

    let lastActive = null;

    let lastSentActive = null;
    let lastSentAt = 0;

    function sendFocus(
        active,
        beacon = false
    ) {
        /*
         * DOM/hash/navigation transitions can all request the same state
         * within milliseconds. Do not POST duplicate identical leases.
         */
        const now =
            Date.now();

        if (
            !beacon &&
            active === lastSentActive &&
            now - lastSentAt < 5000
        ) {
            return;
        }

        lastSentActive =
            active;

        lastSentAt =
            now;

        const payload =
            JSON.stringify({
                viewerId,
                active
            });

        if (
            beacon &&
            navigator.sendBeacon
        ) {
            navigator.sendBeacon(
                ENDPOINT,
                new Blob(
                    [payload],
                    {
                        type:
                            'application/json'
                    }
                )
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

    function hasVisibleSmartSurface() {
        /*
         * These elements belong to the Smart briefing presentation.
         * offsetParent/rect checks prevent a hidden previous view from
         * retaining the reservation after the user changes sections.
         */
        const elements =
            document.querySelectorAll(
                '.story-analysis-shell,' +
                '.article-card.has-story-briefing,' +
                '.story-key-facts'
            );

        for (const element of elements) {
            const rect =
                element.getBoundingClientRect();

            const style =
                getComputedStyle(element);

            if (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                rect.width > 0 &&
                rect.height > 0
            ) {
                return true;
            }
        }

        return false;
    }

    function currentActiveState() {
        return (
            document.visibilityState ===
                'visible' &&
            hasVisibleSmartSurface()
        );
    }

    function reconcileFocus(
        force = false
    ) {
        const active =
            currentActiveState();

        if (
            force ||
            active !== lastActive
        ) {
            lastActive = active;

            sendFocus(active);
        }
    }

    document.addEventListener(
        'visibilitychange',
        () => reconcileFocus(true)
    );

    window.addEventListener(
        'hashchange',
        () =>
            setTimeout(
                () => reconcileFocus(true),
                0
            )
    );

    window.addEventListener(
        'popstate',
        () =>
            setTimeout(
                () => reconcileFocus(true),
                0
            )
    );

    window.addEventListener(
        'pagehide',
        () => {
            lastActive = false;
            sendFocus(
                false,
                true
            );
        }
    );

    /*
     * Smart-tab/card changes are SPA DOM updates, so observe them rather than
     * depending only on URL navigation.
     */
    let reconcileTimer = null;

    const observer =
        new MutationObserver(() => {
            clearTimeout(
                reconcileTimer
            );

            reconcileTimer =
                setTimeout(
                    () =>
                        reconcileFocus(),
                    100
                );
        });

    observer.observe(
        document.documentElement,
        {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
                'class',
                'style',
                'hidden'
            ]
        }
    );

    setInterval(
        () => {
            if (
                currentActiveState()
            ) {
                /*
                 * Refresh the 90-second server lease.
                 */
                sendFocus(true);
                lastActive = true;
            } else {
                reconcileFocus();
            }
        },
        HEARTBEAT_MS
    );

    reconcileFocus(true);
    }
};
