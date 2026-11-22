// A presentation view may still own a parse after the strong LRU evicts it.
// Recover that same graph instead of allocating a duplicate. WeakRef never
// keeps the graph alive; metadata is independently bounded and expires.
export function createWeakParses({ maxEntries = 64, ttlMs = 600000, now = Date.now } = {}) {
    const entries = new Map();
    return {
        set(key, raw, parsed) {
            if (!parsed || typeof parsed !== 'object' || maxEntries < 1) return;
            entries.delete(key);
            entries.set(key, { raw, ref: new WeakRef(parsed), at: now() });
            while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
        },
        get(key, raw) {
            const entry = entries.get(key);
            if (!entry) return;
            const parsed = entry.raw === raw && now() - entry.at < ttlMs ? entry.ref.deref() : undefined;
            if (!parsed) { entries.delete(key); return; }
            entries.delete(key); entry.at = now(); entries.set(key, entry);
            return { raw, parsed };
        },
        invalidate(key, raw) { if (entries.get(key)?.raw !== raw) entries.delete(key); },
        clear() { entries.clear(); },
    };
}
