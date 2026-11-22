import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { registerDataRoutes } from '../src/routes/data-routes.js';
import { feedPageKey, selectFeedPage } from '../src/feeds/page-selection.js';

const thread = (id, overrides = {}) => ({ link: `https://voz.vn/t/thread.${id}`, title: `Thread ${id}`,
    feedCategory: 'Forum', feedUrl: 'voz-feed', ...overrides });
const ids = app => Array.from(app.articles, a => feedPageKey(a));
function fixture() {
    const state = { articles: Array.from({ length: 45 }, (_, i) => thread(i + 1)) };
    const routes = {}, calls = [];
    let fail = false, delay = null;
    registerDataRoutes({ app: { get(path, ...handlers) { routes[`GET ${path}`] = handlers.at(-1); },
        post(path, ...handlers) { routes[`POST ${path}`] = handlers.at(-1); } },
        env: { RSS_DATA: { get: async key => state[key] } }, prepareArticleForClient: async a => ({ ...a }) });
    const fetch = async (url, options = {}) => {
        const query = Object.fromEntries(new URL(url, 'http://reader').searchParams);
        const body = options.body ? JSON.parse(options.body) : undefined;
        calls.push({ query, body, method: options.method || 'GET' });
        if (delay) await delay;
        if (fail) return { ok: false, status: 503 };
        let data;
        const res = { json(value) { data = value; }, status() { return this; } };
        await routes[`${options.method || 'GET'} /api/data`]({ query, body }, res, error => { throw error; });
        return { ok: true, json: async () => data };
    };
    const context = vm.createContext({ performance, URL, URLSearchParams, AbortController, console: { error() {} },
        setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, fetch,
        window: {}, document: { getElementById: () => ({ scrollTo() {} }) } });
    for (const file of ['article/prefetch-lifecycle', 'feeds/list-publication', 'feeds/page-session', 'feeds/requests', 'feeds/pagination', 'feeds/list']) {
        vm.runInContext(readFileSync(new URL(`../public/js/${file}.js`, import.meta.url), 'utf8'), context);
    }
    const app = vm.runInContext('ReaderFeedsList.create()', context);
    const session = vm.runInContext('ReaderFeedPageSession', context);
    Object.assign(app, { selectedFilterType: 'category', selectedFilterValue: 'Forum', isMobile: true,
        hideRead: false, searchQuery: '', pendingReadLinks: [], pendingUnreadLinks: new Set(), pendingRecentReadLinks: new Set(),
        readStates: new Set(), pendingPreferences: {}, applyPendingStateMutations: (_, v) => v,
        hideTooltip() {}, scheduleBriefingRefresh() {}, $nextTick: async () => {}, saveState() {} });
    return { app, state, session, calls, fail(value) { fail = value; }, delay(value) { delay = value; } };
}

test('mobile Next includes newly bumped threads above the old offset without repeating previous pages', async () => {
    const f = fixture();
    await f.app.fetchData();
    const first = ids(f.app), visible = [...f.app.articles];
    // Unseen 40 moves above page one, new 99 arrives, seen 3 gets another reply.
    f.state.articles = [thread(99), thread(40), thread(3, { replyCount: 200 }),
        ...f.state.articles.filter(a => ![thread(3).link, thread(40).link].includes(a.link))];
    await f.app.fetchData(false, false, true);
    assert.deepEqual(ids(f.app), first);
    assert.equal(f.app.articles[2], visible[2]);
    assert.equal(f.app.articles[2].replyCount, 200);
    await f.app.goToPage(2);
    const second = ids(f.app);
    assert.equal(second.length, 15);
    assert.deepEqual(second.slice(0, 2), ['voz:99', 'voz:40']);
    assert.ok(second.every(key => !first.includes(key)));
    f.state.articles = [thread(98), ...f.state.articles.reverse()];
    await f.app.goToPage(3);
    assert.equal(ids(f.app)[0], 'voz:98');
    assert.ok(ids(f.app).every(key => ![...first, ...second].includes(key)));
    assert.equal(f.calls.at(-1).query.limit, '15', 'deep pages prepare one page, not a growing prefix');
    assert.equal(f.calls.at(-1).query.page, '3');
});

test('Prev and revisiting Next keep committed page membership despite new rankings', async () => {
    const f = fixture();
    await f.app.fetchData(); const first = ids(f.app);
    await f.app.goToPage(2); const second = ids(f.app);
    f.state.articles = [thread(99), ...f.state.articles.reverse()];
    await f.app.goToPage(1);
    assert.deepEqual(ids(f.app), first);
    assert.equal(f.app.hasMore, true);
    await f.app.goToPage(2);
    assert.deepEqual(ids(f.app), second);
    await f.app.goToPage(3);
    assert.equal(ids(f.app)[0], 'voz:99');
});

test('background refresh independently finds unseen availability at the frontier and preserves cached Next', async () => {
    const f = fixture(); f.state.articles = f.state.articles.slice(0, 30);
    await f.app.fetchData(); await f.app.goToPage(2);
    assert.equal(f.app.hasMore, false);
    f.state.articles = [thread(99), ...f.state.articles];
    await f.app.fetchData(false, false, true);
    assert.equal(f.app.hasMore, true);
    assert.ok(!ids(f.app).includes('voz:99'));
    await f.app.goToPage(3);
    assert.deepEqual(ids(f.app), ['voz:99']);
    assert.equal(f.app.hasMore, false);
    await f.app.goToPage(1);
    await f.app.fetchData(false, false, true);
    assert.equal(f.app.hasMore, true);
    await f.app.goToPage(2);
    assert.equal(f.app.articles.length, 15);
});

