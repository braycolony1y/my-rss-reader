// One reserve slot lets visible work pass slow preloads without destroying
// their sources. This policy is consumed by the existing loader/observers.
export const THUMBNAIL_LIMITS = Object.freeze({ prefetch: 2, visible: 3 });

export function selectThumbnailAdmissions(states, active, limits = THUMBNAIL_LIMITS) {
    const pending = [...states].filter(([img, state]) => img.isConnected && state.near && !state.started)
        .sort((a, b) => Number(b[1].visible) - Number(a[1].visible));
    const admitted = [];
    for (const entry of pending) {
        const [, state] = entry;
        if (active >= (state.visible ? limits.visible : limits.prefetch)) break;
        admitted.push(entry);
        active++;
    }
    return admitted;
}
