// Bounded browser-side observations. Style/DOM evidence is not painted-frame proof.
export function installModalProbe() {
    const root = document.querySelector('.ai-status-overlay');
    const panel = root.firstElementChild;
    const body = root.querySelector('.ai-status-body');
    const records = {frames: [], longTasks: [], mutations: 0, removals: 0, hidden: 0};
    let last = performance.now(), running = true;
    const observer = new MutationObserver(entries => {
        records.mutations += entries.length;
        for (const entry of entries) for (const node of entry.removedNodes) {
            if (node === root || node === panel || node === body || node.contains?.(root)) records.removals++;
        }
    });
    observer.observe(document.body, {subtree: true, childList: true});
    const performanceObserver = new PerformanceObserver(list => {
        for (const e of list.getEntries()) if (records.longTasks.length < 1000) records.longTasks.push(e.duration);
    });
    try { performanceObserver.observe({type: 'longtask', buffered: false}); } catch {}
    function frame(now) {
        if (!running) return;
        if (records.frames.length < 10000) records.frames.push(now - last);
        last = now;
        const style = getComputedStyle(root);
        if (!root.isConnected || style.display === 'none' || style.visibility === 'hidden' || +style.opacity === 0) records.hidden++;
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    window.modalProbe = {stop() {running = false; observer.disconnect(); performanceObserver.disconnect(); return records;}};
}