test('failed and superseded requests never consume identities; empty frontier keeps the previous page usable', async () => {
    const f = fixture(); await f.app.fetchData(); const first = ids(f.app);
    f.fail(true); await f.app.goToPage(2);
    assert.equal(f.app.currentPage, 1); assert.deepEqual(ids(f.app), first);
    assert.equal(f.session.snapshot(f.app).pages.length, 1);
    f.fail(false); await f.app.goToPage(2);
    assert.deepEqual(ids(f.app), Array.from({ length: 15 }, (_, i) => `voz:${i + 16}`));
    let release; f.delay(new Promise(resolve => { release = resolve; }));
    const pending = f.app.goToPage(3);
    f.app.articleRequestGeneration++; release(); await pending;
    assert.equal(f.session.snapshot(f.app).pages.length, 2);
    // The winning navigation owns the loading flag after superseding this one.
    f.delay(null); f.app.currentPage = 2; f.app.isLoadingArticles = false;
    f.state.articles = f.state.articles.slice(0, 30);
    const second = ids(f.app);
    await f.app.goToPage(3);
    assert.equal(f.app.currentPage, 2); assert.deepEqual(ids(f.app), second);
    assert.equal(f.app.hasMore, false);
});

test('mobile restored tab retains exclusion history, while explicit refresh and filter changes start fresh', async () => {
    const f = fixture(); await f.app.fetchData(); await f.app.goToPage(2);
    const saved = JSON.parse(JSON.stringify(f.session.snapshot(f.app)));
    const restored = fixture();
    Object.assign(restored.app, { currentPage: 2, articles: JSON.parse(JSON.stringify(f.app.articles)) });
    restored.session.restore(restored.app, saved);
    restored.state.articles = [thread(99), ...restored.state.articles];
    await restored.app.fetchData(false, true, true);
    await restored.app.goToPage(3);
    assert.equal(ids(restored.app)[0], 'voz:99');
    assert.ok(ids(restored.app).every(key => !saved.pages.flatMap(([, keys]) => keys).includes(key)));
    await restored.app.fetchData();
    assert.equal(restored.app.currentPage, 1);
    assert.equal(ids(restored.app)[0], 'voz:99');
    assert.equal(restored.session.snapshot(restored.app).pages.length, 1);
    restored.app.selectedFilterType = 'feed'; restored.app.selectedFilterValue = 'voz-feed';
    await restored.app.fetchData();
    assert.equal(ids(restored.app)[0], 'voz:99');
    assert.equal(restored.calls.at(-1).body.seenArticleKeys.length, 0);
});

test('canonical VOZ identity deduplicates slug, page, unread, tracking and cross-feed aliases', async () => {
    const f = fixture();
    f.state.articles = [thread(1), thread(1, { link: 'https://voz.vn/t/renamed.1/page-8?utm_source=rss#post-55', feedUrl: 'other' }),
        thread(2, { link: 'https://voz.vn/t/title.2/unread' }), ...f.state.articles.slice(2)];
    await f.app.fetchData();
    assert.equal(new Set(ids(f.app)).size, 15);
    f.state.articles = [thread(1, { link: 'https://www.voz.vn/t/new-slug.1/latest' }), ...f.state.articles];
    await f.app.goToPage(2);
    assert.ok(!ids(f.app).includes('voz:1'));
});

test('failed explicit refresh restores the page cursor and history before continuing to the next unseen page', async () => {
    const f = fixture(); await f.app.fetchData(); await f.app.goToPage(2);
    const second = ids(f.app);
    f.fail(true); await f.app.fetchData();
    assert.equal(f.app.currentPage, 2);
    assert.deepEqual(ids(f.app), second);
    assert.equal(f.session.snapshot(f.app).pages.length, 2);
    f.fail(false); await f.app.goToPage(3);
    assert.equal(f.app.currentPage, 3);
    assert.ok(ids(f.app).every(key => !second.includes(key)));
});

test('an initially empty feed can receive its first page in background and then continue normally', async () => {
    const f = fixture(); f.state.articles = [];
    await f.app.fetchData();
    f.state.articles = Array.from({ length: 20 }, (_, i) => thread(i + 1));
    await f.app.fetchData(false, false, true);
    assert.equal(f.app.articles.length, 15);
    await f.app.goToPage(2);
    assert.deepEqual(ids(f.app), Array.from({ length: 5 }, (_, i) => `voz:${i + 16}`));
});

test('selection respects scope, hidden/read/search filters, and existing GET offset semantics', () => {
    const articles = [thread(1), thread(2), thread(3), thread(4, { feedCategory: 'News' }), thread(5)];
    const select = (query, body) => selectFeedPage({ articles, page: 2, limit: 1, query: { filterType: 'category', filterValue: 'Forum', ...query },
        body, hiddenSet: new Set([thread(2).link]), readSet: new Set([thread(3).link]) });
    assert.deepEqual(select({}).articles.map(feedPageKey), ['voz:3']);
    assert.deepEqual(select({ feedPageMode: 'unseen', hideRead: 'true' }, { seenArticleKeys: ['voz:1'] }).articles.map(feedPageKey), ['voz:5']);
    assert.deepEqual(select({ feedPageMode: 'unseen', searchQuery: 'Thread 3' }, {}).articles.map(feedPageKey), ['voz:3']);
    assert.throws(() => select({ feedPageMode: 'unseen' }, { seenArticleKeys: 'invalid' }), /Invalid feed page history/);
});
