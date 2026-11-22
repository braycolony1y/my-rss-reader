import test from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyGeminiError, createGeminiModelDiscovery, generateWithModelDiscovery,
    parseGeminiApiError, rankFlashModels, replacementModels
} from '../src/ai/gemini-model-discovery.js';

const overloadedBody = JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE',
    message: 'This model is currently experiencing high demand.\nSpikes are temporary.' } });
const list = [
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.9-flash-lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash-preview', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-4.0-flash', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.10-flash', supportedGenerationMethods: ['generateContent'] }
];

test('error text is one readable line with code and status', () => {
    const parsed = parseGeminiApiError(503, overloadedBody);
    assert.equal(parsed.text, 'This model is currently experiencing high demand. Spikes are temporary. (503 UNAVAILABLE)');
    assert.equal(parseGeminiApiError(500, 'plain failure').text, 'plain failure (500)');
});

test('classification separates removal from overload', () => {
    assert.equal(classifyGeminiError(503, overloadedBody), 'overloaded');
    assert.equal(classifyGeminiError(404, '{"error":{"code":404,"status":"NOT_FOUND","message":"models/x is not found"}}'), 'model-not-found');
    assert.equal(classifyGeminiError(400, '{"error":{"message":"model is not supported for generateContent"}}'), 'model-not-found');
    assert.equal(classifyGeminiError(400, '{}'), null);
});

