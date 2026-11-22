import { encodeStoredSnapshot, decodeStoredValue, isSerializedValue, sameStoredValue, storedByteLength } from './stored-value.js';

// One transaction boundary for snapshot batches and short read-modify-write
// updates. Updaters are synchronous; network work must finish before entry.
export function createDatabaseBatchWriter({state, withDbLock, _loadDBFromDisk,
    _jsonParsedCache, _parseStoredArray, _backupFeeds, _persistToDisk}) {
    async function commit(keyValuePairs, options) {
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
    }
    return {
        putMany(changes, options = {}) {
            const encoded = encodeStoredSnapshot(changes);
            return withDbLock(() => commit(encoded, options), {
                keys: Object.keys(encoded),
                bytes: Object.values(encoded).reduce((total, value) => total + storedByteLength(value), 0)
            });
        },
        updateMany(keys, updater, options = {}) {
            return withDbLock(async () => {
                if (!state.value) state.value = await _loadDBFromDisk();
                const current = Object.fromEntries(keys.map(key => {
                    const value = state.value[key];
                    return [key, value == null ? null : isSerializedValue(value)
                        ? JSON.parse(decodeStoredValue(value)) : structuredClone(value)];
                }));
                const changes = updater(current);
                if (changes?.then) {
                    Promise.resolve(changes).catch(() => {});
                    throw new TypeError('Database updater must be synchronous');
                }
                for (const key of Object.keys(changes || {})) {
                    if (!keys.includes(key)) throw new Error(`Database updater wrote undeclared key: ${key}`);
                }
                await commit(encodeStoredSnapshot(changes || {}), options);
            }, { keys });
        }
    };
}
