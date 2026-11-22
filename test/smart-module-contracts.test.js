import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSmartImportGraphAcyclic } from './helpers/smart-import-graph.js';

test('Smart dependencies, including the compatibility facade, have no import cycles', () => {
  assert.ok(assertSmartImportGraphAcyclic() > 0);
});
