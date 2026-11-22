import test from 'node:test';
import assert from 'node:assert/strict';
import { createArticlePresentation } from '../src/articles/presentation.js';
import { registerContentFilterRoutes } from '../src/routes/content-filter-routes.js';
import { registerDataRoutes } from '../src/routes/data-routes.js';

const image = 'https://example.com/photo.jpg';
const recent = () => new Date().toISOString();
const cluster = (id, title, extra = {}) => ({ clusterId: id, isCluster: true, link: `https://example.com/${id}`, title, smartCategory: 'news_global', pubDate: recent(), image, relatedArticles: [], ...extra });

async function stories(blocked, clusters, overrides = {}) {
    const state = { smartClusters: clusters, smartRawArticles: [], smartClusterVersion: 'fixture', hiddenStates: [], readStates: [], blockedArticleKeywords: blocked, ...overrides };
    const presentation = createArticlePresentation({
        env: { RSS_DATA: { get: async key => state[key] } },
        rankingVectors: { revision: 0, get: () => null, warm: async () => {} },
    });
    let result;
    await presentation.serveSmartData({ query: { filterValue: 'news_global' } }, { setHeader() {}, json(data) { result = data; } });
    return result.articles;
}

const storyIds = articles => articles.map(article => article.clusterId).sort();

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
    const shown = storyIds(await stories(['vinfast'], fixtures()));
    assert.ok(!shown.includes('title'));
    assert.ok(!shown.includes('snippet'), 'matched in the snippet with different case');
    assert.deepEqual(shown.sort(), ['member-only', 'mixed', 'other']);
});

test('a matching stored lead hides its entire cluster even when the lead is also manually hidden', async () => {
    const member = { link: 'https://example.com/member', title: 'Hãng xe Mỹ điều chỉnh giá bán' };
    const lead = cluster('matching-lead', 'Tesla giảm giá xe điện', {
        verification: { method: 'test' },
        relatedArticles: [member]
    });
    const rawMember = { ...member, link: 'https://example.com/publisher', originalLink: member.link,
        pubDate: lead.pubDate, smartCategory: lead.smartCategory };
    const options = { smartRawArticles: [rawMember] };
    assert.equal((await stories([], [lead], options))[0].relatedArticles.length, 1);
    assert.deepEqual(await stories(['tesla'], [lead], options), []);
    const manuallyHidden = { ...options, hiddenStates: [lead.link] };
    assert.equal((await stories([], [lead], manuallyHidden))[0].link, member.link);
    assert.deepEqual(await stories(['tesla'], [lead], manuallyHidden), []);
});

test('a matching non-lead is removed while the original lead and other coverage stay', async () => {
    const matching = { link: 'https://example.com/matching', title: 'Tesla giảm giá xe điện' };
    const other = { link: 'https://example.com/coverage', title: 'Hãng xe Mỹ điều chỉnh giá bán' };
    const lead = cluster('clean-lead', 'Thị trường ô tô tháng này', {
        verification: { method: 'test' },
        relatedArticles: [matching, other]
    });
    const [shown] = await stories(['tesla'], [lead]);
    assert.equal(shown.clusterId, lead.clusterId);
    assert.equal(shown.link, lead.link);
    assert.equal(shown.title, lead.title);
    assert.equal(shown.clusterCount, 2);
    assert.deepEqual(shown.relatedArticles.map(article => article.link), [other.link]);
});

test('matching is Vietnamese-diacritic-aware and keeps existing semantics (no accent folding)', async () => {
    const items = [cluster('a', 'Bão số 3 đổ bộ'), cluster('b', 'Bao so 3 la gi'), cluster('c', 'BÃO số 5 mạnh dần')];
    assert.deepEqual(storyIds(await stories(['bão'], items)), ['b']);
    assert.deepEqual(storyIds(await stories(['BÃO'], items)), ['b']);
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
    const shown = storyIds(await stories(['giá vàng', 'vinfast'], fixtures()));
    assert.deepEqual(shown, ['member-only', 'mixed']);
});

test('content filter preview counts whole-cluster effects per keyword and deduplicates raw and feed copies', async () => {
    const member = { link: 'https://example.com/member', title: 'Cà Mau mở hội tôm', content: 'Lễ khai mạc.' };
    const other = { link: 'https://example.com/other', title: 'Cà Mau giới thiệu sản phẩm địa phương' };
    const lead = cluster('lead', 'Tôn vinh bản sắc văn hóa, nâng tầm thương hiệu tôm Cà Mau', {
        verification: { method: 'test' },
        relatedArticles: [member, other]
    });
    const state = {
        articles: [lead, member, other],
        smartRawArticles: [lead, member, other],
        smartClusters: [lead]
    };
    let handler;
    registerContentFilterRoutes({
        app: { get() {}, post(path, ...args) { if (path === '/api/content-filter-preview') handler = args.at(-1); } },
        env: { RSS_DATA: { get: async key => state[key] } },
    });
    const leadKeyword = 'tôn vinh bản sắc văn hóa';
    const memberKeyword = 'lễ khai mạc';
    const preview = async selectedKeyword => {
        let result;
        await handler({ body: { keywords: [leadKeyword, memberKeyword], selectedKeyword } }, { json(data) { result = data; } });
        return result;
    };
    const leadPreview = await preview(leadKeyword);
    assert.equal(leadPreview.total, 3);
    assert.equal(leadPreview.overallTotal, 3);
    assert.deepEqual(leadPreview.keywordTotals, [{ keyword: leadKeyword, total: 3 }, { keyword: memberKeyword, total: 1 }]);
    const affectedMember = leadPreview.matches.find(article => article.link === member.link);
    assert.deepEqual(affectedMember.surfaces, ['Smart']);
    assert.deepEqual(affectedMember.matches[0].fieldLabels, ['Story lead (Title)']);
    assert.match(affectedMember.matches[0].snippet, /Tôn vinh bản sắc văn hóa/);
    const memberPreview = await preview(memberKeyword);
    assert.equal(memberPreview.total, 1);
    assert.deepEqual(memberPreview.matches.map(article => article.link), [member.link]);
    assert.deepEqual(memberPreview.matches[0].surfaces, ['Feed', 'Smart']);
});
