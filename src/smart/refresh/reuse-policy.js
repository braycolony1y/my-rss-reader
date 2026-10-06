import { SMART_CLUSTER_VERSION } from '../config.js';
import { EMBEDDING_MODEL, EMBEDDING_CACHE_VERSION } from '../embeddings/config.js';

export async function canReuseSmartSnapshot({ forceRebuild, currentSignature, previousSignature,
    previousAiConfiguration, aiConfiguration, db }) {
    if (forceRebuild || !previousSignature || currentSignature !== previousSignature
        || previousAiConfiguration !== aiConfiguration) return false;
    const [algorithm, embedding, deferred] = await Promise.all([
        db.get('smartClusteringAlgorithmVersion'), db.get('smartEmbeddingIdentity'),
        db.get('smartDeferredReviewGroups', { type: 'json', shared: true }),
    ]);
    // Memory-deferred work is not a completed cached decision. Retain its
    // durable groups and retry after capacity recovers, even with unchanged input.
    if (deferred?.groups?.some(group => group.reason === 'memory_pressure')) return false;
    return algorithm === SMART_CLUSTER_VERSION && embedding === `${EMBEDDING_MODEL}:${EMBEDDING_CACHE_VERSION}`;
}