test('ranking prefers newest plain numbered flash, then flash-latest, generateContent only', () => {
    assert.deepEqual(rankFlashModels(list), ['gemini-3.10-flash', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-latest', 'gemini-3.9-flash-lite']);
    assert.deepEqual(replacementModels(rankFlashModels(list), 'gemini-3.10-flash', 'overloaded'),
        ['gemini-3.8-flash', 'gemini-3.7-flash']);
    assert.deepEqual(replacementModels(['a'], 'b', null), []);
});

test('discovery is cached per key, sends the key only as a header, and honours the TTL', async () => {
    let calls = 0, clock = 0; const seen = [];
    const discovery = createGeminiModelDiscovery({
        now: () => clock, ttlMs: 1000,
        fetchImpl: async (url, init) => { calls++; seen.push({ url, init }); return { ok: true, json: async () => ({ models: list }) }; }
    });
    await discovery.candidates('k1'); await discovery.candidates('k1');
    assert.equal(calls, 1);
    await discovery.candidates('k2');
    assert.equal(calls, 2);
    clock = 2000; await discovery.candidates('k1');
    assert.equal(calls, 3);
    assert.ok(!seen[0].url.includes('k1'));
    assert.equal(seen[0].init.headers['x-goog-api-key'], 'k1');
});

const discoveryOf = ids => ({ candidates: async () => ids });
const failure = kind => Object.assign(new Error('Gemini HTTP'), { geminiKind: kind });

test('overloaded primary moves to the next flash model with bounded attempts and reports it', async () => {
    const tried = [];
    const result = await generateWithModelDiscovery({
        model: 'gemini-3.8-flash', prompt: 'p', options: {}, log: () => {},
        discovery: discoveryOf(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-latest', 'gemini-3.0-flash']),
        currentKey: () => 'k',
        generate: async (model, _p, options) => {
            tried.push([model, options.requestedModel]);
            if (model !== 'gemini-flash-latest') throw failure('overloaded');
            return { text: 'ok' };
        }
    });
    assert.deepEqual(tried.map(item => item[0]), ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-latest']);
    assert.equal(result.modelUsed, 'gemini-flash-latest');
    assert.equal(result.requestedModel, 'gemini-3.8-flash');
    assert.equal(result.modelFallback, true);
});

test('all replacements failing rethrows the original error; unclassified errors are not substituted', async () => {
    const original = failure('overloaded');
    let calls = 0;
    await assert.rejects(generateWithModelDiscovery({
        model: 'm', prompt: 'p', log: () => {}, discovery: discoveryOf(['a', 'b', 'c']), currentKey: () => 'k',
        generate: async () => { calls++; throw calls === 1 ? original : failure('overloaded'); }
    }), error => error === original);
    assert.equal(calls, 3);
    calls = 0;
    await assert.rejects(generateWithModelDiscovery({
        model: 'm', prompt: 'p', discovery: discoveryOf(['a']), currentKey: () => 'k',
        generate: async () => { calls++; throw new Error('auth'); }
    }), /auth/);
    assert.equal(calls, 1);
});

test('primary success keeps the requested model', async () => {
    const result = await generateWithModelDiscovery({
        model: 'm', prompt: 'p', discovery: discoveryOf([]), currentKey: () => 'k',
        generate: async () => ({ text: 'ok' })
    });
    assert.equal(result.modelUsed, 'm');
    assert.equal(result.modelFallback, undefined);
});

test('exotic and experimental model names are never ranked', () => {
    const names = ['gemini-3.8-flash-live', 'gemini-3.8-flash-image', 'gemini-3.8-flash-001', 'gemini-3.8-flash-omni',
        'gemini-robotics-er-1.5-flash', 'gemini-2.5-computer-use-preview', 'deep-research-pro', 'gemma-3-27b-it',
        'gemini-4-argon', 'gemini-3.8-flash-antigravity', 'gemini-3.8-flash-lite', 'gemini-3.8-flash'];
    assert.deepEqual(rankFlashModels(names.map(name => ({ name: 'models/' + name }))), ['gemini-3.8-flash', 'gemini-3.8-flash-lite']);
});

test('timeouts, quota and 5xx errors are fallback triggers', () => {
    assert.equal(classifyGeminiError(429, '{"error":{"status":"RESOURCE_EXHAUSTED","message":"quota"}}'), 'quota');
    for (const code of [500, 502, 504]) assert.equal(classifyGeminiError(code, '{}'), 'server-error');
    assert.equal(classifyGeminiError(400, '{}'), null);
});

test('timeout of the primary model falls back to the next discovered model', async () => {
    const tried = [];
    const result = await generateWithModelDiscovery({
        model: 'gemini-3.8-flash', prompt: 'p', log: () => {}, currentKey: () => 'k',
        discovery: discoveryOf(['gemini-3.8-flash', 'gemini-3.7-flash']),
        generate: async model => { tried.push(model); if (model === 'gemini-3.8-flash') throw failure('timeout'); return { text: 'ok' }; }
    });
    assert.deepEqual(tried, ['gemini-3.8-flash', 'gemini-3.7-flash']);
    assert.equal(result.modelUsed, 'gemini-3.7-flash');
});

test('auto-select uses the best discovered model; discovery failure keeps the configured one; override is not auto-selected', async () => {
    const used = [];
    const generate = async model => { used.push(model); return { text: 'ok' }; };
    const base = { model: 'gemini-3.8-flash', prompt: 'p', currentKey: () => 'k', generate };
    assert.equal((await generateWithModelDiscovery({ ...base, autoSelect: true, discovery: discoveryOf(['gemini-3.9-flash', 'gemini-3.8-flash']) })).modelUsed, 'gemini-3.9-flash');
    assert.equal((await generateWithModelDiscovery({ ...base, autoSelect: true, discovery: { candidates: async () => { throw new Error('net'); } } })).modelUsed, 'gemini-3.8-flash');
    assert.equal((await generateWithModelDiscovery({ ...base, autoSelect: false, discovery: discoveryOf(['gemini-3.9-flash']) })).modelUsed, 'gemini-3.8-flash');
});

test('a discovery outage is negatively cached', async () => {
    let calls = 0;
    const discovery = createGeminiModelDiscovery({ now: () => 0, fetchImpl: async () => { calls++; throw new Error('offline'); } });
    assert.deepEqual(await discovery.candidates('k'), []);
    assert.deepEqual(await discovery.candidates('k'), []);
    assert.equal(calls, 1);
});
