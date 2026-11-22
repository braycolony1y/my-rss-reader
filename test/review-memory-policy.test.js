import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewMemoryPolicy } from '../src/smart/verification/memory-policy.js';
import { canReuseSmartSnapshot } from '../src/smart/refresh/reuse-policy.js';
import { SMART_CLUSTER_VERSION } from '../src/smart/config.js';
import { EMBEDDING_MODEL, EMBEDDING_CACHE_VERSION } from '../src/smart/embeddings/config.js';
const MB = 1048576;

function fixture({ heapMB = 1800, usedMB = 3200, hardCapMB = Infinity } = {}) {
    const state = { heapMB, usedMB, collections: 0, at: 0, onCollection: null };
    const policy = createReviewMemoryPolicy({ memory: () => ({ heapUsed: state.heapMB * MB, rss: state.usedMB * MB }),
        budget: () => ({ used: state.usedMB * MB, limit: 5120 * MB }), heapLimit: () => 3072 * MB,
        hardCapMB, now: () => state.at, report() {}, collect: () => { state.collections++; state.onCollection?.(); } });
    return { state, policy };
}
test('a normal retained corpus above the obsolete 1400 MB threshold still receives AI review', () => {
    const { state, policy } = fixture();
    assert.equal(policy.check().defer, false); assert.equal(state.collections, 0);
});
test('real V8/cgroup pressure is collected at the lifecycle boundary, then rechecked', () => {
    const { state, policy } = fixture({ heapMB: 2900, usedMB: 4900 });
    state.onCollection = () => { state.heapMB = 2100; state.usedMB = 4100; };
    const result = policy.check();
    assert.equal(result.defer, false); assert.equal(state.collections, 1);
});
test('a scarce budget defers only until capacity recovers and does not latch the whole run', () => {
    const { state, policy } = fixture({ usedMB: 4900 });
    assert.equal(policy.check().defer, true); assert.equal(state.collections, 1);
    state.at = 1000; assert.equal(policy.check().defer, true); assert.equal(state.collections, 1);
    state.usedMB = 3500; assert.equal(policy.check().defer, false);
    state.usedMB = 4900; state.at = 61000; assert.equal(policy.check().defer, true); assert.equal(state.collections, 2);
});
test('an intentionally configured hard heap cap remains effective', () => {
    const { policy } = fixture({ hardCapMB: 1400 });
    assert.equal(policy.check().defer, true);
});
test('unlimited/unavailable cgroup limits still allow safe heap-sized review', () => {
    const policy = createReviewMemoryPolicy({ memory: () => ({ heapUsed: 1600 * MB }),
        budget: () => ({ used: 3000 * MB, limit: Infinity }), heapLimit: () => 3072 * MB,
        hardCapMB: Infinity, collect: () => assert.fail('No collection is needed') });
    assert.equal(policy.check().defer, false);
});

test('unchanged input retries durable memory-deferred review instead of reporting completed work', async () => {
    const values = { smartClusteringAlgorithmVersion: SMART_CLUSTER_VERSION,
        smartEmbeddingIdentity: `${EMBEDDING_MODEL}:${EMBEDDING_CACHE_VERSION}`,
        smartDeferredReviewGroups: { groups: [{ id: 'pending', reason: 'memory_pressure' }] } };
    const args = { currentSignature: 'same', previousSignature: 'same', previousAiConfiguration: 'config',
        aiConfiguration: 'config', db: { get: async key => values[key] } };
    assert.equal(await canReuseSmartSnapshot(args), false);
    assert.equal(values.smartDeferredReviewGroups.groups.length, 1, 'pending durable state is retained');
    values.smartDeferredReviewGroups.groups = [];
    assert.equal(await canReuseSmartSnapshot(args), true);
    assert.equal(await canReuseSmartSnapshot({ ...args, forceRebuild: true }), false);
    assert.equal(await canReuseSmartSnapshot({ ...args, currentSignature: 'changed' }), false);
});
test('unchanged completed snapshots retain algorithm and embedding identity checks', async () => {
    const values = { smartClusteringAlgorithmVersion: 'older', smartEmbeddingIdentity: `${EMBEDDING_MODEL}:${EMBEDDING_CACHE_VERSION}` };
    const args = { currentSignature: 'same', previousSignature: 'same', previousAiConfiguration: 'config',
        aiConfiguration: 'config', db: { get: async key => values[key] } };
    assert.equal(await canReuseSmartSnapshot(args), false);
    values.smartClusteringAlgorithmVersion = SMART_CLUSTER_VERSION;
    values.smartEmbeddingIdentity = 'older-model';
    assert.equal(await canReuseSmartSnapshot(args), false);
});
