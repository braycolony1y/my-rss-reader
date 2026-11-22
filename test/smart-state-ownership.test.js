import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as smart from '../smart-news.js';
import * as embeddings from '../src/smart/embeddings/index.js';
import * as worker from '../src/smart/clustering/worker-client.js';
import * as coordination from '../src/smart/refresh/coordination.js';
import { smartModuleFiles } from './helpers/smart-source.js';

test('private workers, caches, write chains and refresh state are not module exports', () => {
  for (const owner of [smart, embeddings, worker, coordination]) {
    for (const name of ['embeddingWorker', 'embeddingCache', 'workerPromises', 'workerMsgId', 'clusterWorker',
      'activeSmartEngineRefreshes']) {
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
