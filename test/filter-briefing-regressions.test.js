import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { waitForResponse } from '../src/ai/gemini-web.js';
import { createStoryBriefings, REQUIRED_ANALYSIS_REVIEW } from '../src/articles/story-briefing.js';
import { runGlobalAiTask, setGlobalAiReadingMode } from '../src/ai/global-ai-scheduler.js';
import { registerContentFilterRoutes } from '../src/routes/content-filter-routes.js';

const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
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

test('completion pushes update multiple pages immediately and stale heartbeats cannot revert them', t => {
    const { app, window } = reader(t);
    const listeners = new Map();
    window.EventSource = class { addEventListener(name, listener) { listeners.set(name, listener); } };
    app.isLoggedIn = true;
    app.selectedFilterType = 'smart';
    app.smartTabMode = 'top';
    app.articles = Array.from({ length: 50 }, (_, i) => ({ clusterId: `story-${i}`, topStory: { material_version: 1 }, briefing: { analysisStatus: 'pending' } }));
    app.startServerEvents();
    const completed = { status: 'ready', analysisStatus: 'evaluated', sections: [{ text: 'Completed analysis' }] };
    for (const i of [0, 49]) listeners.get('smart-briefing-changed')({ data: JSON.stringify({ clusterId: `story-${i}`, materialVersion: 1, briefing: completed }) });
    for (const i of [0, 49]) assert.equal(app.articles[i].briefing.status, 'ready');
    app.applyBriefingUpdates([{ clusterId: 'story-0', materialVersion: 1, briefing: { analysisStatus: 'pending' } }]);
    assert.equal(app.articles[0].briefing.status, 'ready');
    app.applyBriefingUpdates([{ clusterId: 'story-1', materialVersion: 2, briefing: completed }]);
    assert.equal(app.articles[1].briefing.analysisStatus, 'pending');
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
        geminiGenerate: async (_model, _prompt, options) => { apiTimeout = options.timeoutMs; return { text: 'done' }; }
    });
    assert.equal((await generate('fixture-model', 'prompt', { timeoutMs: 120000 })).text, 'done');
    assert.equal(webTimeout, 90000);
    assert.equal(apiTimeout, 40000);
});

test('viewport promotion survives page reconciliation and dispatches before background work', async () => {
    setGlobalAiReadingMode(true);
    const gate = deferred();
    const blockers = [
        ...Array.from({ length: 3 }, () => runGlobalAiTask({ lane: 'p0', viewportBurst: true }, () => gate.promise)),
        ...Array.from({ length: 2 }, () => runGlobalAiTask({ lane: 'p1' }, () => gate.promise)),
        runGlobalAiTask({ lane: 'p4' }, () => gate.promise)
    ];
    const state = {}; const order = [];
    const quote = 'The vendor published updated firmware.';
    const service = createStoryBriefings({ db: { get: async key => state[key], put: async (key, value) => { state[key] = JSON.parse(value); } }, generate: async prompt => {
        order.push(JSON.parse(prompt.split('SOURCES:\n')[1])[0].link);
        return JSON.stringify({ analysisReview: REQUIRED_ANALYSIS_REVIEW.map(label => ({ label, useful: false, reason: 'No further evidence.' })), sections: [{ label: 'What happened', text: quote, evidence: [{ sourceId: 1, quote }] }] });
    } });
    const cards = Array.from({ length: 8 }, (_, i) => ({ clusterId: `viewport-${i}`, link: `https://source.test/${i}`, title: 'Firmware update', content: quote, topStory: { material_version: 1, timeline: [] } }));
    try {
        for (const card of cards) await service.get(card, 'tech_world', { priority: 0, viewKey: 'view:tech:global:page:2' });
        service.setViewport('view:tech:global:page:1', [cards[7].clusterId], 10);
        service.setActiveView('view:tech:global:page:2');
        const visible = await service.get(cards[7], 'tech_world', { generate: false });
        assert.equal(visible.queueAhead, 0);
        assert.equal(visible.analysisStatus, 'pending');
        assert.equal(service.setViewport('view:tech:global:page:2', [cards[0].clusterId], 9), false);
        gate.resolve(); await Promise.all(blockers);
        for (let i = 0; i < 100 && order.length < cards.length; i++) await new Promise(r => setTimeout(r, 5));
        assert.equal(order[0], cards[7].link);
        assert.equal(order.length, cards.length);
    } finally { gate.resolve(); setGlobalAiReadingMode(false); }
});
