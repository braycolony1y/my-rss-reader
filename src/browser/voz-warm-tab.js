export const VOZ_WARM_ORIGIN = 'https://voz.vn';

export function keepsBrowserOriginWarm(origin) {
    try {
        const url = new URL(origin);
        return url.protocol === 'https:' && (url.hostname === 'voz.vn' || url.hostname.endsWith('.voz.vn'));
    } catch { return false; }
}

// Use the fetch transport's existing queue, state and lease. This service
// never allocates a separate Page or fetches an article to keep the tab alive.
export function createVozWarmTab({
    getState, getTracker, ensureReady, evaluate, cancelIdleClose,
    withBudget, intervalMs = 30_000, setTimer = setInterval,
    clearTimer = clearInterval, logger = console
}) {
    let timer;
    let active;

    function maintain() {
        if (active) return active;
        const tracker = getTracker(VOZ_WARM_ORIGIN);
        // Real source work already renews the lease and takes precedence.
        if (tracker.pending) return Promise.resolve(false);
        cancelIdleClose(tracker);
        tracker.pending++;
        tracker.maintenanceActive = true;
        active = tracker.queue.run('voz-warm-tab', () => withBudget(async () => {
            const state = await getState(VOZ_WARM_ORIGIN);
            // Resolve the existing session first, including after a restart.
            // A missing target can rebind to a blank; check its origin before
            // marking the context ready for browser-side source fetches.
            try {
                const origin = await evaluate(state, 'location.origin');
                if (origin === VOZ_WARM_ORIGIN && state.browserReady) return true;
            } catch {
                state.browserReady = false;
            }
            state.browserReady = false;
            await ensureReady(state, VOZ_WARM_ORIGIN);
            return true;
        }, 4), 4).catch(error => {
            logger.warn('[VOZ WARM TAB] Could not prepare shared tab:', error.message);
            return false;
        }).finally(() => {
            tracker.pending = Math.max(0, tracker.pending - 1);
            tracker.maintenanceActive = false;
            active = undefined;
        });
        return active;
    }

    return {
        maintain,
        start() {
            if (timer !== undefined) return;
            timer = setTimer(maintain, intervalMs);
            timer.unref?.();
            void maintain();
        },
        stop() {
            if (timer !== undefined) clearTimer(timer);
            timer = undefined;
        }
    };
}
