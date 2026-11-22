import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createClientArticlePreparer } from '../src/articles/client-preparer.js';
import { createRepository } from '../src/database/sqlite/repository.js';
import { SCHEMA } from '../src/database/sqlite/schema.js';
import { registerContentFilterRoutes } from '../src/routes/content-filter-routes.js';

const now = Date.now();
const iso = ageDays => new Date(now - ageDays * 86400000).toISOString();

function setup(state, findArticles) {
    const routes = new Map();
    const reads = [];
    registerContentFilterRoutes({
        app: { get: (path, ...handlers) => routes.set('GET ' + path, handlers), post: (path, ...handlers) => routes.set('POST ' + path, handlers) },
        env: { RSS_DATA: { findArticles, get: async key => { reads.push(key); return state[key]; }, put: async () => {} } },
    });
    const call = async query => {
        const handlers = routes.get('GET /api/content-filters/suggest');
        let status = 200, body;
        const res = { status(code) { status = code; return res; }, json(data) { body = data; return res; } };
        await handlers.at(-1)({ query }, res);
        return { status, body };
    };
    return { routes, reads, call };
}

const filler = Array.from({ length: 60 }, (_, i) => ({ link: `https://example.test/f${i}`, title: `Tin chung số ${i} về kinh tế`, description: 'Chính phủ cho biết kinh tế tăng trưởng.', pubDate: iso(2) }));
const story = {
    link: 'https://example.test/vinfast', clusterId: 'c1', title: 'VinFast khởi công nhà máy xe điện tại Hà Tĩnh', content: 'VinFast xây nhà máy xe điện mới. Ông Phạm Minh Chính dự lễ khởi công.',
    pubDate: iso(0), smartCategory: 'tech_vietnam', relatedArticles: [{ link: 'https://other.test/a', title: 'Nhà máy VinFast Hà Tĩnh chính thức khởi công' }],
};

test('suggest route is registered behind authentication and returns deterministic suggestions', async () => {
    const { routes, call } = setup({ articles: filler, smartClusters: [story], smartRawArticles: [], blockedArticleKeywords: [] });
    assert.equal(routes.get('GET /api/content-filters/suggest').length, 2, 'authMiddleware must precede the handler');
    const { status, body } = await call({ link: story.link, clusterId: 'c1' });
    assert.equal(status, 200);
    assert.equal(body.title, story.title);
    const keywords = body.suggestions.map(item => item.keyword);
    assert.ok(keywords.length >= 3 && keywords.length <= 8, keywords.join('|'));
    assert.ok(keywords.includes('vinfast'), keywords.join('|'));
    assert.ok(keywords.some(k => k.includes('hà tĩnh')), keywords.join('|'));
    assert.deepEqual((await call({ link: story.link })).body.suggestions, body.suggestions);
});

test('suggest route drops keywords already in Content filters', async () => {
    const { call } = setup({ articles: filler, smartClusters: [story], blockedArticleKeywords: ['VinFast'] });
    const { body } = await call({ link: story.link });
    assert.ok(body.suggestions.length > 0);
    assert.ok(body.suggestions.every(item => !item.keyword.includes('vinfast')));
});

test('suggest route finds plain list articles and validates input', async () => {
    const { call } = setup({ articles: [...filler, { link: 'https://example.test/list', title: 'Apple unveils iPhone 17 in Cupertino', description: 'Tim Cook presented the iPhone 17.', pubDate: iso(0) }], smartClusters: [], blockedArticleKeywords: [] });
    const found = await call({ link: 'https://example.test/list', limit: '3' });
    assert.equal(found.status, 200);
    assert.ok(found.body.suggestions.length > 0 && found.body.suggestions.length <= 3);
    assert.equal((await call({})).status, 400);
    assert.equal((await call({ link: 'javascript:alert(1)' })).status, 400);
    assert.equal((await call({ link: 'https://example.test/missing' })).status, 404);
});

function setupIndexedLookup(t, clusters) {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    db.exec(SCHEMA);
    const repository = createRepository(db);
    repository.write('smartClusters', clusters);
    return setup({ articles: filler }, repository.findArticles);
}

test('suggest route finds the indexed VOZ story after card preparation removes /unread', async t => {
    const link = 'https://voz.vn/t/tam-dung-tuyen-dung-dieu-chuyen-can-bo-cong-chuc-tren-ca-nuoc.1300654';
    const stored = { ...story, title: 'Tạm dừng tuyển dụng, điều chuyển cán bộ, công chức trên cả nước', link: link + '/unread' };
    const { call } = setupIndexedLookup(t, [stored]);
    const prepare = createClientArticlePreparer({ getLastKnownCachedArticleImage: async () => null });
    const card = await prepare(stored);
    assert.equal(card.link, link);
    const { status, body } = await call({ link: card.link, clusterId: card.clusterId });
    assert.equal(status, 200);
    assert.equal(body.title, stored.title);
    assert.ok(body.suggestions.some(item => item.keyword.includes('tuyển dụng')));
    assert.equal((await call({ link: card.link, clusterId: 'other-cluster' })).status, 404);
});

test('suggest route accepts projected Google News cards and old wrapper links across repair', async t => {
    const wrapper = 'https://news.google.com/rss/articles/CBMi' + 'A'.repeat(220);
    const stored = { ...story, link: wrapper, clusterId: wrapper };
    const prepare = createClientArticlePreparer({
        resolveGoogleNewsUrl: async () => story.link,
        getLastKnownCachedArticleImage: async () => null,
    });
    const card = await prepare(stored);
    assert.equal(card.link, story.link);
    assert.equal(card.originalLink, wrapper);
    assert.equal(card.clusterId, story.link);
    const beforeRepair = setupIndexedLookup(t, [stored]);
    const afterRepair = setupIndexedLookup(t, [card]);
    const projected = await beforeRepair.call({ link: card.link, originalLink: card.originalLink, clusterId: card.clusterId });
    const stale = await afterRepair.call({ link: wrapper, clusterId: stored.clusterId });
    assert.equal(projected.status, 200);
    assert.equal(projected.body.title, story.title);
    assert.ok(projected.body.suggestions.length > 0);
    assert.deepEqual(stale, projected);
});

test('the recent-article index is built once and reused within 30 minutes; embeddings are never read', async () => {
    const { call, reads } = setup({ articles: filler, smartClusters: [story], blockedArticleKeywords: [] });
    await call({ link: story.link });
    await call({ link: story.link });
    assert.equal(reads.filter(key => key === 'articles').length, 1, 'a single index build serves both requests');
    assert.ok(reads.every(key => !/embedding|vector/i.test(key)), reads.join(','));
});

test('a failing suggestion lookup returns 500 and logs the error', async () => {
    const { call } = setup({ articles: filler, smartClusters: [story], get blockedArticleKeywords() { throw new Error('storage down'); } });
    const logged = [], original = console.error;
    console.error = (...args) => logged.push(args);
    try {
        const { status, body } = await call({ link: story.link });
        assert.equal(status, 500);
        assert.equal(body.error, 'Could not suggest keywords.');
    } finally { console.error = original; }
    assert.ok(logged.some(args => args.some(arg => arg instanceof Error && /storage down/.test(arg.message))));
});
