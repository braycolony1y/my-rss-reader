import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as smart from '../smart-news.js';
import * as embeddings from '../src/smart/embeddings/index.js';
import * as worker from '../src/smart/clustering/worker-client.js';
import * as cache from '../src/smart/verification/cache.js';
import * as health from '../src/smart/verification/provider-health.js';
import * as coordination from '../src/smart/refresh/coordination.js';
import { smartModuleFiles } from './helpers/smart-source.js';

test('private workers, caches, write chains and refresh state are not module exports', () => {
  for (const owner of [smart, embeddings, worker, cache, health, coordination]) {
    for (const name of ['embeddingWorker', 'embeddingCache', 'workerPromises', 'workerMsgId', 'clusterWorker',
      'providerHealthWriteChain', 'verificationCacheWriteChain', 'activeSmartEngineRefreshes']) {
      assert.equal(name in owner, false, name);
    }
  }
});

test('Smart facade and feature owners stay bounded and import without spawning workers', async () => {
  assert.ok((await readFile(new URL('../smart-news.js', import.meta.url), 'utf8')).split('\n').length < 100);
  let constructors = 0;
  for (const file of smartModuleFiles()) {
    const source = await readFile(file, 'utf8');
    assert.ok(source.split('\n').length <= 1000, file.pathname);
    constructors += [...source.matchAll(/\bnew Worker\(/g)].length;
  }
  assert.equal(constructors, 2);
});

test('partition and component decisions share one serialized cache writer', async () => {
  const values = {};
  const db = {
    get: async key => {
      await new Promise(resolve => setImmediate(resolve));
      return values[key] ? JSON.parse(values[key]) : null;
    },
    put: async (key, value) => {
      await new Promise(resolve => setImmediate(resolve));
      values[key] = value;
    }
  };
  const articles = Array.from({ length: 8 }, (_, index) => ({
    articleKey: `https://fixture.test/${index}`, link: `https://fixture.test/${index}`,
    title: 'Separate event ' + index, pubDate: '2026-10-02T02:00:00Z', language: 'en'
  }));
  const provider = { id: 'fixture', type: 'fixture', model: 'fixture' };
  await Promise.all(articles.map(async (article, index) => {
    const group = { articles: [article] };
    if (index % 2) {
      const units = smart.buildComponentReviewUnits(group);
      await cache.setCachedComponentVerificationDecision(db, group, units, {
        exactEventGroups: [{ componentIds: [units[0].id], confidence: 1 }], relatedDevelopments: [], uncertain: false
      }, provider);
      assert.ok(await cache.getCachedComponentVerificationDecision(db, group, units));
    } else {
      await smart.setCachedVerificationDecision(db, group, [], {
        clusters: [{ articleIds: [smart.getArticleId(article)] }], uncertain: false, providerId: provider.id, model: provider.model
      });
      assert.ok(await smart.getCachedVerificationDecision(db, group, []));
    }
  }));
  assert.equal(Object.keys(JSON.parse(values.smartEventVerificationCache)).length, articles.length);
  await Promise.all(articles.map((_article, index) => health.recordProviderAttempt(db, { ...provider, id: 'provider-' + index })));
  assert.equal(Object.keys(JSON.parse(values.smartAiProviderHealth)).length, articles.length);
});

test('foreground refresh leases release independently across engine instances', () => {
  assert.equal(coordination.isSmartRefreshActive(), false);
  coordination.beginSmartRefresh();
  coordination.beginSmartRefresh();
  coordination.endSmartRefresh();
  assert.equal(coordination.isSmartRefreshActive(), true);
  coordination.endSmartRefresh();
  coordination.endSmartRefresh();
  assert.equal(coordination.isSmartRefreshActive(), false);
});
