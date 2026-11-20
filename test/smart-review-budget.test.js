import test from 'node:test';
import assert from 'node:assert/strict';
import { getArticleId, createGroupId } from '../src/smart/articles/identity.js';
import { reviewAmbiguousEventGroups, reviewTimeBudgetMs } from '../src/smart/clustering/review.js';
import { prepareIncrementalReviewGroups, deferredReviewPartitions } from '../src/smart/clustering/review-groups.js';
import { buildPublicationClusterSnapshot } from '../src/smart/clustering/publication-snapshot.js';
import { canReuseSmartSnapshot } from '../src/smart/refresh/reuse-policy.js';
import { runGlobalAiTask } from '../src/ai/global-ai-scheduler.js';

const makeArticle = n => ({
  articleKey: `https://fixture${n}.test/story`, link: `https://fixture${n}.test/story`,
  title: `NASA launches Artemis rocket number ${n}`,
  content: `NASA launched the Artemis rocket ${n} from Kennedy Space Center on Monday.`,
  pubDate: '2026-11-20T00:00:00.000Z', language: 'en', smartCategory: 'tech', feedTitle: 'Fixture'
});
function memoryDb() {
  const values = {};
  return { values, get: async key => values[key] ?? null,
    put: async (key, value) => { values[key] = typeof value === 'string' ? JSON.parse(value) : value; } };
}
const providers = [{ id: 'fixture', type: 'ollama', model: 'fixture', baseUrl: 'http://fixture', timeoutMs: 1000, maxRetries: 0 }];
const makeGroup = (ids, label) => ({ id: label, articles: ids.map(makeArticle), reviewUniverse: ids.map(makeArticle) });

async function withFetch(counter, fn) {
  const original = global.fetch;
  global.fetch = async (_url, options) => {
    counter.calls++;
    const body = JSON.parse(options.body);
    const text = body.messages.map(message => message.content).join('\n');
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => getArticleId(makeArticle(n))).filter(id => text.includes(id));
    return { ok: true, json: async () => ({ message: { content: JSON.stringify({
      clusters: ids.map(id => ({ articleIds: [id] })), uncertain: false }) } }) };
  };
  try { return await fn(); } finally { global.fetch = original; }
}

test('scheduler runs cluster verification before queued story briefings, then briefings resume', async () => {
  const order = [];
  const release = [];
  const blocker = label => runGlobalAiTask({ lane: 'p4', label }, () => new Promise(resolve => release.push(resolve)));
  const blockers = [blocker('b1'), blocker('b2')];
  const briefing = runGlobalAiTask({ lane: 'p4', background: true, label: 'briefing' }, async () => { order.push('briefing'); });
  const verification = runGlobalAiTask({ lane: 'p3', priority: 1, background: true, label: 'verify' }, async () => { order.push('verification'); });
  await new Promise(resolve => setImmediate(resolve));
  release.shift()();
  await verification;
  assert.deepEqual(order, ['verification']);
  release.shift()();
  await briefing;
  await Promise.all(blockers);
  assert.deepEqual(order, ['verification', 'briefing']);
});

test('resume: verified groups are reused across runs by content key, not group id', async () => {
  const db = memoryDb();
  const counter = { calls: 0 };
  await withFetch(counter, async () => {
    const run1 = await reviewAmbiguousEventGroups([makeGroup([1, 2], 'run1-a'), makeGroup([3, 4], 'run1-b')], providers, null, db, null, null, { timeBudgetMs: 0 });
    assert.equal(run1.ambiguousGroupsVerified, 2);
    const callsPerGroup = counter.calls / 2;
    assert.ok(callsPerGroup >= 1);
    // Restart: new group ids, one group changed (extra article), one unchanged.
    const run2 = await reviewAmbiguousEventGroups([makeGroup([3, 4], 'run2-x'), makeGroup([1, 2, 5], 'run2-y')], providers, null, db, null, null, { timeBudgetMs: 0 });
    assert.equal(run2.ambiguousGroupsFromCache, 1);
    assert.equal(run2.ambiguousGroupsVerified, 1);
    assert.equal(counter.calls, callsPerGroup * 3);
    assert.deepEqual(run2.groupResults.map(result => result.resolution), ['cached', 'verified']);
  });
});

