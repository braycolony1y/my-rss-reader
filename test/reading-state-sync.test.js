import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { registerSettingsRoutes } from '../src/routes/settings-routes.js';

function readingState(fetch = async () => ({ ok: true })) {
    const context = vm.createContext({ fetch });
    vm.runInContext(readFileSync(new URL('../public/js/feeds/reading-state.js', import.meta.url), 'utf8'), context);
    return vm.runInContext('ReaderFeedsReadingState.create()', context);
}

test('two devices retain concurrent read writes and receive VOZ positions and removals', async () => {
    const handlers = {};
    const state = { userPreferences: { voz_last_read_post_123456: '{"index":"42","absId":"789"}' }, readStates: [], savedStates: ['https://example.com/saved'] };
    registerSettingsRoutes({
        app: { get: (url, ...args) => handlers[url] = args.at(-1), post: (url, ...args) => handlers[url] = args.at(-1) },
        env: { RSS_DATA: {
            get: async key => structuredClone(state[key]),
            put: async (key, value) => { await new Promise(resolve => setTimeout(resolve, 5)); state[key] = JSON.parse(value); }
        } },
        normalizeClusteringModel: value => value
    });
    const response = () => ({ setHeader() {}, status() { return this; }, send() {}, json(value) { this.data = value; } });
    await Promise.all(['a', 'b'].map(id => handlers['/api/toggle']({ body: { link: `https://example.com/${id}`, list: 'readStates', forceAdd: true } }, response())));
    let res = response();
    await handlers['/api/user-states']({}, res);
    assert.equal(res.data.readStates.length, 2);
    assert.equal(res.data.userPreferences.voz_last_read_post_123456, state.userPreferences.voz_last_read_post_123456);
    assert.deepEqual(res.data.savedStates, state.savedStates);
    await handlers['/api/toggle-batch']({ body: { links: ['https://example.com/a/'], list: 'readStates', forceRemove: true } }, response());
    res = response();
    await handlers['/api/user-states']({}, res);
    assert.deepEqual(res.data.readStates, ['https://example.com/b']);
});

test('decoded cards mark the publisher URL and can clear both read aliases', async () => {
    const calls = [];
    const app = readingState(async (url, { body }) => { calls.push([url, JSON.parse(body)]); return { ok: true }; });
    const article = { link: 'https://example.com/story', originalLink: 'https://news.google.com/articles/example', feedUrl: 'https://example.com/feed' };
    app.readStates.add(article.originalLink);
    app.articles = [article];
    app.prefetchNextAfter = () => {};
    app.unreadCounts = { total: 0, feeds: {}, categories: {} };

    assert.equal(app.hasArticleState('readStates', article), true);
    await app.markAsReadExplicit(article);
    assert.deepEqual(calls[0], ['/api/toggle', { link: article.link, list: 'readStates', forceAdd: true }]);
    assert.equal(app.unreadCounts.total, 0);
    await app.toggleState('readStates', article);
    assert.deepEqual(calls[1], ['/api/toggle-batch', { links: [article.originalLink, article.link], list: 'readStates', forceRemove: true }]);
    assert.equal(app.hasArticleState('readStates', article), false);
    assert.equal(app.unreadCounts.total, 1);
});

test('batch state updates preserve existing entries above the legacy cap after repair', async () => {
    const handlers = {};
    const originalLink = 'https://news.google.com/read/example';
    const destination = 'https://example.com/decoded';
    const original = [originalLink, destination, ...Array.from({ length: 2000 }, (_, i) => `https://example.com/${i}`)];
    const state = { readStates: original, googleNewsUrlCache: { [originalLink]: { resolvedUrl: destination } } };
    registerSettingsRoutes({
        app: { get() {}, post: (url, ...args) => handlers[url] = args.at(-1) },
        env: { RSS_DATA: {
            get: async key => structuredClone(state[key]),
            put: async (key, value) => { state[key] = JSON.parse(value); }
        } }
    });
    const res = { status() { return this; }, send() {} };
    await handlers['/api/toggle-batch']({ body: { links: [original.at(-1)], list: 'readStates', forceRemove: true } }, res);
    assert.deepEqual(state.readStates, original.slice(0, -1));
});

