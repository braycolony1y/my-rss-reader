import test from 'node:test';
import assert from 'node:assert/strict';
import { createArticlePresentation } from '../src/articles/presentation.js';
import { rankClassicStories } from '../src/ranking/classic.js';

const date = 1795342278920;
const article = (id, extra = {}) => ({ link: `https://example.com/${id}`, title: id,
    smartCategory: 'news_global', pubDate: new Date(date - 3600000).toISOString(), image: 'https://example.com/photo.jpg', ...extra });
function setMaxStaleAge(t, value) {
    const original = process.env.SMART_RANKING_MAX_STALE_MS;
    t.after(() => {
        if (original === undefined) delete process.env.SMART_RANKING_MAX_STALE_MS;
        else process.env.SMART_RANKING_MAX_STALE_MS = original;
    });
    process.env.SMART_RANKING_MAX_STALE_MS = value;
}
function fixture() {
    const state = { smartClusters: [article('Central bank cuts rates'), article('Earthquake forces evacuation')],
        smartRawArticles: [], smartClusterVersion: 'v1', readStates: [], hiddenStates: [], blockedArticleKeywords: [], unavailableSourceUrls: [] };
    let warms = 0;
    const vectors = { revision: 0, get: () => null, warm: () => { warms++; return null; } };
    const presentation = createArticlePresentation({ rankingVectors: vectors, env: { RSS_DATA: { get: async key => state[key] } } });
    const request = async (query = {}) => {
        let result;
        await presentation.serveSmartData({ query: { filterValue: 'news_global', ...query } }, { setHeader() {}, json(v) { result = v; } });
        return result;
    };
    return { state, vectors, presentation, request, warms: () => warms };
}

test('Stories content cache preserves exact ranking and survives identical raw snapshot replacement', async () => {
    const f = fixture(), originalNow = Date.now;
    Date.now = () => date;
    try {
        const first = await f.request();
        const expected = rankClassicStories(f.state.smartClusters, { destination: 'news_global', now: date });
        assert.deepEqual(first.articles.map(a => [a.link, a.ranking, a.hotness, a.hotnessLabel]),
            expected.map(a => [a.link, a.ranking, a.hotness, a.hotnessLabel]));
        f.state.smartRawArticles = [];
        assert.deepEqual((await f.request()).articles, first.articles);
        assert.equal(f.warms(), 1, 'equivalent candidate content must not rank again');
        f.state.smartClusterVersion = 'v2';
        await f.request();
        assert.equal(f.warms(), 2, 'new publication version invalidates ranking');
        f.state.smartRawArticles = [article('New report')];
        assert.equal((await f.request()).articles.length, 3);
        assert.equal(f.warms(), 3, 'new content invalidates ranking');
    } finally { Date.now = originalNow; }
});

test('Stories caches invalidate for read, hidden, blocked keyword and unavailable state', async () => {
    const f = fixture();
    const first = await f.request({ hideRead: 'true' });
    f.state.readStates = [first.articles[0].link];
    assert.equal((await f.request({ hideRead: 'true' })).articles.length, 1);
    f.state.readStates = [];
    assert.equal((await f.request({ hideRead: 'true' })).articles.length, 2);
    f.state.hiddenStates = [first.articles[0].link];
    assert.equal((await f.request({ smartView: first.smartViewToken, hideRead: 'true' })).viewReset, true);
    assert.equal((await f.request()).articles.length, 1);
    f.state.hiddenStates = [];
    f.state.blockedArticleKeywords = ['earthquake'];
    assert.deepEqual((await f.request()).articles.map(a => a.title), ['Central bank cuts rates']);
    f.state.blockedArticleKeywords = [];
    const beforeUnavailable = await f.request();
    f.state.unavailableSourceUrls = [first.articles[0].link];
    const unavailable = await f.request({ smartView: beforeUnavailable.smartViewToken });
    assert.equal(unavailable.viewReset, true);
    assert.equal(unavailable.articles.find(a => a.link === first.articles[0].link).sourceDeleted, true);
});

test('minute expiry serves the prior ranking and coalesces a background refresh without changing pinned views', async () => {
    const f = fixture(), originalNow = Date.now;
    f.state.smartRawArticles = [article('Fresh unclustered report')];
    Date.now = () => date;
    try {
        const first = await f.request();
        Date.now = () => date + 60001;
        f.state.smartRawArticles = [...f.state.smartRawArticles];
        assert.deepEqual((await f.request()).articles, first.articles, 'expired ranking is immediately available');
        assert.deepEqual((await f.request()).articles, first.articles);
        await new Promise(setImmediate);
        const refreshed = await f.request();
        const expected = rankClassicStories(first.articles, { destination: 'news_global', now: date + 60001 });
        assert.deepEqual(refreshed.articles.map(a => a.ranking), expected.map(a => a.ranking));
        assert.deepEqual((await f.request({ smartView: first.smartViewToken })).articles, first.articles);
    } finally { Date.now = originalNow; f.presentation.releaseTransientCaches(); }
});

