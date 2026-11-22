import test from 'node:test';
import assert from 'node:assert/strict';
import { createArticlePresentation } from '../src/articles/presentation.js';
import { registerDataRoutes } from '../src/routes/data-routes.js';

const image = 'https://example.com/photo.jpg';
const recent = () => new Date().toISOString();
const cluster = (id, title, extra = {}) => ({ clusterId: id, isCluster: true, link: `https://example.com/${id}`, title, smartCategory: 'news_global', pubDate: recent(), image, relatedArticles: [], ...extra });

async function stories(blocked, clusters) {
    const state = { smartClusters: clusters, smartRawArticles: [], smartClusterVersion: 'v-' + Math.random(), hiddenStates: [], readStates: [], blockedArticleKeywords: blocked };
    const presentation = createArticlePresentation({ generateBriefing: async () => { throw Error('offline'); }, env: { RSS_DATA: { get: async key => state[key] } } });
    let result;
    await presentation.serveSmartData({ query: { filterValue: 'news_global' } }, { setHeader() {}, json(data) { result = data; } });
    return result.articles.map(article => article.clusterId);
}

async function list(blocked, articles) {
    const state = { articles, blockedArticleKeywords: blocked, readStates: [] };
    let handler;
    registerDataRoutes({
        app: { post() {}, get: (...args) => { handler = args.at(-1); } },
        env: { RSS_DATA: { get: async key => state[key] } },
        prepareArticleForClient: async article => ({ link: article.link }),
    });
    let result;
    await handler({ query: { filterType: 'category', filterValue: 'World' } }, { json: data => { result = data; } });
    return result.articles.map(article => article.link);
}

const fixtures = () => [
    cluster('title', 'VinFast khởi công nhà máy xe điện mới'),
    cluster('snippet', 'Nhà máy sản xuất xe', { content: 'Dự án của VINFAST tại Hà Tĩnh.' }),
    cluster('member-only', 'Thị trường ô tô tháng này', { relatedArticles: [{ link: 'https://example.com/m1', title: 'Tesla giảm giá' }] }),
    cluster('mixed', 'Tesla giảm giá xe điện', { relatedArticles: [{ link: 'https://example.com/m2', title: 'Hãng xe Mỹ điều chỉnh giá bán' }] }),
    cluster('other', 'Giá vàng hôm nay tăng'),
];

test('Stories sections hide clusters whose title or snippet matches a Content filter keyword, ignoring case', async () => {
    const shown = await stories(['vinfast'], fixtures());
    assert.ok(!shown.includes('title'));
    assert.ok(!shown.includes('snippet'), 'matched in the snippet with different case');
    assert.deepEqual(shown.sort(), ['member-only', 'mixed', 'other']);
});

test('member titles are matched: matching members drop out, and a story with no member left is hidden', async () => {
    const shown = await stories(['tesla'], fixtures());
    // "mixed" keeps its non-matching member; "member-only" keeps its own cluster title (the representative).
    assert.ok(shown.includes('other'));
    assert.ok(shown.includes('title') && shown.includes('snippet'));
    const onlyMatching = await stories(['tesla'], [cluster('all-match', 'Tesla ra mắt mẫu mới', { relatedArticles: [{ link: 'https://example.com/x', title: 'Tesla Model Y' }] })]);
    assert.deepEqual(onlyMatching, []);
});

test('matching is Vietnamese-diacritic-aware and keeps existing semantics (no accent folding)', async () => {
    const items = [cluster('a', 'Bão số 3 đổ bộ'), cluster('b', 'Bao so 3 la gi'), cluster('c', 'BÃO số 5 mạnh dần')];
    assert.deepEqual((await stories(['bão'], items)).sort(), ['b']);
    assert.deepEqual((await stories(['BÃO'], items)).sort(), ['b']);
});

test('the same keywords hide matching articles in ordinary lists', async () => {
    const articles = [
        { link: 'https://example.com/1', title: 'VinFast khởi công nhà máy', feedCategory: 'World' },
        { link: 'https://example.com/2', title: 'Nhà máy', content: 'Dự án của VINFAST', feedCategory: 'World' },
        { link: 'https://example.com/3', title: 'Giá vàng', feedCategory: 'World' },
    ];
    assert.deepEqual(await list(['vinfast'], articles), ['https://example.com/3']);
    assert.deepEqual(await list([], articles), articles.map(article => article.link));
});

test('existing entries keep working alongside newly added ones', async () => {
    const shown = await stories(['giá vàng', 'vinfast'], fixtures());
    assert.deepEqual(shown.sort(), ['member-only', 'mixed']);
});
