import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { getClusterWorker } from '../../src/smart/clustering/worker-client.js';
import { boundedWorkerOptions } from '../../src/observability/memory-budget.js';
import { normalizeArticle, embeddingCacheKey, getArticleId } from '../../smart-news.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/smart-refactor/input.json', import.meta.url), 'utf8'));
const articles = fixture.articles.map(({ vector, ...item }) => ({ ...normalizeArticle(item), _status: 'NEW' }));
const embeddingCache = Object.fromEntries(articles.map((article, index) => {
  const vector = Float32Array.from(fixture.articles[index].vector);
  return [embeddingCacheKey(article), Buffer.from(vector.buffer).toString('base64')];
}));
const timeout = setTimeout(() => { console.error('Worker probe timeout'); process.exit(1); }, 30000);
const cluster = getClusterWorker();
assert.equal(getClusterWorker(), cluster);
const expectedIds = [...new Set(articles.map(getArticleId))].sort();
for (const mode of ['incremental-hnsw', 'full-deterministic']) {
  const result = await new Promise((resolve, reject) => {
    const onMessage = message => {
      if (message.type === 'result' || message.type === 'error') {
        cluster.off('message', onMessage);
        message.type === 'error' ? reject(new Error(message.error)) : resolve(message.result);
      }
    };
    cluster.on('message', onMessage);
    cluster.postMessage({ type: 'cluster', mode, articles, existingClusters: [], embeddingCache });
  });
  const actualIds = [...new Set([...result.autoMergedClusters, ...result.ambiguousGroups].flatMap(group => group.articles.map(getArticleId)))].sort();
  assert.deepEqual(actualIds, expectedIds);
  assert.equal(getClusterWorker(), cluster);
}
const embedding = new Worker(new URL('../../smart-embedding-worker.js', import.meta.url), {
  type: 'module', ...boundedWorkerOptions(512)
});
for (const id of [101, 102]) {
  const pong = new Promise(resolve => embedding.once('message', resolve));
  embedding.postMessage({ type: 'ping', id });
  assert.deepEqual(await pong, { type: 'pong', id });
}
clearTimeout(timeout);
console.log('SMART_WORKER_PROBE_OK', JSON.stringify({ clusterThread: cluster.threadId, clusterJobs: 2,
  embeddingThread: embedding.threadId, embeddingPings: 2, replacements: 0, onlineAiCalls: 0 }));
// Exit the whole probe process. Production workers are never terminated and
// recreated in one process; the probe follows that same teardown boundary.
process.exit(0);
