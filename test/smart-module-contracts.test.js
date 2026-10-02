import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as smart from '../smart-news.js';
import * as config from '../src/smart/config.js';
import * as embeddings from '../src/smart/embeddings/config.js';
import * as text from '../src/smart/text/normalize.js';
import * as dates from '../src/smart/dates/publication-time.js';
import * as sources from '../src/smart/sources/normalize.js';
import * as cache from '../src/smart/verification/cache.js';
import { assertSmartImportGraphAcyclic } from './helpers/smart-import-graph.js';
import { capturePrivateSmartContract, captureSmartRuntimeContract } from './helpers/smart-runtime-contract.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/smart-refactor/input.json', import.meta.url), 'utf8'));
const expected = JSON.parse(await readFile(new URL('./fixtures/smart-refactor/runtime-expected.json', import.meta.url), 'utf8'));

test('configuration, text, dates, source normalization and component keys match the original implementation', () => {
  assert.deepEqual(capturePrivateSmartContract({ ...smart, ...config, ...embeddings, ...text, ...dates, ...sources, ...cache }, fixture), expected.private);
});

test('refresh, editorial routing, persistence, notifications and unchanged reuse match the original engine', async () => {
  const result = await captureSmartRuntimeContract(smart, fixture);
  assert.deepEqual(result, expected.refresh);
  assert.equal(result.workerMessages.length, 1);
  assert.equal(result.second.skipped, true);
  assert.ok(result.requests.length > 0);
  assert.ok(result.first.metrics.editorialAssessed > 0);
});

test('Smart dependencies, including the compatibility facade, have no import cycles', () => {
  assert.ok(assertSmartImportGraphAcyclic() > 0);
});

test('progressive publication and verified updates preserve original ordering and final retirement', async () => {
  const result = await captureSmartRuntimeContract(smart, fixture, { ambiguous: true });
  assert.deepEqual(result, expected.progressive);
  assert.ok(result.notifications.some(progress => progress.publicationPhase === 'deterministic_base'));
  assert.ok(result.notifications.some(progress => progress.publicationPhase === 'progressive_review_update'));
  assert.equal(result.stored.smartProgressivePublication, null);
  assert.equal(result.stored.smartProgressiveClusterState.active, false);
});
