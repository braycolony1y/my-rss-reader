import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachBroaderStoryMetadata,
  buildComponentReviewUnits,
  expandComponentReviewDecision,
  getArticleId,
  normalizeAntigravityClusteringOutput,
  validateComponentReviewResult,
  verifyWithProviderChain
} from '../smart-news.js';

const article = (n, title, date) => ({
  link: `https://example.com/${n}`,
  title,
  pubDate: date,
  feedTitle: `Source ${n}`,
  smartCategory: 'news_world',
  feedCategory: 'news_world',
  language: 'en',
  sourceWeight: 1,
  content: `${title}. Factual source text for component ${n}.`
});

test('oversized review compresses deterministic components and separates exact-event merges from broader-story links', () => {
  const a1 = article('a1', 'Company announces acquisition', '2026-09-10T10:00:00Z');
  const a2 = article('a2', 'Company confirms acquisition agreement', '2026-09-10T10:05:00Z');
  const b1 = article('b1', 'Regulator opens review of acquisition', '2026-09-11T10:00:00Z');
  const c1 = article('c1', 'Shareholders approve acquisition', '2026-09-13T10:00:00Z');
  const d1 = article('d1', 'Unrelated weather report', '2026-09-13T11:00:00Z');
  const group = {
    fullRepartition: true,
    articles: [a1,a2,b1,c1,d1],
    reviewUniverse: [a1,a2,b1,c1,d1],
    deferredComponents: [[a1,a2],[b1],[c1],[d1]]
  };
  const units = buildComponentReviewUnits(group);
  assert.equal(units.length, 4);
  const [a,b,c,d] = units;
  const decision = {
    exactEventGroups: [
      {componentIds:[a.id],confidence:.99},
      {componentIds:[b.id],confidence:.99},
      {componentIds:[c.id],confidence:.99},
      {componentIds:[d.id],confidence:.99}
    ],
    relatedDevelopments: [
      {componentIds:[a.id,b.id],confidence:.97},
      {componentIds:[b.id,c.id],confidence:.96}
    ],
    uncertain: false
  };
  assert.deepEqual(validateComponentReviewResult(decision, units), {valid:true,reason:null});
  const expanded = expandComponentReviewDecision(decision, units);
  assert.equal(expanded.clusters.length, 4);
  assert.equal(expanded.storyRelationships.length, 2);
});

test('broader-story metadata preserves separate events while exposing a full connected timeline', () => {
  const a = article('event-a', 'Company announces acquisition', '2026-09-10T10:00:00Z');
  const b = article('event-b', 'Regulator opens review of acquisition', '2026-09-11T10:00:00Z');
  const c = article('event-c', 'Deal receives final approval', '2026-09-20T10:00:00Z');
  const clusters = [a,b,c].map((item,index) => ({...item,clusterId:`cluster-${index}`,isCluster:true,relatedArticles:[],sourceCount:1}));
  const linked = attachBroaderStoryMetadata(clusters, [
    {type:'related_development',confidence:.97,leftArticleIds:[getArticleId(a)],rightArticleIds:[getArticleId(b)]},
    {type:'related_development',confidence:.96,leftArticleIds:[getArticleId(b)],rightArticleIds:[getArticleId(c)]}
  ]);
  assert.equal(linked[0].clusterCount, undefined);
  assert.equal(linked[0].broaderStory.events.length, 3);
  assert.deepEqual(linked[0].broaderStory.events.map(event=>event.title), [
    'Company announces acquisition',
    'Regulator opens review of acquisition',
    'Deal receives final approval'
  ]);
  assert.equal(linked[0].clusterId, 'cluster-0');
  assert.equal(linked[1].clusterId, 'cluster-1');
});


test('Antigravity duplicate roots with identical membership ignore optional confidence metadata', () => {
  const raw = [
    '```json',
    '{"clusters":[{"articleIds":["a"]},{"articleIds":["b"]}],"uncertain":false}',
    '```',
    '{"clusters":[{"articleIds":["a"],"confidence":1},{"articleIds":["b"],"confidence":0.99}],"toolAction":"done","toolSummary":"done","uncertain":false}'
  ].join('\n');
  const normalized = JSON.parse(normalizeAntigravityClusteringOutput(raw));
  assert.deepEqual(normalized.clusters.map(cluster => cluster.articleIds), [['a'], ['b']]);
  assert.deepEqual(normalized.clusters.map(cluster => cluster.confidence), [1, 0.99]);
  assert.equal(normalized.uncertain, false);
});

test('ordinary provider failure is deferred conservatively instead of aborting clustering', async () => {
  const a = article('defer-a', 'Company event report A', '2026-09-14T10:00:00Z');
  const b = article('defer-b', 'Company event report B', '2026-09-14T10:05:00Z');
  const store = new Map();
  const db = {
    async get(key, options = {}) {
      const value = store.get(key);
      if (options?.type === 'json' && typeof value === 'string') {
        try { return JSON.parse(value); } catch { return null; }
      }
      return value ?? null;
    },
    async put(key, value) { store.set(key, value); }
  };
  const provider = {
    id: 'local-fixture',
    type: 'ollama',
    model: 'missing-fixture',
    baseUrl: 'http://fixture.invalid',
    timeoutMs: 1000,
    maxRetries: 0
  };
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async url => {
    requestedUrls.push(String(url));
    if (String(url).endsWith('/api/tags')) {
      return new Response('{"models":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error('Local chat request should be skipped when the model is absent');
  };
  try {
    const result = await verifyWithProviderChain(
      { id: 'fixture-group', articles: [a, b], forceRebuild: true },
      [provider],
      null,
      db
    );
    assert.equal(result.resolution, 'deferred');
    assert.equal(result.fallbackReason, 'all_providers_failed_or_uncertain');
    assert.deepEqual(result.clusters, []);
    assert.equal(requestedUrls.length, 1);
    assert.ok(requestedUrls[0].endsWith('/api/tags'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
