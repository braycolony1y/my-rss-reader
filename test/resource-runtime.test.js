import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createConcurrencyLimiter } from '../src/runtime/concurrency-limiter.js';
import { createCoalescedJob, getActiveJobs } from '../src/runtime/coalesced-job.js';
import { coalesceSmartRefresh } from '../src/smart/refresh/coalescing.js';
import { createParsedCache } from '../src/database/parsed-cache.js';
import { associatedSourceUrls } from '../src/articles/source-policy-index.js';
import { startResourceMonitor } from '../src/observability/resource-monitor.js';
import { closeOwnedSlotPage } from '../src/browser/slot-lifecycle.js';
import { prefetchOpenCliOnlySmartArticles } from '../src/smart/sources/prefetch.js';

const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('queued work stays bounded, preserves priority and releases capacity after failure', async () => {
    const limiter = createConcurrencyLimiter(2), blocked = gate();
    let active = 0, peak = 0; const order = [];
    const run = (i, priority) => limiter.run(async () => {
        active++; peak = Math.max(peak, active); order.push(i);
        try { if (i < 2) await blocked.promise; if (i === 7) throw Error('failed'); return i; }
        finally { active--; }
    }, priority);
    const tasks = Array.from({ length: 30 }, (_, i) => run(i, i === 29 ? 0 : 4));
    await nextTurn(); assert.equal(limiter.state().active, 2); assert.equal(limiter.state().pending, 28);
    blocked.resolve();
    const results = await Promise.allSettled(tasks); await nextTurn();
    assert.equal(peak, 2); assert.deepEqual(order.slice(0, 3), [0, 1, 29]);
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);
    assert.deepEqual(limiter.state(), { limit: 2, active: 0, pending: 0, completed: 30 });
});
test('refresh requests coalesce to one newest run, with no overlap even after failure', async () => {
    const blocked = gate(), inputs = [];
    const job = createCoalescedJob({ name: 'test-job', report() {}, run: async value => {
        inputs.push(value); if (value === 1) { await blocked.promise; throw Error('first failed'); } return value;
    } });
    const first = job.request(1); const rejected = assert.rejects(first, /first failed/);
    const second = job.request(2), third = job.request(3);
    assert.equal(second, third); assert.equal(getActiveJobs().find(j => j.name === 'test-job').pending, true);
    blocked.resolve(); await rejected; assert.equal(await second, 3); await nextTurn();
    assert.deepEqual(inputs, [1, 3]); assert.equal(job.state().active, false);
    assert.ok(!getActiveJobs().some(j => j.name === 'test-job'));
});
test('coalesced Smart refresh covers every requested category and retains forced rebuilds', async () => {
    const blocked = gate(), calls = [];
    const refresh = coalesceSmartRefresh(async (_progress, category, options) => {
        calls.push({ category, ...options }); if (calls.length === 1) await blocked.promise; return { ok: true };
    }, () => {});
    const first = refresh(null, 'news_vietnam');
    const second = refresh(null, 'tech_vietnam', { forceRebuild: true });
    const third = refresh(null, 'finance_vietnam', { forceRebuild: false });
    blocked.resolve(); await Promise.all([first, second, third]);
    assert.deepEqual(calls, [{ category: 'news_vietnam' }, { category: null, forceRebuild: true }]);
});
test('parsed cache uses LRU, byte/count limits, expiry and generation invalidation', () => {
    let at = 1; const cache = createParsedCache({ maxBytes: 12, maxEntries: 2, ttlMs: 10, now: () => at, recoverOwned: false });
    cache.set('a', 'aa', { value: 1 }); cache.set('b', 'bb', { value: 2 });
    assert.equal(cache.get('a', 'aa').parsed.value, 1);
    cache.set('c', 'cc', []); assert.equal(cache.get('b', 'bb'), undefined);
    assert.equal(cache.get('a', 'new'), undefined);
    cache.set('large', 'x'.repeat(20), []); assert.equal(cache.get('large', 'x'.repeat(20)), undefined);
    at += 11; assert.equal(cache.get('c', 'cc'), undefined); assert.equal(cache.state().estimatedSourceBytes, 0);
    cache.set('a', 'aa', []); cache.invalidate('a', 'aa'); assert.ok(cache.get('a', 'aa'));
    cache.invalidate('a', 'changed'); assert.equal(cache.state().entries, 0);
});
test('source policy lookup preserves aliases, duplicate feed precedence and new generations', () => {
    const articles = [ { link: 'https://example.com/a', feedUrl: 'feed-a' },
        { originalLink: 'https://example.com/a', id: 'article-id', feedUrl: 'feed-b' },
        { link: 'https://example.com/a', feedUrl: 'feed-a' } ];
    assert.deepEqual(associatedSourceUrls(articles, 'https://example.com/a'), ['feed-a', 'feed-b']);
    assert.deepEqual(associatedSourceUrls(articles, 'article-id'), ['feed-b']);
    assert.deepEqual(associatedSourceUrls([...articles, { link: 'https://example.com/a', feedUrl: 'feed-c' }], 'https://example.com/a'), ['feed-a', 'feed-b', 'feed-c']);
});
test('resource sampling reports memory categories and event-loop/queue data without collection', () => {
    let at = 0, used = 0; const reports = [];
    const histogram = { enable() {}, disable() {}, reset() {}, mean: 2e6, max: 5e6, percentile: () => 4e6 };
    const monitor = startResourceMonitor({ now: () => at, cpu: () => ({ user: used, system: 0 }), histogram,
        memory: () => ({ rss: 100, heapUsed: 50, heapTotal: 60, external: 10, arrayBuffers: 5 }),
        collect: () => ({ queue: 3 }), report: (...values) => reports.push(values) });
    try { at = 1000; used = 500000; const result = monitor.sample();
        assert.equal(result.cpuPercent, 50); assert.equal(result.arrayBuffers, 5); assert.equal(result.queue, 3);
        assert.equal(result.eventLoop.p99Ms, 4); assert.equal(monitor.latest(), result); assert.equal(reports.length, 1);
    } finally { monitor.stop(); }
});

test('browser cleanup closes only the owned tab and keeps its identity after a cleanup failure', async () => {
    let calls = 0, clears = 0;
    const page = { closeWindow: () => assert.fail('Shared windows must stay open'), closeTab: async () => { calls++; if (calls === 1) throw Error('Disconnected'); } };
    const slot = { id: 1, page }, report = { log() {}, warn() {} };
    await closeOwnedSlotPage(slot, 'idle', () => clears++, report);
    assert.equal(slot.page, page);
    await closeOwnedSlotPage(slot, 'idle', () => clears++, report);
    assert.equal(slot.page, null); assert.equal(clears, 2);
});
test('Smart source prefetch processes every allowed article with bounded source fan-out', async () => {
    let active = 0, peak = 0; const visited = [];
    const sources = Array.from({ length: 20 }, (_, i) => ({ source: { url: `source-${i}`, fetchMethods: ['opencli'] }, articles: [{ link: `https://example.com/${i}` }] }));
    sources.push({ source: { url: 'direct', fetchMethods: ['direct'] }, articles: [{ link: 'https://example.com/direct' }] });
    await prefetchOpenCliOnlySmartArticles(sources, { prefetchOpenCliOnlyArticles: async (articles, source) => {
        active++; peak = Math.max(peak, active); await nextTurn(); visited.push([source, articles[0].link]); active--;
    } });
    assert.ok(peak <= 2); assert.equal(visited.length, 20); assert.equal(new Set(visited.map(v => v[0])).size, 20);
});
