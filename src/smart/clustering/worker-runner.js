import { clearEmbeddingCache, embeddingCacheKey, exportEmbeddingCache, importEmbeddingCache, prepareEmbeddings } from '../embeddings/index.js';
import { createEmbeddingCheckpoint } from '../embeddings/checkpoint.js';
import { deterministicGroups } from './components.js';
import { updateBatchStopTokens } from '../text/normalize.js';
import { runIncrementalHnswClustering } from '../../../smart-hnsw-clustering.js';

export async function runClusterJob(message, send) {
    const articles = Array.isArray(message.articles) ? message.articles : [];
    const existingClusters = Array.isArray(message.existingClusters) ? message.existingClusters : [];
    let diskCount = 0;
    const cacheCheckpoint = message.cachePath ? createEmbeddingCheckpoint({filename:message.cachePath,importEntries:importEmbeddingCache,exportEntries:exportEmbeddingCache}) : null;
    try {
        if (message.cachePath) {
            const keys = new Set(articles.map(embeddingCacheKey));
            try {
                const loaded = await cacheCheckpoint.load(keys);
                diskCount = loaded.entries;
                console.log('[SMART EMBEDDING CACHE]', JSON.stringify({ ...loaded, required: keys.size }));
            } catch (error) {
                if (error.code !== 'ENOENT') console.warn('[SMART WORKER] Could not load the embedding cache:', error.message);
            }
        } else importEmbeddingCache(message.embeddingCache || {});
        updateBatchStopTokens(articles);
        const checkpoint = async () => {
            if (cacheCheckpoint) diskCount = await cacheCheckpoint.save();
        };
        await prepareEmbeddings(articles, progress => send({ type: 'progress', progress }), checkpoint);
        const grouped = message.mode === 'full-deterministic'
            ? await deterministicGroups(articles, progress => send({ type: 'progress', progress }))
            : await runIncrementalHnswClustering(articles, existingClusters, progress => send({ type: 'progress', progress }));
        await checkpoint();
        const result = {
            autoMergedClusters: grouped.autoMergedClusters,
            ambiguousGroups: grouped.ambiguousGroups,
            metrics: grouped.metrics || {},
            embeddingCacheCount: message.cachePath ? diskCount : Object.keys(exportEmbeddingCache()).length,
        };
        if (!message.cachePath) result.updatedEmbeddings = exportEmbeddingCache();
        send({ type: 'result', result });
    } finally {
        if (message.cachePath) {
            // Keep the native model worker alive; release this run's JS graphs.
            clearEmbeddingCache(); updateBatchStopTokens([]);
        }
    }
}

export function installClusterWorker(port) {
    let tail = Promise.resolve();
    const send = message => port.postMessage(message);
    port.on('message', message => {
        if (message?.type !== 'cluster') return;
        tail = tail.then(() => runClusterJob(message, send)).catch(error => {
            send({ type: 'error', error: String(error?.stack || error) });
        });
    });
}
