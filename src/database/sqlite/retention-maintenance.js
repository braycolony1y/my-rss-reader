import { CACHE_RETENTION, cacheDescriptor, retainedCacheIds } from './cache-retention.js';
import { createRepository } from './repository.js';
import { normalizeStateUrl } from '../../utils/state-url.js';

const URL_PATTERN = /https?:\/\/[^"\s\\<>]+/g;
// Every URL that a saved story, Board entry, cache member or cache identity
// ledger row refers to. Google News mappings for these are never evicted.
export function referencedStateUrls(db) {
    const pins = new Set();
    const add = text => { for (const url of String(text || '').match(URL_PATTERN) || []) { pins.add(url);pins.add(normalizeStateUrl(url)); } };
    const sources = [
        ["SELECT row_key,link,value FROM reading_states WHERE collection='savedStates'"],
        ["SELECT row_key,link,value FROM boards WHERE collection IN ('boardStates','cacheMembers')"],
        ["SELECT row_key,NULL link,value FROM metadata_entries WHERE collection='cacheIdentityLedger' OR substr(collection,1,21)='$cacheIdentityLedger.'"],
    ];
    for (const [query] of sources) for (const row of db.prepare(query).iterate()) { add(row.row_key);add(row.link);add(row.value); }
    pins.delete('');
    return pins;
}

// Caller owns the transaction. This finite allowlist cannot select user-state,
// preferences, identity-ledger, cache_files or archive_entries rows.
// Rows are streamed into small descriptors; parsed values are not retained.
// smartTopPrefilterState is bounded by its owner (prefilter/state.js) on load
// and save, so it is not rewritten here.
export function pruneDerivedCaches(db, now = Date.now()) {
    const repository = createRepository(db), report = {};
    const select = db.prepare('SELECT row_key,value,length(CAST(row_key AS BLOB))+length(CAST(value AS BLOB)) bytes FROM metadata_entries WHERE collection=?');
    const remove = db.prepare('DELETE FROM metadata_entries WHERE collection=? AND row_key=?');
    for (const key of Object.keys(CACHE_RETENTION)) {
        if (repository.info(key)?.shape !== 'object') continue;
        const pins = CACHE_RETENTION[key].protectResolved ? referencedStateUrls(db) : null;
        const descriptors = [];
        for (const row of select.iterate(key)) {
            let value;try { value = JSON.parse(row.value); } catch { value = null; }
            descriptors.push(cacheDescriptor(key, row.row_key, value, row.bytes, now, pins));
        }
        const keep = retainedCacheIds(key, descriptors, now);
        let removed = 0;
        for (const { id } of descriptors) if (!keep.has(id)) removed += Number(remove.run(key, id).changes);
        if (removed) repository.refreshDigest(key);
        report[key] = removed;
        if (pins) report[key + 'Protected'] = descriptors.filter(row => row.pinned).length;
    }
    return report;
}
