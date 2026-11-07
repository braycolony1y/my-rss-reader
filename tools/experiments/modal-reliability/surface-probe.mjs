// Generic browser-only probe for both persistent Alpine overlays and class-
// controlled legacy overlays. It observes, but never owns application state.
export function installSurfaceProbe({ selector, state, panelSelector, backdropSelector, scrollerSelector }) {
    const root = document.querySelector(selector), app = Alpine.$data(document.body);
    const panel = panelSelector ? root.querySelector(panelSelector) : root.firstElementChild;
    const backdrop = backdropSelector ? root.querySelector(backdropSelector) : root;
    const scroller = scrollerSelector ? root.querySelector(scrollerSelector) : panel;
    const nodes = [root, panel, backdrop].filter(Boolean), ancestors = [];
    for (let node = root; node; node = node.parentElement) ancestors.push(node);
    const observations = { frames: 0, failures: [], mutations: [], removals: [], stateChanges: [], gaps: [] };
    const push = (list, row) => { if (list.length < 2000) list.push({ at: performance.now(), ...row }); };
    let running = true, previous = performance.now();
    const stopWatch = state ? app.$watch(state, value => push(observations.stateChanges, { value: !!value })) : null;
    const observer = new MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'attributes' && [...nodes, ...ancestors].includes(record.target))
                push(observations.mutations, { node: record.target.className, name: record.attributeName,
                    old: record.oldValue, value: record.target.getAttribute(record.attributeName) });
            for (const removed of record.removedNodes) if (nodes.some(n => removed === n || removed.contains?.(n)))
                push(observations.removals, { node: removed.nodeName });
        }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true,
        attributeOldValue: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
    const initial = ancestors.map(n => {
        const s = getComputedStyle(n);
        return { node: n.tagName, transform: s.transform, filter: s.filter, contain: s.contain,
            isolation: s.isolation, position: s.position, zIndex: s.zIndex };
    });
    function sample(now) {
        if (!running) return;
        observations.frames++;
        if (now - previous > 100) push(observations.gaps, { ms: now - previous });
        previous = now;
        const r = panel.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.max(1, r.left + r.width / 2), Math.max(1, r.top + 30));
        const hidden = [...nodes, ...ancestors].filter(n => {
            const s = getComputedStyle(n);
            return !n.isConnected || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0;
        });
        if (hidden.length || !panel.contains(hit) || (state && !app[state])) push(observations.failures, {
            hidden: hidden.map(n => n.className || n.tagName), hit: hit?.className, rect: r.toJSON(), open: !!app[state] });
        requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
    window.surfaceProbe = { stop() {
        running = false; observer.disconnect(); stopWatch?.();
        return { ...observations, initial, scrollTop: scroller?.scrollTop,
            sameRoot: root === document.querySelector(selector) };
    }};
}