test('single and batch state updates cap distinct identities and keep both aliases', async () => {
    const handlers = {};
    const originalLink = 'https://news.google.com/read/example';
    const destination = 'https://example.com/decoded';
    const legacy = Array.from({ length: 2500 }, (_, i) => 'https://example.com/' + i);
    const state = { hiddenStates: [...legacy, originalLink, destination] };
    registerSettingsRoutes({
        app: { get() {}, post: (url, ...args) => handlers[url] = args.at(-1) },
        env: { RSS_DATA: {
            get: async key => structuredClone(state[key]),
            getEntries: async (key, keys) => {
                assert.equal(key, 'googleNewsUrlCache');
                assert.deepEqual(keys, [originalLink]);
                return { [originalLink]: { resolvedUrl: destination } };
            },
            put: async (key, value) => { state[key] = JSON.parse(value); }
        } }
    });
    const res = { status() { return this; }, send() {} };
    const single = 'https://example.com/new';
    await handlers['/api/toggle']({ body: { link: single, list: 'hiddenStates', forceAdd: true } }, res);
    assert.deepEqual(state.hiddenStates, [...legacy.slice(-1998), originalLink, destination, single]);
    const batch = ['https://example.com/batch1', 'https://example.com/batch2'];
    await handlers['/api/toggle-batch']({ body: { links: batch, list: 'hiddenStates', forceAdd: true } }, res);
    assert.deepEqual(state.hiddenStates, [...legacy.slice(-1996), originalLink, destination, single, ...batch]);
});

test('hidden badge counts loaded article aliases once and keeps unmatched entries', () => {
    const app = readingState();
    const originalLink = 'https://news.google.com/read/example';
    const link = 'https://example.com/decoded';
    app.articles = [{ link: 'https://example.com/parent', relatedArticles: [{ link, originalLink }] }, { link, originalLink }];
    app.hiddenStates = [originalLink + '/', link, link + '/', 'https://example.com/elsewhere', 'https://example.com/elsewhere/'];
    assert.equal(app.hiddenArticleCount(), 2);
});

test('hidden badge includes each repaired identity once even when its article is off-page', async () => {
    const handlers = {};
    const originalLink = 'https://news.google.com/read/offPage';
    const destination = 'https://example.com/hidden';
    const values = {
        hiddenStates: [originalLink + '/', destination, 'https://example.com/unrelated'],
        googleNewsUrlCache: { [originalLink]: { resolvedUrl: destination, source: 'offline' } }
    };
    registerSettingsRoutes({
        app: { get: (url, ...args) => handlers[url] = args.at(-1), post() {} },
        env: { RSS_DATA: { get: async key => values[key] } }
    });
    const app = readingState(async url => {
        const res = { setHeader() {}, json(data) { this.data = data; } };
        await handlers[url]({}, res);
        return { ok: true, json: async () => res.data };
    });
    app.isLoggedIn = true;
    app.articles = [];
    app.flushUserPreferences = async () => {};
    await app.syncUserStatesInBackground();
    assert.deepEqual(app.hiddenStateAliases, { [originalLink]: destination });
    assert.equal(app.hiddenArticleCount(), 2);
    app.hiddenStates = [originalLink];
    assert.equal(app.hiddenArticleCount(), 1);
});

test('alternating read and unread restores all feed counters and skips hidden aliases', async () => {
    const app = readingState();
    const article = { link: 'https://example.com/story', originalLink: 'https://news.google.com/read/story',
        feedUrl: 'https://example.com/feed', feedCategory: 'News' };
    app.articles = [article];
    app.prefetchNextAfter = () => {};
    const visible = { total: 3, feeds: { [article.feedUrl]: 2 }, categories: { News: 3 } };
    const read = { total: 2, feeds: { [article.feedUrl]: 1 }, categories: { News: 2 } };
    app.unreadCounts = structuredClone(visible);
    await app.toggleState('readStates', article.link);
    assert.deepEqual(app.unreadCounts, read);
    await app.toggleState('readStates', article);
    assert.deepEqual(app.unreadCounts, visible);

    app.hiddenStates = [article.originalLink];
    app.unreadCounts = structuredClone(read);
    await app.toggleState('readStates', article);
    await app.toggleState('readStates', article);
    assert.deepEqual(app.unreadCounts, read);
});

test('marking an unlisted story read or unread leaves feed counters alone', async () => {
    const app = readingState();
    app.articles = [];
    app.prefetchNextAfter = () => {};
    app.unreadCounts = { total: 0, feeds: {}, categories: {} };
    const article = { link: 'https://example.com/story', originalLink: 'https://news.google.com/read/story', feedUrl: 'https://example.com/feed' };
    await app.markAsReadExplicit(article);
    assert.equal(app.hasArticleState('readStates', article), true);
    await app.toggleState('readStates', article);
    assert.equal(app.hasArticleState('readStates', article), false);
    assert.deepEqual(app.unreadCounts, { total: 0, feeds: {}, categories: {} });
});
