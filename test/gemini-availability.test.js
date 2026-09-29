import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireGeminiKey, geminiUnavailableError } from '../src/ai/gemini-availability.js';
import { verifyWithProviderChain } from '../smart-news.js';

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

test('smart clustering skips cooled-down or absent keys without failed API activity', async () => {
    const originalFetch = globalThis.fetch;
    const originalLog = console.log;
    const logs = [];
    globalThis.fetch = async () => assert.fail('No API call should be made');
    console.log = (...args) => logs.push(args);
    try {
        for (const keys of [[{ status: 'Rate Limited', cooldownUntil: deadline() }], []]) {
            const store = new Map();
            const db = {
                get: async key => store.get(key) ?? null,
                put: async (key, value) => store.set(key, JSON.parse(value))
            };
            const result = await verifyWithProviderChain({
                id: 'key-availability-regression', forceRebuild: true,
                articles: [1, 2].map(i => ({ link: `https://example.com/${i}`, title: `Story ${i}`, pubDate: new Date().toISOString() }))
            }, [{ id: 'gemini-fixture', type: 'gemini', model: 'fixture', maxRetries: 0 }], {
                keys, getCurrentKeyObj: () => null,
                waitForRateSlot: () => assert.fail('Do not wait when no key is available'),
                recordUsage: () => assert.fail('Do not record nonexistent usage'),
                reportError: () => assert.fail('Do not penalize an unused key')
            }, db);
            assert.equal(result.resolution, 'deferred');
            const health = store.get('smartAiProviderHealth')?.['gemini-fixture'];
            assert.ok(!health?.consecutiveFailures);
            if (keys.length) assert.equal(health?.status, 'cooldown');
        }
        assert.equal(logs.filter(args => args[0] === '[ONLINE AI]').length, 0);
    } finally {
        globalThis.fetch = originalFetch;
        console.log = originalLog;
    }
});