test('rankings beyond the ten-minute stale cap refresh before a new view is pinned', async t => {
    const f = fixture();
    let now = date;
    t.mock.method(Date, 'now', () => now);
    setMaxStaleAge(t, '');
    try {
        const first = await f.request();
        now += 10 * 60000;
        assert.deepEqual((await f.request()).articles, first.articles, 'the cap still allows stale-while-revalidate');
        now++;
        const fresh = await f.request();
        const expected = rankClassicStories(f.state.smartClusters, { destination: 'news_global', now });
        assert.notDeepEqual(fresh.articles.map(a => a.ranking), first.articles.map(a => a.ranking));
        assert.deepEqual(fresh.articles.map(a => a.ranking), expected.map(a => a.ranking));
        assert.deepEqual((await f.request({ smartView: fresh.smartViewToken })).articles, fresh.articles);
        assert.deepEqual((await f.request({ smartView: first.smartViewToken })).articles, first.articles);
        await new Promise(setImmediate);
        assert.deepEqual((await f.request()).articles, fresh.articles, 'queued refresh cannot replace the new entry');

        now += 3 * 3600000;
        const afterIdle = await f.request();
        const decayed = rankClassicStories(f.state.smartClusters, { destination: 'news_global', now });
        assert.deepEqual(afterIdle.articles.map(a => a.ranking), decayed.map(a => a.ranking));
    } finally { f.presentation.releaseTransientCaches(); }
});

test('the Stories ranking stale cap accepts an environment override', async t => {
    const f = fixture();
    let now = date;
    t.mock.method(Date, 'now', () => now);
    setMaxStaleAge(t, '120000');
    try {
        await f.request();
        now += 120001;
        const fresh = await f.request();
        const expected = rankClassicStories(f.state.smartClusters, { destination: 'news_global', now });
        assert.deepEqual(fresh.articles.map(a => a.ranking), expected.map(a => a.ranking));
    } finally { f.presentation.releaseTransientCaches(); }
});

test('a synchronous vector warm failure never fails a cold or stale Stories request', async t => {
    const f = fixture();
    let now = date;
    t.mock.method(Date, 'now', () => now);
    const warnings = [];
    t.mock.method(console, 'warn', (...args) => warnings.push(args));
    f.vectors.warm = () => { throw new Error('vector cache unavailable'); };
    try {
        const first = await f.request();
        assert.equal(first.articles.length, 2);
        now += 60001;
        assert.deepEqual((await f.request()).articles, first.articles);
        await new Promise(setImmediate);
        assert.deepEqual(warnings, Array.from({ length: 2 }, () =>
            ['[RANKING] Vector warm failed:', 'vector cache unavailable']));
    } finally { f.presentation.releaseTransientCaches(); }
});

test('cold vectors never delay the response and completion refreshes the available ranking', async () => {
    const f = fixture(), originalNow = Date.now;
    Date.now = () => date;
    try {
        let finish;
        const loading = new Promise(resolve => { finish = resolve; });
        const vector = new Float32Array(384).fill(1 / Math.sqrt(384));
        f.vectors.warm = () => loading;
        f.vectors.get = () => f.vectors.revision ? vector : null;
        const result = await Promise.race([f.request(), new Promise((_, reject) => setTimeout(() => reject(Error('waited for vectors')), 1000).unref())]);
        assert.equal(result.articles.length, 2);
        assert.equal(result.articles[0].ranking.signals.e5, false);
        f.vectors.revision = 1;
        finish();
        await loading;
        // The deferred warm promise settles before its queued refresh runs.
        await new Promise(setImmediate);
        await new Promise(setImmediate);
        const refreshed = await f.request();
        const expected = rankClassicStories(f.state.smartClusters, { destination: 'news_global', now: date, vectorOf: () => vector });
        assert.deepEqual(refreshed.articles.map(a => a.ranking), expected.map(a => a.ranking));
        assert.equal(refreshed.articles[0].ranking.signals.e5, true);
        assert.deepEqual((await f.request({ smartView: result.smartViewToken })).articles, result.articles);
    } finally { Date.now = originalNow; f.presentation.releaseTransientCaches(); }
});

test('lean Stories omits held metadata but returns authoritative read and hidden state', async () => {
    const f = fixture();
    f.state.userPreferences = { example: 'large preference map' };
    f.state.feeds = [{ url: 'https://example.com/rss' }];
    assert.deepEqual((await f.request()).userPreferences, f.state.userPreferences);
    const lean = await f.request({ lean: '1' });
    assert.equal(lean.userPreferences, undefined);
    assert.equal(lean.feeds, undefined);
    assert.deepEqual(lean.readStates, []);
    assert.deepEqual(lean.hiddenStates, []);
});

test('Stories member filtering honors originalLink for read and hidden state', async () => {
    const f = fixture();
    const originalLink = 'https://news.google.com/read/example';
    f.state.smartClusters = [article('Headline with enough detail', { originalLink })];
    f.state.readStates = [originalLink];
    assert.equal((await f.request({ hideRead: 'true' })).articles.length, 0);
    assert.equal((await f.request()).articles.length, 1);
    f.state.readStates = [];
    f.state.hiddenStates = [originalLink];
    assert.equal((await f.request()).articles.length, 0);
});