function partialScenario() {
  const articles = [1, 2, 3, 4, 5, 6].map(makeArticle);
  const automatic = articles.map(article => ({ articles: [article], established: false }));
  const requests = [
    { id: 'g1', articles: [articles[0], articles[1]], fullRepartition: false },
    { id: 'g2', articles: [articles[2], articles[3]], fullRepartition: false },
    { id: 'g3', articles: [articles[4], articles[5]], fullRepartition: false }
  ];
  const reviewGroups = prepareIncrementalReviewGroups(requests, automatic);
  return { articles, automatic, reviewGroups };
}

test('time budget stops new verifications, defers the rest, and the final snapshot passes membership validation', async () => {
  const { articles, automatic, reviewGroups } = partialScenario();
  const db = memoryDb();
  const counter = { calls: 0 };
  let clock = 0;
  const progress = [];
  await withFetch(counter, async () => {
    const result = await reviewAmbiguousEventGroups(reviewGroups, providers, null, db,
      update => progress.push(update), async () => { clock += 600; },
      { timeBudgetMs: 1000, now: () => clock });
    assert.equal(result.timeBudget.reached, true);
    assert.ok(counter.calls > 0);
    assert.equal(result.ambiguousGroupsVerified, 2);
    assert.equal(result.ambiguousGroupsDeferred, 1);
    assert.equal(result.timeBudget.verifiedGroups, 2);
    assert.equal(result.timeBudget.deferredGroups, 1);
    assert.equal(result.deferredGroups[0].reason, 'time_budget');
    assert.ok(progress.some(update => update.reviewResolution === 'time_budget'));
    const snapshot = buildPublicationClusterSnapshot({
      candidates: articles, autoMergedClusters: automatic, reviewedClusters: result.clusters,
      reviewGroups, clusterVersionChanged: false, existingClusters: [], isTargeted: false,
      storyIdRetentionClusters: [], storyRelationships: []
    });
    assert.equal(snapshot.clusters.length, 6);
  });
});

test('partial verification with full-repartition groups still publishes every article exactly once', async () => {
  const articles = [1, 2, 3, 4].map(makeArticle);
  const automatic = [
    { articles: [articles[0], articles[1]], established: true },
    { articles: [articles[2], articles[3]], established: true }
  ];
  const reviewGroups = prepareIncrementalReviewGroups(
    [{ id: 'x', articles: [articles[0], articles[2]] }, { id: 'y', articles: [articles[1], articles[3]] }], automatic);
  assert.ok(reviewGroups.length >= 1 && reviewGroups[0].fullRepartition);
  const result = await reviewAmbiguousEventGroups(reviewGroups, providers, null, memoryDb(), null, null,
    { timeBudgetMs: 1, now: (() => { let t = 0; return () => (t += 10); })() });
  assert.equal(result.timeBudget.reached, true);
  const snapshot = buildPublicationClusterSnapshot({
    candidates: articles, autoMergedClusters: automatic, reviewedClusters: result.clusters,
    reviewGroups, clusterVersionChanged: false, existingClusters: [], isTargeted: false,
    storyIdRetentionClusters: [], storyRelationships: []
  });
  const ids = snapshot.clusters.flatMap(cluster => [cluster, ...(cluster.relatedArticles || [])].map(getArticleId));
  assert.equal(new Set(ids).size, 4);
  assert.equal(ids.length, 4);
});

test('deferred partitions stay disjoint when stored and current components overlap', () => {
  const [a, b, c] = [1, 2, 3].map(makeArticle);
  const partitions = deferredReviewPartitions({ id: 'g', articles: [a, b, c], deferredComponents: [[a, b], [a], [c]] }, 'time_budget');
  const ids = partitions.flatMap(partition => partition.articles.map(getArticleId));
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
});

test('time-budget deferrals force the next run to retry; budget env parsing', async () => {
  const db = { get: async key => key === 'smartDeferredReviewGroups' ? { groups: [{ reason: 'time_budget' }] }
    : key === 'smartClusteringAlgorithmVersion' ? 'x' : null };
  assert.equal(await canReuseSmartSnapshot({ forceRebuild: false, currentSignature: 's', previousSignature: 's',
    previousAiConfiguration: 'c', aiConfiguration: 'c', db }), false);
  assert.equal(reviewTimeBudgetMs({}), 25 * 60 * 1000);
  assert.equal(reviewTimeBudgetMs({ SMART_REVIEW_TIME_BUDGET_MS: '5000' }), 5000);
});
