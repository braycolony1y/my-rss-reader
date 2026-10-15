// Readiness belongs to the assigned soft-image generation, never to a previous
// decoded image still reported by the browser during source replacement.
const images = new WeakMap();
export function updateStoryPhoto(soft, source, owner, refresh) {
    let state = images.get(soft);
    if (state?.source !== source || state.owner !== owner || (soft.getAttribute('src') || '') !== source) {
        if (state?.onLoad) soft.removeEventListener('load', state.onLoad);
        state = { source, owner, ready: false, decoding: false };
        images.set(soft, state);
        if (source) {
            const owns = () => images.get(soft) === state && soft.isConnected && soft.getAttribute('src') === source;
            const complete = () => {
                if (!owns() || !soft.complete || !soft.naturalWidth) return;
                state.ready = true; refresh();
            };
            const decode = () => {
                if (!owns() || state.ready || state.decoding) return;
                if (typeof soft.decode !== 'function') { complete(); return; }
                state.decoding = true;
                soft.decode().then(complete, () => {}).finally(() => { state.decoding = false; });
            };
            // A failed asset may later load successfully at the same URL. Retry
            // only on a real load, not on every layout/observer callback.
            state.onLoad = decode;
            soft.addEventListener('load', decode);
            soft.loading = 'eager';
            if (soft.getAttribute('src') !== source) soft.src = source;
            if (typeof soft.decode === 'function') decode();
        } else soft.removeAttribute('src');
    }
    return Boolean(source && state.ready && soft.complete && soft.naturalWidth);
}
