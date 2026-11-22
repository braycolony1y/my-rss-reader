// Metadata is committed as one presentation revision. A late result may change
// the crop once; keeping a visible fallback forever is not a valid completion.
export const fallbackFocus = Object.freeze({ x: .5, y: .5 });
export const imageSourceKey = img => JSON.stringify(['src', 'srcset', 'sizes'].map(key => img.getAttribute(key) || ''));

export function createImageVisualLifecycle({ win, states, saved, sourceOf, getFocus, apply, stopped, prepare = value => Promise.resolve(value) }) {
    function update(img) {
        const state = states.get(img);
        if (!state || !img.isConnected || stopped()) return;
        const source = sourceOf(img), sourceKey = imageSourceKey(img);
        if (state.source !== source || state.sourceKey !== sourceKey) {
            win.clearTimeout(state.timer);
            const cached = saved.get(source);
            Object.assign(state, { source, sourceKey, generation: (state.generation || 0) + 1,
                focus: cached || fallbackFocus, palette: cached?.palette, tint: cached?.tint, blend: cached?.blend,
                paletteSampled: false, settled: Boolean(cached), requested: false, shown: false, deferred: null, timer: null });
            img.dataset.focusState = 'pending';
        }
        const generation = state.generation;
        const owns = () => !stopped() && img.isConnected && states.get(img) === state && state.generation === generation
            && sourceOf(img) === source && imageSourceKey(img) === sourceKey;
        if (state.near) img.loading = 'eager';
        apply(img, state);
        if (!source) return;
        if (state.near && !state.settled && !state.timer) {
            state.timer = win.setTimeout(() => {
                if (!owns()) return;
                state.timer = null;
                state.settled = true;
                apply(img, state);
            }, 2500);
        }
        if (state.requested || !state.near) return;
        state.requested = true;
        if (/^(\/public\/|data:|blob:)/.test(source)) {
            state.settled = true;
            win.clearTimeout(state.timer); state.timer = null;
            apply(img, state);
            return;
        }
        getFocus(source).then(async metadata => {
            if (!owns()) return;
            // Keep the current complete visual state while generated assets decode.
            const focus = await prepare(metadata, win);
            if (!owns()) return;
            win.clearTimeout(state.timer); state.timer = null;
            Object.assign(state, { focus, palette: focus.palette, tint: focus.tint, blend: focus.blend,
                deferred: null, settled: true });
            apply(img, state);
        }).catch(() => {
            if (!owns()) return;
            win.clearTimeout(state.timer); state.timer = null;
            state.settled = true;
            apply(img, state);
        });
    }
    return { update };
}
