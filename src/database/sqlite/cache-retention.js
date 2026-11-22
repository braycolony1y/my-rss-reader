import { normalizeStateUrl } from '../../utils/state-url.js';
// ONLY derived caches belong in this allowlist. In particular the identity
// ledger, personal filters, Top Stories continuity, fetch preferences, boards,
// reading state and article/archive files MUST NOT be age/count pruned here.
// Evicted AI results can be recomputed (and may cost another provider call).
const DAY = 86400000;
export const CACHE_RETENTION = Object.freeze({
    // Article routes use a resolved mapping to find cached content of saved and
    // Board stories (article-routes.js), so resolved mappings are protected:
    // - a mapping whose wrapper or destination URL is referenced by savedStates,
    //   boardStates, cacheMembers or the cache identity ledger is never evicted;
    // - other resolved mappings expire after 180 days / beyond the caps, and only
    //   in maintenance, where references are known (protectResolved).
    // Failures (no resolvedUrl) have a 5-minute owner TTL; keep one day.
    googleNewsUrlCache: { maxEntries: 100000, maxBytes: 96 * 1024 * 1024, protectResolved: true,
        resolved: entry => Boolean(entry?.resolvedUrl), urls: (id, entry) => [id, entry?.resolvedUrl],
        age: entry => entry?.resolvedUrl ? 180 * DAY : DAY, time: entry => entry?.cachedAt },
    // Keys hash cluster content, so a changed cluster never reuses an old row.
    smartEditorialAssessmentCache: { maxEntries: 20000, maxBytes: 24 * 1024 * 1024,
        age: () => 30 * DAY, time: entry => entry?.createdAt ?? entry?.assessedAt ?? entry?.failedAt },
    smartEventVerificationCache: { maxEntries: 20000, maxBytes: 24 * 1024 * 1024,
        age: () => 30 * DAY, time: entry => entry?.createdAt ?? entry?.verifiedAt },
    // The longest configurable suppression window is 24 hours.
    smartVerificationFailures: { maxEntries: 5000, maxBytes: 4 * 1024 * 1024,
        age: () => DAY, time: entry => entry?.at },
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
