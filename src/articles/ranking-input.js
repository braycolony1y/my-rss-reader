import { createHash } from 'node:crypto';
import { isSerializedValue, decodeStoredValue, storedDigest } from '../database/stored-value.js';

// A request-scoped handle to immutable database bytes. The database memoizes
// their full digest weakly; cache hits never decode or serialize the corpus.
export function serializedRankingInput(value) {
    const raw = isSerializedValue(value) ? value : JSON.stringify(value || []);
    return Object.freeze({ digest: storedDigest(raw), read: () => decodeStoredValue(raw) });
}

export function rankingInputs(publication, raw) {
    const handle = value => typeof value?.read === 'function' && typeof value.digest === 'string'
        ? value : serializedRankingInput(value);
    const left = handle(publication), right = handle(raw);
    return {
        // Fixed-length digests preserve input boundaries as well as all bytes.
        digest: createHash('sha256').update(left.digest).update(right.digest).digest('hex'),
        read: () => ({ publicationJson: left.read(), rawJson: right.read() })
    };
}
