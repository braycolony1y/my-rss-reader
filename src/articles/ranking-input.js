import { isSerializedValue, decodeStoredValue, storedDigest } from '../database/stored-value.js';

// A request-scoped handle to immutable database bytes. The database memoizes
// their full digest weakly; cache hits never decode or serialize the corpus.
export function serializedRankingInput(value) {
    const raw = isSerializedValue(value) ? value : JSON.stringify(value || []);
    return Object.freeze({ digest: storedDigest(raw), read: () => decodeStoredValue(raw) });
}
