// Bound expensive same-origin image requests so native HTTP/1 image loading
// cannot occupy every connection needed by feed and article navigation.
export function installThumbnailLoading(win) {
    const doc = win.document, selector = 'img[data-thumbnail-src]';
    const states = new Map();
    const targets = new WeakMap();
    let active = 0;
    const expensive = source => {
        try { const url = new URL(source, win.location.href); return url.origin === win.location.origin && url.pathname === '/api/og-image'; }
        catch { return false; }
    };
    const release = state => {
        if (!state.active) return;
        state.active = false; active--;
    };
    // A request already underway should survive a brief scroll out of range.
    // Only preempt it when an actually visible image is waiting for a slot.
    function drain() {
        const pending = [...states].filter(([img, state]) => img.isConnected && state.near && !state.started)
            .sort((a, b) => Number(b[1].visible) - Number(a[1].visible));
        for (const [img, state] of pending) {
            if (active >= 2) {
                if (!state.visible) break;
                const victim = [...states].find(([, other]) => other.active && !other.visible);
                if (!victim) break;
                const [oldImg, oldState] = victim;
                release(oldState);
                oldState.started = false;
                oldImg.removeAttribute('src');
            }
            if (!img.isConnected || !state.near || state.started) continue;
            state.started = true; state.active = true; active++;
            img.loading = 'eager'; img.src = state.source;
        }
    }
    function watch(img) {
        const source = img.getAttribute('data-thumbnail-src');
        let state = states.get(img);
        if (state?.source === source) return;
        if (state) { release(state); observer?.unobserve(state.target); viewportObserver?.unobserve(state.target); img.removeAttribute('src'); }
        if (!source) { states.delete(img); return; }
        if (!expensive(source)) {
            states.delete(img); img.src = source; drain(); return;
        }
        // Desktop Glass hides the source img and renders a separate hero layer.
        // Its visible card, rather than the hidden source, owns admission.
        const target = img.closest('.article-card') || img;
        state = {source, target, near: !observer, visible: !viewportObserver, started: false, active: false};
        targets.set(target,img); states.set(img, state);
        observer?.observe(target); viewportObserver?.observe(target); drain();
    }
    const observer = typeof win.IntersectionObserver === 'function' ? new win.IntersectionObserver(entries => {
        for (const entry of entries) {
            const img = targets.get(entry.target), state = states.get(img);
            if (state) {
                state.near = entry.isIntersecting;
            }
        }
        drain();
    }, {rootMargin: '1200px 0px'}) : null;
    // Separate in-viewport observation makes fast iPhone scrolling prioritize
    // cards on screen instead of older cards still in the preload margin.
    const viewportObserver = typeof win.IntersectionObserver === 'function' ? new win.IntersectionObserver(entries => {
        for (const entry of entries) {
            const img = targets.get(entry.target), state = states.get(img);
            if (state) state.visible = entry.isIntersecting;
        }
        drain();
    }) : null;
    const scan = node => {
        if (node.nodeType !== 1) return;
        if (node.matches(selector)) watch(node);
        node.querySelectorAll(selector).forEach(watch);
    };
    const settled = event => {
        const img = event.target, state = states.get(img);
        if (!state?.active) return;
        // Alpine's existing source fallback runs on the target after capture.
        // Keep ownership until that fallback has completed as well.
        const source = img.getAttribute('src');
        win.queueMicrotask(() => {
            if (img.getAttribute('src') !== source) return;
            release(state); drain();
        });
    };
    const mutations = new win.MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'attributes') watch(record.target);
            else record.addedNodes.forEach(scan);
        }
        for (const [img, state] of states) if (!img.isConnected) {
            release(state); observer?.unobserve(state.target); viewportObserver?.unobserve(state.target); states.delete(img);
            img.removeAttribute('src');
        }
        drain();
    });
    mutations.observe(doc.body, {subtree:true, childList:true, attributes:true, attributeFilter:['data-thumbnail-src']});
    doc.addEventListener('load', settled, true); doc.addEventListener('error', settled, true);
    scan(doc.body);
    return () => {
        mutations.disconnect(); observer?.disconnect(); viewportObserver?.disconnect();
        doc.removeEventListener('load', settled, true); doc.removeEventListener('error', settled, true);
        for (const [img,state] of states) if(state.active) img.removeAttribute('src');
        states.clear();
    };
}
