import {encodeStoredValue,encodeStoredSnapshot,decodeStoredValue,isSerializedValue,sameStoredValue,storedByteLength} from './stored-value.js';
import {measureDatabaseRead} from './read-timing.js';

// Public database access and mutation transaction boundaries. The caller owns
// persistence, locking and recovery; callers still receive the original API types.
export function createDatabaseAccess({state,withDbLock,_loadDBFromDisk,_jsonParsedCache,_parseStoredArray,_backupFeeds,_persistToDisk,STATE_KEYS}) {
    return {
            get: async (key, opts) => {
                if (!state.value) {
                    await withDbLock(async () => {
                        if (!state.value) state.value = await _loadDBFromDisk();
                    });
                }
                let val = state.value[key];
                if (!val) return null;
                if (opts && opts.type === 'json' && isSerializedValue(val)) {
                    const cached = measureDatabaseRead(key,'lookup',()=>_jsonParsedCache.get(key, val));
                    if (cached) return opts.shared ? cached.parsed : measureDatabaseRead(key,'clone',()=>structuredClone(cached.parsed));
                    const decoded = measureDatabaseRead(key,'decode',()=>decodeStoredValue(val));
                    const parsed = measureDatabaseRead(key,'parse',()=>JSON.parse(decoded));
                    // Mutable one-off readers already own this parse. Retaining
                    // it AND cloning it doubled every background corpus read.
                    if (opts.shared) _jsonParsedCache.set(key, val, parsed);
                    return parsed;
                }
                return decodeStoredValue(val);
            },
            put: (key, value, options = {}) => {
                value = encodeStoredValue(value);
                return withDbLock(async () => {
                if (!state.value) state.value = await _loadDBFromDisk();
                if (sameStoredValue(state.value[key], value)) return;
                const previous = state.value;
                const next = { ...previous, [key]: value };

                if (['feeds', 'articles', 'smartRawArticles', 'smartClusters', 'blockedArticleKeywords'].includes(key)) {
                    const oldItems = _parseStoredArray(previous, key) || [];
                    const newItems = _parseStoredArray(next, key);
                    if (!newItems) throw new Error(`[DB SAFETY] ${key} write is not a valid array`);
                    if (oldItems.length > 0 && newItems.length === 0 && !(key === 'blockedArticleKeywords' && options.allowLargeReduction)) {
                        throw new Error(`[DB SAFETY] Refusing to wipe ${oldItems.length} ${key}`);
                    }
                    const destructiveDrop = oldItems.length >= 20 && newItems.length < Math.ceil(oldItems.length * 0.1);
                    if (destructiveDrop && !options.allowLargeReduction) {
                        throw new Error(`[DB SAFETY] Refusing unexpected ${key} reduction from ${oldItems.length} to ${newItems.length}`);
                    }
                }

                if (key === 'feeds') {
                    const oldFeeds = _parseStoredArray(previous, key) || [];
                    const newFeeds = _parseStoredArray(next, key) || [];
                    const destructiveDrop = oldFeeds.length >= 3 && newFeeds.length < Math.ceil(oldFeeds.length * 0.5);
                    if (destructiveDrop && !options.allowLargeReduction) {
                        throw new Error(`[DB SAFETY] Refusing unexpected feed reduction from ${oldFeeds.length} to ${newFeeds.length}`);
                    }
                    await _backupFeeds(JSON.stringify(newFeeds), oldFeeds.length ? JSON.stringify(oldFeeds) : null);
                }

                state.value = next;
                try {
                    await _persistToDisk(next, previous, key, { ...options, lightweight: STATE_KEYS.has(key) });
                    _jsonParsedCache.invalidate(key, value);
                } catch (err) {
                    state.value = previous; // rollback on failure
                    throw err;
                }
                }, {keys:[key],bytes:storedByteLength(value)});
            },
            putMany: (keyValuePairs, options = {}) => {
                keyValuePairs = encodeStoredSnapshot(keyValuePairs);
                return withDbLock(async () => {
                if (!state.value) state.value = await _loadDBFromDisk();
                keyValuePairs = Object.fromEntries(Object.entries(keyValuePairs).filter(
                    ([key, value]) => !sameStoredValue(state.value[key], value)
                ));
                if (!Object.keys(keyValuePairs).length) return;
                const previous = state.value;
                let next = { ...previous };

                for (const [key, value] of Object.entries(keyValuePairs)) {
                    next[key] = value;

                    if (['feeds', 'articles', 'smartRawArticles', 'smartClusters', 'blockedArticleKeywords'].includes(key)) {
                        const oldItems = _parseStoredArray(previous, key) || [];
                        const newItems = _parseStoredArray(next, key);
                        if (!newItems) throw new Error(`[DB SAFETY] ${key} write is not a valid array`);
                        if (oldItems.length > 0 && newItems.length === 0 && !(key === 'blockedArticleKeywords' && options.allowLargeReduction)) {
                            throw new Error(`[DB SAFETY] Refusing to wipe ${oldItems.length} ${key}`);
                        }
                        const destructiveDrop = oldItems.length >= 20 && newItems.length < Math.ceil(oldItems.length * 0.1);
                        if (destructiveDrop && !options.allowLargeReduction) {
                            throw new Error(`[DB SAFETY] Refusing unexpected ${key} reduction from ${oldItems.length} to ${newItems.length}`);
                        }
                    }

                    if (key === 'feeds') {
                        const oldFeeds = _parseStoredArray(previous, key) || [];
                        const newFeeds = _parseStoredArray(next, key) || [];
                        const destructiveDrop = oldFeeds.length >= 3 && newFeeds.length < Math.ceil(oldFeeds.length * 0.5);
                        if (destructiveDrop && !options.allowLargeReduction) {
                            throw new Error(`[DB SAFETY] Refusing unexpected feed reduction from ${oldFeeds.length} to ${newFeeds.length}`);
                        }
                        await _backupFeeds(JSON.stringify(newFeeds), oldFeeds.length ? JSON.stringify(oldFeeds) : null);
                    }
                }

                try {
                    await _persistToDisk(next, previous, Object.keys(keyValuePairs), options);
                    state.value = next;
                    for (const key of Object.keys(keyValuePairs)) _jsonParsedCache.invalidate(key, next[key]);
                } catch (err) {
                    state.value = previous; // rollback on failure
                    throw err;
                }
            }, {keys:Object.keys(keyValuePairs),bytes:Object.values(keyValuePairs).reduce((sum,value)=>sum+storedByteLength(value),0)});
            }
    };
}
