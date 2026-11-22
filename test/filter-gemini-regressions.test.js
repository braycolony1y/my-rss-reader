import { readReaderClientSource } from './helpers/reader-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { waitForResponse } from '../src/ai/gemini-web.js';
import { runGlobalAiTask, setGlobalAiReadingMode } from '../src/ai/global-ai-scheduler.js';
import { registerContentFilterRoutes } from '../src/routes/content-filter-routes.js';

const script = readReaderClientSource();
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const response = keywords => ({ ok: true, json: async () => ({ keywords }) });
function reader(t) {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://reader.test', runScripts: 'outside-only', pretendToBeVisual: true });
    dom.window.fetch = async () => response([]);
    dom.window.eval(script);
    t.after(() => dom.window.close());
    const app = dom.window.rssApp();
    app.fetchData = async () => {};
    return { app, window: dom.window };
}

test('first filter modal opening hydrates from the startup request without reopening', async t => {
    const { app, window } = reader(t);
    const gate = deferred(); let requests = 0;
    window.fetch = () => { requests++; return gate.promise; };
    const startup = app.fetchContentFilterSettings();
    app.openContentFilterSettings();
    assert.equal(app.contentFilterLoading, true);
    gate.resolve(response(['saved keyword']));
    await startup;
    assert.equal(requests, 1);
    assert.deepEqual([...app.blockedKeywordsDraft], ['saved keyword']);
    assert.equal(app.contentFilterSettingsOpen, true);
});

test('filter save waits for acknowledgement, rejects duplicate saves, and survives a reload', async t => {
    const { app, window } = reader(t);
    const gate = deferred(); let writes = 0; let stored = ['old'];
    app.contentFilterLoaded = true;
    app.blockedKeywords = ['old'];
    app.openContentFilterSettings();
    app.blockedKeywordsDraft = ['new'];
    window.fetch = async (_url, options) => {
        writes++;
        await gate.promise;
        stored = JSON.parse(options.body).keywords;
        return response(stored);
    };
    const saving = app.saveContentFilterSettings();
    await app.saveContentFilterSettings();
    assert.equal(writes, 1);
    assert.equal(app.savingContentFilter, true);
    assert.equal(app.contentFilterSettingsOpen, true);
    assert.deepEqual([...app.blockedKeywords], ['old']);
    gate.resolve(); await saving;
    assert.equal(app.contentFilterSettingsOpen, false);
    const reloaded = reader(t);
    reloaded.window.fetch = async () => response(stored);
    reloaded.app.openContentFilterSettings();
    await reloaded.app.contentFilterLoadPromise;
    assert.deepEqual([...reloaded.app.blockedKeywordsDraft], ['new']);
});

test('failed filter save retains the draft and reports failure', async t => {
    const { app, window } = reader(t);
    app.contentFilterLoaded = true;
    app.blockedKeywords = ['old'];
    app.openContentFilterSettings();
    app.blockedKeywordsDraft = ['new'];
    window.fetch = async () => ({ ok: false });
    await app.saveContentFilterSettings();
    assert.deepEqual([...app.blockedKeywords], ['old']);
    assert.deepEqual([...app.blockedKeywordsDraft], ['new']);
    assert.equal(app.contentFilterSettingsOpen, true);
    assert.match(app.contentFilterError, /Could not save/);
});

test('filter route acknowledges only after durable storage and permits explicit clearing', async () => {
    const routes = new Map(); const gate = deferred(); let stored; let acknowledged = false;
    registerContentFilterRoutes({ app: { get() {}, post: (url, ...handlers) => routes.set(url, handlers.at(-1)) },
        env: { RSS_DATA: { put: async (key, value, options) => {
            assert.equal(key, 'blockedArticleKeywords');
            assert.equal(options.allowLargeReduction, true);
            await gate.promise; stored = JSON.parse(value);
        } } } });
    const saving = routes.get('/api/content-filter-settings')({ body: { keywords: [] } }, { json: () => { acknowledged = true; } });
    assert.equal(acknowledged, false);
    gate.resolve(); await saving;
    assert.deepEqual(stored, []);
    assert.equal(acknowledged, true);
});

test('Gemini accepts complete JSON with completion controls on the first poll', async () => {
    let calls = 0;
    const page = { evaluate: async () => { calls++; return { text: '{"sections":[]}', responseFinished: true, generating: false }; } };
    assert.equal(await waitForResponse(page, '', 1000, true), '{"sections":[]}');
    assert.equal(calls, 1);
});

test('Gemini never accepts a partial root when generation controls disappear', async () => {
    let calls = 0;
    const page = { evaluate: async () => ({ text: ++calls < 4 ? '{"sections":[{"text":"partial"}' : '{"sections":[]}', responseFinished: calls >= 4, generating: false }) };
    assert.equal(await waitForResponse(page, '', 5000, true), '{"sections":[]}');
    assert.equal(calls, 4);
});

test('Gemini accepts complete JSON when completion controls are absent', async () => {
    let calls = 0;
    const page = { evaluate: async () => { calls++; return { text: '{"sections":[]}', responseFinished: false, generating: false }; } };
    assert.equal(await waitForResponse(page, '', 5000, true), '{"sections":[]}');
    assert.equal(calls, 1);
});

test('a slow Web attempt cannot consume the API fallback timeout', async () => {
    const source = readFileSync(new URL('../summary-engine.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function generateWithFallback(');
    const fn = source.slice(start, source.indexOf('\n}', start) + 2);
    let now = 0; let apiTimeout; let webTimeout;
    const generate = vm.runInNewContext(`(${fn})`, {
        Date: { now: () => now }, console,
        globalAiTaskActive: () => true,
        generateWithAntigravity: async () => { now += 25000; throw Error('Unavailable'); },
        getGeminiWebCooldownState: () => ({}),
        generateWithGeminiWeb: async (_prompt, options) => { webTimeout = options.timeoutMs; now += 150000; throw Error('Web setup/response failed'); },
        geminiGenerateWithDiscovery: async (_model, _prompt, options) => { apiTimeout = options.timeoutMs; return { text: 'done' }; }
    });
    assert.equal((await generate('fixture-model', 'prompt', { timeoutMs: 120000 })).text, 'done');
    assert.equal(webTimeout, 90000);
    assert.equal(apiTimeout, 40000);
});

