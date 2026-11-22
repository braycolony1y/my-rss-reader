import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as smart from '../smart-news.js';
import { captureSmartContract } from './helpers/smart-refactor-contract.js';

test('Smart modules preserve the original six-destination golden contract', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/smart-refactor/input.json', import.meta.url), 'utf8'));
  const expected = JSON.parse(await readFile(new URL('./fixtures/smart-refactor/expected.json', import.meta.url), 'utf8'));
  assert.deepEqual(await captureSmartContract(smart, fixture), expected);
});
