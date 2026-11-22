import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForGeminiWebModel } from '../src/ai/gemini-web-model-readiness.js';

async function probe(snapshots) {
    let elapsed = 0;
    let reads = 0;
    let opens = 0;
    const result = await waitForGeminiWebModel({
        readState: async () => ({ models: snapshots[Math.min(reads++, snapshots.length - 1)] }),
        openMenu: async () => { opens++; },
        matches: model => model.name === '3.8 Flash',
        sleep: async ms => { elapsed += ms; },
        now: () => elapsed,
        timeoutMs: 600
    });
    return { ...result, elapsed, reads, opens };
}
const ready = { name: '3.8 Flash', disabled: false };

test('waits for requested model to become enabled after temporary-chat startup', async () => {
    const result = await probe([[], [{ ...ready, disabled: true }], [ready]]);
    assert.deepEqual(result.model, ready);
    assert.equal(result.elapsed, 400);
    assert.equal(result.opens, 3);
});

test('already available model does not incur a delay', async () => {
    assert.equal((await probe([[ready]])).elapsed, 0);
});

test('persistent disabled state times out without substituting an available model', async () => {
    const result = await probe([[{ name: '3.5 Flash-Lite', disabled: false }, { ...ready, disabled: true }]]);
    assert.equal(result.model.disabled, true);
    assert.equal(result.model.name, ready.name);
    assert.equal(result.elapsed, 600);
});

test('missing model times out and preserves visible options', async () => {
    const result = await probe([[{ name: '3.5 Flash-Lite', disabled: false }]]);
    assert.equal(result.model, undefined);
    assert.equal(result.state.models.length, 1);
    assert.equal(result.elapsed, 600);
});

test('explicit upgrade requirement fails immediately', async () => {
    const result = await probe([[{ ...ready, disabled: true, upsell: true }]]);
    assert.equal(result.elapsed, 0);
    assert.equal(result.model.upsell, true);
});
