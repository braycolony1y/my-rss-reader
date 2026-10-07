import {isSerializedValue} from './stored-value.js';
import { createWeakParses } from './weak-parses.js';
const MB = 1024 * 1024;

// Raw JSON remains durable in the database owner. This cache owns only a
// bounded number of shared parses; mutable reads still clone those parses.
export function createParsedCache({
    maxBytes = (Number(process.env.RSS_PARSED_CACHE_MAX_MB) || 192) * MB,
    maxEntries = 64,
    ttlMs = 10 * 60 * 1000,
    now = Date.now,
    recoverOwned = true,
} = {}) {
    const entries = new Map();
    const weak = createWeakParses({ maxEntries: recoverOwned ? maxEntries : 0, ttlMs, now });
    let recovered = 0;
    let bytes = 0, hits = 0, misses = 0, evictions = 0;
    const remove = key => {
        const entry = entries.get(key);
        if (entry) { bytes -= entry.bytes; entries.delete(key); }
    };
    function prune() {
        const cutoff = now() - ttlMs;
        for (const [key, entry] of entries) {
            if (entry.at > cutoff) break;
            remove(key); evictions++;
        }
    }
    return {
        get(key, raw) {
            prune();
            const entry = entries.get(key);
            if (!entry || entry.raw !== raw) {
                remove(key);
                const owned = weak.get(key, raw);
                if (owned) { hits++; recovered++; return owned; }
                misses++;
                return undefined;
            }
            hits++; weak.set(key, raw, entry.parsed);
            entries.delete(key); entry.at = now(); entries.set(key, entry);
            return entry;
        },
        set(key, raw, parsed) {
            remove(key); prune();
            weak.set(key, raw, parsed);
            // String storage is a cheap, conservative sizing proxy. Object
            // overhead varies by corpus, so the metric names this estimate.
            const size = isSerializedValue(raw) ? raw.length * 2 : 0;
            if (size > maxBytes || maxEntries < 1) return;
            entries.set(key, { raw, parsed, bytes: size, at: now() }); bytes += size;
            while (bytes > maxBytes || entries.size > maxEntries) {
                remove(entries.keys().next().value); evictions++;
            }
        },
        invalidate(key, currentRaw) {
            weak.invalidate(key, currentRaw);
            if (entries.get(key)?.raw !== currentRaw) remove(key);
        },
        clear() { entries.clear(); weak.clear(); bytes = 0; },
        state() { prune(); return { entries: entries.size, estimatedSourceBytes: bytes, maxBytes, hits, misses, evictions, recovered }; },
    };
}
