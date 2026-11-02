// At most one request per preference key. Older progress requests finish before
// newer checkpoints are sent; an old response cannot restore stale local state.
const ReaderPreferenceWrites = (() => {
    const owners = new WeakMap();
    async function flush(app) {
        const owner = app.preferenceWriteOwner || app;
        let running = owners.get(owner);
        if (!running) { running = new Map(); owners.set(owner, running); }
        const keys = Object.keys(app.pendingPreferences).filter(key => key !== 'smartTabModes');
        await Promise.all(keys.map(key => {
            if (running.has(key)) return running.get(key);
            const task = (async () => {
                while (Object.prototype.hasOwnProperty.call(app.pendingPreferences, key)) {
                    const value = app.pendingPreferences[key];
                    clearTimeout(app.syncPrefsTimer?.[key]);
                    try {
                        const response = await fetch('/api/user-preferences', {
                            method: 'POST', keepalive: true,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ key, value })
                        });
                        if (!response.ok) return;
                        let returned = null;
                        try { returned = await response.json(); } catch (_) {}
                        if (app.pendingPreferences[key] === value) {
                            delete app.pendingPreferences[key];
                            if (returned && Object.prototype.hasOwnProperty.call(returned, 'value')) {
                                app.userPreferences = { ...app.userPreferences, [key]: returned.value };
                                try { localStorage.setItem(key, typeof returned.value === 'string'
                                    ? returned.value : JSON.stringify(returned.value)); } catch (_) {}
                            }
                        }
                    } catch (_) { return; }
                }
            })();
            running.set(key, task);
            return task.finally(() => { if (running.get(key) === task) running.delete(key); });
        }));
    }
    return { flush };
})();
