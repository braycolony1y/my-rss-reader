import {loadIncrementalEmbeddingSubset as loadEmbeddingSubset, mergeIncrementalEmbeddingCache as mergeEmbeddingCache} from './incremental-cache.js';

// This job already imports only its required vectors. Keep their compact encoded
// values until the job completes so an unchanged checkpoint performs no rewrite.
export function createEmbeddingCheckpoint({filename, importEntries, exportEntries, loadSubset = loadEmbeddingSubset, merge = mergeEmbeddingCache}) {
    const persisted = new Map();
    let count = 0;
    return {
        async load(keys) {
            const loaded = await loadSubset(filename, keys, entries => {
                for (const [key,value] of Object.entries(entries)) persisted.set(key,value);
                importEntries(entries);
            });
            count = loaded.entries;
            return loaded;
        },
        async save() {
            const changed = Object.fromEntries(Object.entries(exportEntries()).filter(([key,value]) => persisted.get(key) !== value));
            if (!Object.keys(changed).length) return count;
            const nextCount = await merge(filename, changed);
            for (const [key,value] of Object.entries(changed)) persisted.set(key,value);
            count = nextCount;
            return count;
        }
    };
}
