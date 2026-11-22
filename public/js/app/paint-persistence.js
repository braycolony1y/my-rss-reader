// Coalesce only article read-history snapshots until the browser can paint.
// History itself and its server writes remain immediate. Existing pagehide and
// freeze handlers still call saveState synchronously with the latest state.
const ReaderPaintPersistence = (() => {
    const pending = new WeakSet();
    return {
        save(app) {
            if (typeof app.saveState !== 'function') return;
            if (document.visibilityState === 'hidden' || typeof window.requestAnimationFrame !== 'function') {
                app.saveState();
                return;
            }
            const owner = window.Alpine?.raw?.(app) || app;
            if (pending.has(owner)) return;
            pending.add(owner);
            window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.setTimeout(() => {
                pending.delete(owner);
                app.saveState();
            }, 0)));
        }
    };
})();
