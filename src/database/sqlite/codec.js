import { createHash } from 'node:crypto';

export const hash = text => createHash('sha256').update(text).digest('hex');
export const ARTICLE_KEYS = new Set(['articles', 'smartRawArticles', 'smartClusters', 'smartClusteringInputs', '$topStoriesPublished.articles', '$smartProgressivePublication.clusters']);
export const CHILD_FIELDS = {
    topStoriesPublished: new Set(['articles']),
    smartProgressivePublication: new Set(['clusters']),
    cacheIdentityLedger: new Set(['articles','dismissals']),
};
export const STATE_KEYS = new Set(['readStates', 'savedStates', 'hiddenStates', 'recentReadAt']);
export const CRITICAL_ARRAYS = new Set(['feeds', 'articles', 'smartRawArticles', 'smartClusters', 'blockedArticleKeywords']);
export function describe(key, value) {
    let decoded = value, encoding = 'native';
    if (typeof value === 'string') {
        try { decoded = JSON.parse(value); encoding = 'json'; }
        catch {
            if(CRITICAL_ARRAYS.has(key))throw Error(`[DB SAFETY] ${key} write is not a valid array`);
            return { encoding: 'native', shape: 'scalar', decoded: value };
        }
    }
    const shape = Array.isArray(decoded) ? 'array' : decoded && typeof decoded === 'object' ? 'object' : 'scalar';
    if (CRITICAL_ARRAYS.has(key) && shape !== 'array') throw Error(`[DB SAFETY] ${key} write is not a valid array`);
    return { encoding, shape, decoded };
}
export function tableFor(key) {
    if (key === 'feeds' || key === 'smartSources') return 'feeds';
    if (ARTICLE_KEYS.has(key)) return 'articles';
    if (STATE_KEYS.has(key)) return 'reading_states';
    if (key === 'boardStates' || key === 'cacheMembers' || key === 'cacheAutoRules') return 'boards';
    if (key === 'userPreferences') return 'preferences';
    return 'metadata_entries';
}
export function rowIdentity(value, index, seen) {
    const base = value && typeof value === 'object'
        ? String(value.articleKey ?? value.clusterId ?? value.id ?? value.link ?? value.url ?? index)
        : JSON.stringify(value);
    const count = seen.get(base) || 0; seen.set(base, count + 1);
    return JSON.stringify([base, count]);
}
