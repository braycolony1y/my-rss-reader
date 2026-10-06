export function createStringCache({ maxBytes, maxEntries = 1000, ttlMs = 600000, now = Date.now }) {
    const entries = new Map();
    let bytes = 0, hits = 0, misses = 0;
    function remove(key) {
        const value = entries.get(key);
        if (value) { bytes -= value.bytes; entries.delete(key); }
    }
    return {
        get(key) {
            const value = entries.get(key);
            if (!value || value.expires <= now()) { remove(key); misses++; return undefined; }
            hits++; entries.delete(key); entries.set(key, value);
            return value.output;
        },
        set(key, output) {
            remove(key);
            const size = (key.length + output.length) * 2;
            if (size > maxBytes) return;
            entries.set(key, { output, bytes: size, expires: now() + ttlMs }); bytes += size;
            while (bytes > maxBytes || entries.size > maxEntries) remove(entries.keys().next().value);
        },
        state: () => ({ entries: entries.size, bytes, maxBytes, hits, misses }),
    };
}
