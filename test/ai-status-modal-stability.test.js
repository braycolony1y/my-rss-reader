import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readReaderHtml } from './helpers/reader-source.js';

test('AI usage modal keeps a single <=16px backdrop-filter layer, isolated panel, scroll containment, and scaleX progress bar', () => {
    const html = readReaderHtml();

    // Modal remains a direct child of <body>, outside <main> and any transformed ancestor.
    const bodyStart = html.indexOf('<body');
    const modalStart = html.indexOf('class="ai-status-overlay');
    const mainStart = html.indexOf('<main');
    assert.ok(bodyStart !== -1 && modalStart > bodyStart && modalStart < mainStart);

    // Single backdrop-filter on overlay (<= 16px), disabled on modal panel and all descendants.
    assert.match(html, /\.theme-glass-light \.ai-status-overlay \.ai-status-modal \*\s*\{[^}]*backdrop-filter:\s*none !important;/);
    assert.match(html, /\.theme-glass-light \.ai-status-overlay\s*\{[^}]*backdrop-filter:\s*blur\(16px\)/);
    assert.match(html, /\.theme-glass \.ai-status-overlay\s*\{[^}]*backdrop-filter:\s*blur\(16px\)/);
    assert.doesNotMatch(html, /\.ai-status-modal\s*\{[^}]*backdrop-filter:\s*blur\(/);
    assert.doesNotMatch(html, /\.ai-status-card[^{]*\{[^}]*backdrop-filter:\s*blur\(/);

    // Stable panel layer and paint/scroll containment on modal body & nested log list.
    assert.match(html, /\.ai-status-modal\s*\{[^}]*isolation:\s*isolate;[^}]*transform:\s*translateZ\(0\);/s);
    assert.match(html, /\.ai-status-body\s*\{[^}]*contain:\s*paint;[^}]*overscroll-behavior:\s*contain;/s);
    assert.match(html, /\.ai-status-log-list,\s*\.ai-status-log-list pre\s*\{[^}]*overscroll-behavior:\s*contain;/s);

    // Background scroll lock on html/body and #scroll-container while geminiStatusOpen is true.
    assert.match(html, /html\.ai-status-scroll-lock,\s*html\.ai-status-scroll-lock body\s*\{[^}]*overflow:\s*hidden !important;/s);
    assert.match(html, /showAddFeedModal \|\| editModalOpen \|\| debugModalOpen \|\| articleOverlayOpen \|\| geminiStatusOpen/);

    // Progress bar animates transform: scaleX instead of layout width.
    assert.match(html, /ai-status-progress-fill[^"]*origin-left[^"]*transition-transform/);
    assert.match(html, /transform:\s*scaleX\('/);
    assert.doesNotMatch(html, /ai-status-progress-fill[\s\S]{0,240}:style="'width:/);
});

test('ReaderAiStatus live updates mutate only changed fields, memoize log filtering, and lock background scroll', async () => {
    const source = readFileSync(new URL('../public/js/ai/status.js', import.meta.url), 'utf8');
    const classSet = new Set();
    const documentStub = {
        documentElement: {
            classList: {
                toggle(name, force) {
                    if (force) classSet.add(name);
                    else classSet.delete(name);
                }
            }
        },
        body: { style: { overflow: '' } }
    };

    let smartPayload = {
        state: 'refreshing',
        providerOrder: ['antigravity-low', 'gemini-flash', 'local-qwen'],
        progress: { active: true, current: 5, total: 20, remaining: 15, percent: 25, message: 'Batch 1' }
    };
    let debugPayload = {
        queue: { processing: true, paused: false, currentUrl: 'https://example.com/1', queueLength: 3, stats: { generated: 10, failed: 1 } },
        gemini: { activeKeyIndex: 0, totalKeys: 2, activeKeyMasked: 'AIza...1', autoSwitchCount: 0, keys: [{ index: 0, label: 'Key 1', status: 'Active', requestsToday: 4 }, { index: 1, label: 'Key 2', status: 'Standby', requestsToday: 0 }] }
    };
    let usagePayload = {
        generatedAt: '2026-11-01T09:00:00Z',
        totalEvents: 2,
        rangeStart: 1,
        rangeEnd: 2,
        hasNewer: false,
        hasOlder: false,
        summary: { totalRequests: 2 },
        events: [
            { id: 'e1', provider: 'antigravity', status: 'success', operation: 'cluster', model: 'gemini-3.8-flash' },
            { id: 'e2', provider: 'gemini', status: 'cooldown', errorCode: 'COOLDOWN', message: 'Gemini API cooldown active until later' }
        ]
    };

    const context = vm.createContext({
        document: documentStub,
        Intl,
        setInterval: () => 1,
        clearInterval: () => {},
        setTimeout: () => 1,
        clearTimeout: () => {},
        fetch: async (url) => {
            if (String(url).startsWith('/api/smart-status')) {
                return { ok: true, json: async () => structuredClone(smartPayload) };
            }
            if (String(url).startsWith('/api/summary/debug')) {
                const raw = JSON.stringify(debugPayload);
                return { ok: true, text: async () => raw, json: async () => JSON.parse(raw) };
            }
            if (String(url).startsWith('/api/online-ai-usage')) {
                return { ok: true, json: async () => structuredClone(usagePayload) };
            }
            if (String(url).startsWith('/api/gemini-key-status')) {
                return {
                    ok: true,
                    json: async () => ({
                        valid: true,
                        state: 'ready',
                        keyCount: 2,
                        providerHealth: { antigravity: { state: 'healthy' } },
                        lastSmartRun: structuredClone(smartPayload)
                    })
                };
            }
            throw new Error(`Unexpected URL: ${url}`);
        }
    });

    const instance = vm.runInContext(`${source}; ReaderAiStatus.create()`, context);

    // Scroll lock toggles cleanly and respects articleOverlayOpen.
    instance.syncGeminiStatusScrollLock(true);
    assert.equal(classSet.has('ai-status-scroll-lock'), true);
    assert.equal(documentStub.body.style.overflow, 'hidden');
    instance.articleOverlayOpen = true;
    instance.syncGeminiStatusScrollLock(false);
    assert.equal(classSet.has('ai-status-scroll-lock'), false);
    assert.equal(documentStub.body.style.overflow, 'hidden', 'must keep body locked if article overlay is still open');
    instance.articleOverlayOpen = false;
    instance.syncGeminiStatusScrollLock(false);
    assert.equal(documentStub.body.style.overflow, '');

    // Initial key status + smart progress preserves root object & providerOrder reference on incremental progress ticks.
    await instance.fetchGeminiKeyStatus();
    const rootRef = instance.geminiKeyStatus;
    const runRef = instance.geminiKeyStatus.lastSmartRun;
    const orderRef = instance.geminiKeyStatus.lastSmartRun.providerOrder;
    const progressRef = instance.geminiKeyStatus.lastSmartRun.progress;

    await instance.fetchSmartAiProgress();
    assert.equal(instance.geminiKeyStatus, rootRef);
    assert.equal(instance.geminiKeyStatus.lastSmartRun, runRef);
    assert.equal(instance.geminiKeyStatus.lastSmartRun.providerOrder, orderRef);

    smartPayload = {
        ...smartPayload,
        progress: { ...smartPayload.progress, current: 10, remaining: 10, percent: 50 }
    };
    await instance.fetchSmartAiProgress();
    assert.equal(instance.geminiKeyStatus, rootRef, 'root geminiKeyStatus must not be replaced on progress tick');
    assert.equal(instance.geminiKeyStatus.lastSmartRun, runRef, 'lastSmartRun object must stay stable');
    assert.equal(instance.geminiKeyStatus.lastSmartRun.providerOrder, orderRef, 'unchanged providerOrder array must stay stable');
    assert.equal(instance.geminiKeyStatus.lastSmartRun.progress, progressRef, 'progress object is updated in place');
    assert.equal(instance.geminiKeyStatus.lastSmartRun.progress.percent, 50);

    // Debug stats polling preserves object & key row references when unchanged or incrementally updated.
    await instance.fetchGeminiDebugStats();
    const debugRef = instance.geminiDebugStats;
    const key0Ref = instance.geminiDebugStats.gemini.keys[0];
    await instance.fetchGeminiDebugStats();
    assert.equal(instance.geminiDebugStats, debugRef);
    debugPayload = {
        ...debugPayload,
        gemini: {
            ...debugPayload.gemini,
            keys: [
                { index: 0, label: 'Key 1', status: 'Active', requestsToday: 5 },
                { index: 1, label: 'Key 2', status: 'Standby', requestsToday: 0 }
            ]
        }
    };
    await instance.fetchGeminiDebugStats();
    assert.equal(instance.geminiDebugStats, debugRef);
    assert.equal(instance.geminiDebugStats.gemini.keys[0], key0Ref);
    assert.equal(instance.geminiDebugStats.gemini.keys[0].requestsToday, 5);

    // Online AI usage memoizes filtered events and keeps events array stable on unchanged silent polls.
    await instance.fetchOnlineAiUsage(false);
    const eventsRef = instance.onlineAiUsage.events;
    const filteredFirst = instance.filteredOnlineAiUsageEvents();
    const filteredSecond = instance.filteredOnlineAiUsageEvents();
    assert.equal(filteredFirst, filteredSecond, 'repeated calls in a render pass return the memoized array');
    assert.equal(filteredFirst.length, 1);

    usagePayload = { ...usagePayload, generatedAt: '2026-11-01T09:01:00Z' };
    await instance.fetchOnlineAiUsage(true);
    assert.equal(instance.onlineAiUsage.events, eventsRef, 'silent poll with identical events keeps array reference');
    assert.equal(instance.onlineAiUsage.generatedAt, '2026-11-01T09:01:00Z');
});
