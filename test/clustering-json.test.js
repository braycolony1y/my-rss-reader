import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClusteringJson, requestClusteringDecision } from '../src/ai/clustering-json.js';
import { validatePartitionResult, getArticleId } from '../smart-news.js';
const article = { link: 'https://fixture.test/1' };
const decision = { clusters: [{ articleIds: [getArticleId(article)] }], uncertain: false };
const json = JSON.stringify(decision);
const validate = value => validatePartitionResult(value, [article]);
const totals = {};
function fixture(responses) {
  const prompts = [], counts = {};
  return { prompts, counts, run: () => requestClusteringDecision({
    request: async prompt => { prompts.push(prompt); const value = responses.shift(); if (value instanceof Error) throw value; return value; },
    validate, schema: { type: 'object', required: ['clusters', 'uncertain'] },
    onEvent: event => { counts[event] = (counts[event] || 0) + 1; totals[event] = (totals[event] || 0) + 1; }
  }) };
}
for (const [name, raw, event] of [
  ['J valid JSON', json, 'firstPassValidJson'],
  ['K Markdown fences', '```json\n' + json + '\n```', 'markdownFenceRecoveries'],
  ['L harmless prose', 'Here is the result:\n' + json + '\nDone.', 'safeExtractionRecoveries']
]) test(name, async () => {
  const f = fixture([raw]); assert.deepEqual(await f.run(), decision);
  assert.equal(f.prompts.length, 1); assert.equal(f.counts[event], 1); assert.equal(f.counts.repairAttempts || 0, 0);
});
test('M/N malformed JSON gets exactly one formatting-only repair', async () => {
  const f = fixture(['{"clusters": [', json]); assert.deepEqual(await f.run(), decision);
  assert.equal(f.prompts.length, 2); assert.equal(f.counts.repairSuccesses, 1);
  assert.match(f.prompts[1], /SAME decision/); assert.match(f.prompts[1], /Schema:/);
  assert.equal(f.counts.firstPassInvalidJson, 1);
});
test('O invalid repair stops after two calls, even on a repair transport failure', async () => {
  for (const bad of ['invalid', new Error('timeout')]) {
    const f = fixture(['invalid', bad, json]);
    await assert.rejects(f.run(), error => error.repairAttempted === true);
    assert.equal(f.prompts.length, 2); assert.equal(f.counts.repairFailures, 1);
  }
});
test('schema-invalid decisions require repair and cannot be accepted', async () => {
  for (const bad of ['[]', '{"clusters":[]}', '{"clusters":[{"articleIds":["unknown"]}],"uncertain":false}', JSON.stringify({...decision, unexpected: true})]) {
    const f = fixture([bad, bad]); await assert.rejects(f.run()); assert.equal(f.counts.repairAttempts, 1);
  }
});
test('parser rejects multiple roots, truncation, mismatched brackets and syntax guessing', () => {
  for (const bad of [json + json, 'text {"a": [1}', '{"a":', '{"a": 1,}', '']) assert.throws(() => parseClusteringJson(bad), { code: 'INVALID_JSON' });
  assert.deepEqual(parseClusteringJson('result {"text":"escaped \\\" } [ inside string"} done'), {text:'escaped " } [ inside string'});
});
test('JSON acceptance diagnostic totals', () => console.log('JSON_ACCEPTANCE_COUNTS', JSON.stringify(totals)));
