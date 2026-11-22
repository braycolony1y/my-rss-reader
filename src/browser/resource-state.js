export function summarizeBrowserResources(fetchStates, fetchQueues, readerPools) {
    let fetchPages = 0, pendingFetches = 0, pinnedViewers = 0, readerProcesses = 0, readerJobs = 0;
    for (const state of fetchStates.values()) fetchPages += Number(Boolean(state.browserLeaseOpen));
    for (const tracker of fetchQueues.values()) {
        pendingFetches += tracker.pending || 0;
        pinnedViewers += tracker.pinnedViewers?.size || 0;
    }
    for (const pool of readerPools.values()) {
        readerProcesses += Number(!pool.exited); readerJobs += pool.jobs?.size || 0;
    }
    return { ownership: 'shared-desktop-browser', fetchPages, pendingFetches, pinnedViewers, readerProcesses, readerJobs };
}

export function summarizeGeminiSlots(slots) {
    return { slots: slots.length, busy: slots.filter(slot => slot.busy).length,
        trackedPages: slots.filter(slot => slot.page).length };
}
