import os from 'node:os';
import fs from 'node:fs';
import {
    deterministicGroups,
    exportEmbeddingCache,
    importEmbeddingCache,
    prepareEmbeddings,
    updateBatchStopTokens,
    runIncrementalHnswClustering
} from './smart-news.js';

import { parentPort } from 'node:worker_threads';

try {
    os.setPriority(0, 15);
} catch (error) {
    console.warn('[SMART WORKER] Could not lower process priority:', error.message);
}

function send(message, callback = null) {
    if (!parentPort) return;
    try {
        parentPort.postMessage(message);
    } catch (e) {
        fs.writeFileSync('/tmp/worker-send-error.log', e.stack);
    }
    if (callback) {
        setTimeout(callback, 200);
    }
}

if (parentPort) {
    parentPort.on('message', async message => {
        if (message?.type !== 'cluster') return;
    try {
        const articles = Array.isArray(message.articles) ? message.articles : [];
        const existingClusters = Array.isArray(message.existingClusters) ? message.existingClusters : [];
        const mode = message.mode || 'incremental-hnsw';
        
        let storedEmbeddings = message.embeddingCache || {};
        try {
            if (message.cachePath && fs.existsSync(message.cachePath)) {
                storedEmbeddings = JSON.parse(fs.readFileSync(message.cachePath, 'utf8')) || {};
            }
        } catch (error) {
            console.warn('[SMART WORKER] Could not load the embedding cache:', error.message);
        }
        importEmbeddingCache(storedEmbeddings);
        updateBatchStopTokens(articles);
        
        // 1. Embed NEW/MODIFIED articles
        fs.appendFileSync('/tmp/worker.log', 'Starting prepareEmbeddings\n');
        await prepareEmbeddings(articles, progress => send({ type: 'progress', progress }));
        fs.appendFileSync('/tmp/worker.log', 'Finished prepareEmbeddings\n');
        
        let autoMergedClusters = [];
        let ambiguousGroups = [];

        if (mode === 'full-deterministic') {
            fs.appendFileSync('/tmp/worker.log', 'Starting deterministicGroups\n');
            const result = await deterministicGroups(articles, progress => send({ type: 'progress', progress }));
            autoMergedClusters = result.autoMergedClusters;
            ambiguousGroups = result.ambiguousGroups;
            fs.appendFileSync('/tmp/worker.log', 'Finished deterministicGroups\n');
        } else {
            fs.appendFileSync('/tmp/worker.log', `Starting runIncrementalHnswClustering with ${existingClusters.length} clusters\n`);
            console.log(`[HNSW DEBUG] Worker received ${existingClusters.length} existing clusters`);
            const result = await runIncrementalHnswClustering(articles, existingClusters, progress => send({ type: 'progress', progress }));
            autoMergedClusters = result.autoMergedClusters;
            ambiguousGroups = result.ambiguousGroups;
            fs.appendFileSync('/tmp/worker.log', 'Finished runIncrementalHnswClustering\n');
        }

        fs.appendFileSync('/tmp/worker.log', 'Exporting cache\n');
        const updatedEmbeddings = exportEmbeddingCache();
        fs.appendFileSync('/tmp/worker.log', 'Exported cache\n');
        if (message.cachePath) {
            const temporaryPath = message.cachePath + '.tmp-' + process.pid;
            fs.writeFileSync(temporaryPath, JSON.stringify(updatedEmbeddings));
            fs.renameSync(temporaryPath, message.cachePath);
        }
        
        const result = {
            autoMergedClusters,
            ambiguousGroups,
            embeddingCacheCount: Object.keys(updatedEmbeddings).length
        };

        // Sending thousands of vectors back through structured clone briefly
        // duplicates the entire cache in the request-serving process. The
        // production path persists the cache in the worker instead.
        if (!message.cachePath) {
            result.updatedEmbeddings = updatedEmbeddings;
        }

        send({ 
            type: 'result', 
            result
        });
    } catch (error) {
        send({ type: 'error', error: String(error?.stack || error) });
    }
    });
}
