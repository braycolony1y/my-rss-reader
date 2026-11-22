import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireGeminiKey, geminiUnavailableError } from '../src/ai/gemini-availability.js';

const deadline = () => Date.now() + 60 * 60 * 1000;
test('Gemini key cooldown is distinct from missing configuration', () => {
    const until = deadline();
    const error = geminiUnavailableError({ keys: [{ status: 'Rate Limited', cooldownUntil: until }] });
    assert.equal(error.code, 'GEMINI_COOLDOWN');
    assert.equal(error.cooldownUntil, new Date(until).toISOString());
    assert.equal(error.skipProvider, true);
    assert.equal(geminiUnavailableError({ keys: [] }).code, 'NOT_CONFIGURED');
});

test('Gemini key availability is checked again after the rate wait', async () => {
    let available = true;
    const key = { key: 'fixture', status: 'Active' };
    const manager = {
        keys: [key],
        getCurrentKeyObj: () => available ? key : null,
        waitForRateSlot: async () => { available = false; key.status = 'Rate Limited'; key.cooldownUntil = deadline(); }
    };
    await assert.rejects(acquireGeminiKey(manager, 1000), error => error.code === 'GEMINI_COOLDOWN' && error.skipProvider);
    available = true;
    manager.waitForRateSlot = async () => {};
    assert.equal(await acquireGeminiKey(manager, 1000), key);
});

