import { keepsBrowserOriginWarm } from './voz-warm-tab.js';

// Idle cleanup belongs to the transport owner, never to a viewer's lifetime.
export function createFetchTabIdleScheduler({
    states, trackers, cancelIdleClose, originPinned, resetPage, maybeDeleteTracker,
    setTimer = setTimeout, logger = console
}) {
    return function scheduleIdleClose(origin, tracker) {
        if (!tracker) return;
        cancelIdleClose(tracker);
        if (keepsBrowserOriginWarm(origin) || tracker.pending !== 0
            || tracker.closePromise || originPinned(tracker)) return;

        tracker.closeTimer = setTimer(() => {
            tracker.closeTimer = null;
            if (tracker.pending !== 0 || tracker.closePromise || originPinned(tracker)
                || trackers.get(origin) !== tracker) return;

            const state = states.get(origin);
            const closeTask = (async () => {
                if (state) await resetPage(state, { closeTab: true, reason: '60s fetch-idle cleanup' });
                logger.log(`[OPENCLI FETCH] ${origin} idle for 60s; closed exact reusable browser tab`);
            })();
            tracker.closePromise = closeTask;
            closeTask.finally(() => {
                if (tracker.closePromise === closeTask) tracker.closePromise = null;
                maybeDeleteTracker(origin, tracker);
            }).catch(() => {});
        }, 60_000);
        tracker.closeTimer.unref?.();
    };
}
