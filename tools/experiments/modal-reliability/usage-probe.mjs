// Injected only into the isolated test page. No production diagnostics or timers.
export function installUsageProbe() {
    const app = Alpine.$data(document.body);
    const root = document.querySelector('.ai-status-overlay');
    const panel = root.querySelector('.ai-status-modal');
    const body = root.querySelector('.ai-status-body');
    const focus = document.querySelector('.ai-key-input');
    const ancestors = [];
    for (let node = root; node; node = node.parentElement) ancestors.push(node);
    const report = { frames: 0, failures: [], mutations: [], calls: [], openChanges: [], replacements: [], gaps: [] };
    const restorers = [];
    let running = true, previous = performance.now(), sequence = 0;
    const record = (list, value) => { if (list.length < 2000) list.push({ at: performance.now(), ...value }); };
    for (const name of ['fetchSmartAiProgress', 'fetchGeminiDebugStats', 'fetchOnlineAiUsage',
        'fetchGeminiKeyStatus', 'fetchData', 'openGeminiStatus', 'closeGeminiStatus']) {
        const original = app[name];
        app[name] = function (...args) {
            const call = ++sequence;
            record(report.calls, { name, call, phase: 'start', stack: new Error().stack });
            const result = original.apply(this, args);
            Promise.resolve(result).then(() => record(report.calls, { name, call, phase: 'end' }),
                error => record(report.calls, { name, call, phase: 'error', error: String(error) }));
            return result;
        };
        restorers.push(() => { app[name] = original; });
    }
    const unwatch = app.$watch('geminiStatusOpen', value => record(report.openChanges, { value }));
    const observer = new MutationObserver(entries => {
        for (const entry of entries) {
            if (entry.type === 'attributes' && ancestors.includes(entry.target)) {
                record(report.mutations, { node: entry.target.tagName, attribute: entry.attributeName,
                    old: entry.oldValue, value: entry.target.getAttribute(entry.attributeName) });
            }
            for (const removed of entry.removedNodes) {
                if (removed === root || removed === panel || removed === body || removed.contains?.(root))
                    record(report.replacements, { node: removed.nodeName });
            }
        }
    });
    observer.observe(document.documentElement, { subtree: true, attributes: true, attributeOldValue: true,
        attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'], childList: true });
    const initialAncestors = ancestors.map(node => {
        const s = getComputedStyle(node);
        return { tag: node.tagName, transform: s.transform, filter: s.filter, contain: s.contain,
            isolation: s.isolation, zIndex: s.zIndex, position: s.position };
    });
    function frame(now) {
        if (!running) return;
        report.frames++;
        if (now - previous > 100) record(report.gaps, { duration: now - previous });
        previous = now;
        const rect = panel.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.max(1, rect.left + 30), Math.max(1, rect.top + 30));
        const hiddenAncestors = ancestors.filter(node => {
            const s = getComputedStyle(node);
            return s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0;
        });
        if (!app.geminiStatusOpen || !root.isConnected || root !== document.querySelector('.ai-status-overlay')
            || hiddenAncestors.length || rect.width === 0 || !panel.contains(hit)
            || document.activeElement !== focus || focus.value !== 'unsaved-fixture-input') {
            record(report.failures, { open: app.geminiStatusOpen, connected: root.isConnected,
                hiddenAncestors: hiddenAncestors.map(n => n.tagName), rect: rect.toJSON(),
                hit: hit?.className, focus: document.activeElement?.className, value: focus.value });
        }
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    window.usageProbe = { report, initialAncestors, stop() {
        running = false; observer.disconnect(); unwatch?.(); restorers.reverse().forEach(fn => fn());
        return { ...report, initialAncestors, scrollTop: body.scrollTop,
            generated: app.geminiDebugStats?.queue?.stats?.generated,
            progress: app.geminiKeyStatus?.lastSmartRun?.progress?.current,
            usage: app.onlineAiUsage?.summary?.totalRequests };
    }};
}
