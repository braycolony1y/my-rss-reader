import { normalizeStateUrl } from '../../utils/state-url.js';
// ONLY derived caches belong in this allowlist. In particular the identity
// ledger, fetch preferences, boards, reading state and article/archive files MUST NOT
// be age/count pruned here. The retired AI caches (smartEditorialAssessmentCache,
// smartEventVerificationCache, smartVerificationFailures) are no longer listed: their rows
// are archived and left untouched until scripts/delete-ai-data.mjs removes them.
const DAY = 86400000;
export const GOOGLE_NEWS_PERMANENT_TTL_MS = 30 * DAY;
export const CACHE_RETENTION = Object.freeze({
    // Article routes use a resolved mapping to find cached content of saved and
    // Board stories (article-routes.js), so resolved mappings are protected:
    // - a mapping whose wrapper or destination URL is referenced by savedStates,
    //   boardStates, cacheMembers or the cache identity ledger is never evicted;
    // - other resolved mappings expire after 180 days / beyond the caps, and only
    //   in maintenance, where references are known (protectResolved).
    // Keep browser retry history beyond its maximum 48-hour backoff.
    googleNewsUrlCache: { maxEntries: 100000, maxBytes: 96 * 1024 * 1024, protectResolved: true,
        resolved: entry => Boolean(entry?.resolvedUrl && !entry.permanentFailure), urls: (id, entry) => [id, entry?.resolvedUrl],
        age: entry => {
            if (entry?.permanentFailure) return GOOGLE_NEWS_PERMANENT_TTL_MS;
            if (entry?.resolvedUrl) return 180 * DAY;
            return entry?.browserAttempts ? 7 * DAY : DAY;
        }, time: entry => entry?.cachedAt },
});
const timestamp = value => typeof value === 'number' ? value : Date.parse(value || '');
// Descriptor of one row: the value itself is not retained, so callers can
// stream very large collections without holding every parsed entry.
// pins: Set of referenced URLs (normalized), or null when unknown (write path).
export function cacheDescriptor(key, id, value, bytes, now = Date.now(), pins = null) {
    const policy = CACHE_RETENTION[key], at = timestamp(policy.time(value));
    const resolved = Boolean(policy.resolved?.(value));
    // Without reference information a protected resolved row is always kept.
    const pinned = Boolean(policy.protectResolved && resolved && (!pins
        || policy.urls(id, value).some(url => url && (pins.has(url) || pins.has(normalizeStateUrl(url))))));
    // Unknown/future timestamps have no valid cache age; these are cache misses,
    // never authoritative user state.
    return { id, at, pinned, live: Number.isFinite(at) && at <= now + 60000 && now - at < policy.age(value),
        bytes: bytes ?? (Buffer.byteLength(id) + Buffer.byteLength(JSON.stringify(value) ?? '')) };
}
// Pinned rows first (unconditionally), then newest live rows within budgets.
export function retainedCacheIds(key, descriptors, now = Date.now()) {
    const policy = CACHE_RETENTION[key];
    const keep = new Set();let bytes = 0;
    for (const row of descriptors) if (row.pinned) { keep.add(row.id);bytes += row.bytes; }
    const candidates = descriptors.filter(row => row.live && !row.pinned).sort((a, b) => b.at - a.at);
    for (const row of candidates) {
        if (keep.size >= policy.maxEntries) break;
        if (bytes + row.bytes > policy.maxBytes) continue;
        bytes += row.bytes;keep.add(row.id);
    }
    return keep;
}
export function retainedCacheEntries(key, entries, now = Date.now()) {
    if (!Object.hasOwn(CACHE_RETENTION, key)) return entries;
    const keep = retainedCacheIds(key, entries.map(([id, value]) => cacheDescriptor(key, id, value, undefined, now)), now);
    // Retain original insertion order for stable collection hashes and reads.
    return keep.size === entries.length ? entries : entries.filter(([id]) => keep.has(id));
}
export function boundCacheObject(key, value, now) {
    if (!Object.hasOwn(CACHE_RETENTION, key) || !value || typeof value !== 'object' || Array.isArray(value)) return value;
    const entries = Object.entries(value), retained = retainedCacheEntries(key, entries, now);
    return retained === entries ? value : Object.fromEntries(retained);
}
