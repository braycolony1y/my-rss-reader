import test from 'node:test';
import assert from 'node:assert/strict';
import { createArticlePresentation } from '../src/articles/presentation.js';
import { rankClassicStories, hotnessLabel, displayHotness } from '../src/ranking/classic.js';
import { classicRankingMode } from '../src/ranking/config.js';
import { rankStory } from '../src/articles/story-ranking.js';

const image = 'https://example.com/image.jpg';
const now = Date.now();
const member = (n, domain, title, minutesAgo) => ({ link: `https://${domain}/${n}`, title, pubDate: new Date(now - minutesAgo * 60000).toISOString(), domain, sourceWeight: 1, smartCategory: 'news_global', content: 'Body text of the article.' });
const story = (id, title, domains, minutesAgo = 30) => {
    const [head, ...rest] = domains.map((d, i) => member(`${id}-${i}`, d, i ? `${title} ${['amber', 'birch', 'cobalt', 'dune', 'ember'][i % 5]} ${['fjord', 'garnet', 'harbor', 'ivory', 'juniper'][(i * 2) % 5]} angle ${i}` : title, minutesAgo - i));
    return { ...head, clusterId: id, isCluster: true, image, relatedArticles: rest, clusterCount: domains.length };
};
const fixture = () => ({
    smartClusters: [
        story('quiet', 'Council schedules a routine meeting for next week', ['a.com']),
        story('hot', 'Council schedules a routine meeting', ['o1.com', 'o2.com', 'o3.com', 'o4.com', 'o5.com']),
        story('bank', 'Central bank raises interest rate as inflation surges', ['b1.com', 'b2.com'], 90)
    ],
    smartRawArticles: [], smartClusterVersion: 'v1', hiddenStates: [], readStates: []
});
const noVectors = { get: () => null, warm: () => null, revision: 0 };
const serve = async (state, rankingVectors = noVectors, query = {}) => {
    const presentation = createArticlePresentation({ generateBriefing: async () => { throw Error('briefings must not be needed to rank'); },
        rankingVectors, env: { RSS_DATA: { get: async key => state[key] } } });
    let result;
    await presentation.serveSmartData({ query: { filterValue: 'news_global', smartMode: 'classic', ...query } }, { setHeader() {}, json(value) { result = value; } });
    return result;
};
const withMode = async (mode, fn) => {
    const previous = process.env.CLASSIC_RANKING;
    if (mode === undefined) delete process.env.CLASSIC_RANKING; else process.env.CLASSIC_RANKING = mode;
    try { return await fn(); } finally { if (previous === undefined) delete process.env.CLASSIC_RANKING; else process.env.CLASSIC_RANKING = previous; }
};

test('Classic ranks with the deterministic ranker by default and exposes its labels', async () => {
    const result = await withMode(undefined, () => serve(fixture()));
    assert.equal(result.articles.length, 3);
    for (const article of result.articles) {
        assert.equal(article.ranking.model, 'nonai-ranker-v1');
        assert.equal(article.hotness, article.ranking.score);
        assert.ok(article.hotness >= 1 && article.hotness <= 10);
        assert.equal(article.ranking.signals.importance, undefined, 'legacy rankStory signals are gone');
    }
    const byId = Object.fromEntries(result.articles.map(a => [a.clusterId, a]));
    assert.equal(byId.hot.ranking.hot, true, '5 outlets inside the window trigger the hot floor');
    assert.equal(byId.hot.hotnessLabel === 'Hot' || byId.hot.hotnessLabel === 'Breaking', true);
    assert.ok(result.articles.findIndex(a => a.clusterId === 'hot') < 3);
    assert.equal(byId.quiet.ranking.hot, false);
});

test('CLASSIC_RANKING=legacy restores rankStory ordering and fields', async () => {
    const result = await withMode('legacy', () => serve(fixture()));
    const expected = fixture().smartClusters.map(c => ({ id: c.clusterId, ...rankStory([c, ...c.relatedArticles], 'news_global', Date.now(), null) }));
    for (const article of result.articles) {
        assert.equal(article.ranking.model, undefined);
        assert.ok(article.ranking.signals.importance !== undefined, 'legacy signals present');
        assert.equal(article.hotnessLabel, undefined);
        assert.equal(article.ranking.score, expected.find(e => e.id === article.clusterId).score);
    }
    const order = result.articles.map(a => a.ranking.score);
    assert.deepEqual(order, [...order].sort((a, b) => b - a), 'legacy sorts by hotness');
    assert.equal(classicRankingMode(), 'stories');
});

test('the flag is read per request and anything other than legacy selects the new ranker', async () => {
    await withMode('legacy', async () => assert.equal(classicRankingMode(), 'legacy'));
    await withMode('Legacy ', async () => assert.equal(classicRankingMode(), 'legacy'));
    await withMode('embed', async () => assert.equal(classicRankingMode(), 'stories'));
    const result = await withMode('embed', () => serve(fixture()));
    assert.equal(result.articles[0].ranking.model, 'nonai-ranker-v1');
});

test('vectors are requested for every member, and a slow cache degrades instead of blocking', async () => {
    const requested = [];
    const slow = { get: () => null, revision: 0, warm: articles => { requested.push(articles.length); return new Promise(() => {}); } };
    process.env.RANKING_VECTOR_WAIT_MS = '40';
    const started = Date.now();
    let result;
    try { result = await withMode(undefined, () => serve(fixture(), slow)); } finally { delete process.env.RANKING_VECTOR_WAIT_MS; }
    assert.equal(result.articles.length, 3);
    assert.deepEqual(requested, [8], 'all member articles of all stories (1 + 5 + 2) are warmed once');
    assert.ok(Date.now() - started < 2000, 'did not wait for the stuck cache');
    assert.equal(result.articles[0].ranking.signals.e5, false, 'no vector: e5 features neutral');
});

test('a pinned smartView keeps its order and pagination across requests', async () => {
    const state = fixture();
    const presentation = createArticlePresentation({ rankingVectors: noVectors, env: { RSS_DATA: { get: async key => state[key] } } });
    const request = async query => { let r; await presentation.serveSmartData({ query: { filterValue: 'news_global', smartMode: 'classic', limit: '2', ...query } }, { setHeader() {}, json(v) { r = v; } }); return r; };
    const first = await request({});
    assert.equal(first.articles.length, 2);
    assert.equal(first.hasMore, true);
    state.smartClusters = [story('newer', 'Earthquake forces city evacuation', ['n1.com', 'n2.com', 'n3.com', 'n4.com']), ...state.smartClusters];
    const second = await request({ smartView: first.smartViewToken, page: '2' });
    assert.equal(second.viewReset, false);
    const all = [...first.articles, ...second.articles].map(a => a.clusterId);
    assert.equal(new Set(all).size, 3, 'pages of one pinned view never repeat or skip stories');
    assert.ok(!all.includes('newer'), 'the new story waits for a fresh view');
});

test('rankClassicStories keeps the legacy display contract and labels', () => {
    const articles = fixture().smartClusters;
    const ranked = rankClassicStories(articles, { destination: 'news_global', now });
    assert.deepEqual(new Set(ranked.map(a => a.clusterId)), new Set(['quiet', 'hot', 'bank']));
    for (const a of ranked) { assert.equal(typeof a.ranking.updatedAt, 'string'); assert.ok(a.sourceCount >= 1); }
    assert.equal(displayHotness(0), 1);
    assert.equal(displayHotness(2), 10);
    assert.equal(displayHotness(0.456), 4.6);
    assert.equal(hotnessLabel({ tier: 2, hotness: 7 }), 'Breaking');
    assert.equal(hotnessLabel({ tier: 2, hotness: 2 }), 'Breaking', 'tier 2 is Breaking whatever the score');
    assert.equal(hotnessLabel({ tier: 1, hotness: 3 }), 'Hot');
    assert.equal(hotnessLabel({ hotness: 9 }), 'Hot');
    assert.equal(hotnessLabel({ sourceCount: 7, hotness: 6 }), 'Widely reported');
    assert.equal(hotnessLabel({ sourceCount: 2, hotness: 3 }), '');
});

test('hotness labels use the recalibrated thresholds and legacy mode keeps 5.5/6.5/7.5', async () => {
    const { getHotnessLabel } = await import('../src/smart/clustering/cluster.js');
    assert.equal(hotnessLabel({ hotness: 7.7 }), '');
    assert.equal(hotnessLabel({ hotness: 7.8 }), 'Hot');
    assert.equal(hotnessLabel({ hotness: 8.7, fresh: 0.9 }), 'Breaking');
    assert.equal(hotnessLabel({ hotness: 8.7, fresh: 0.3 }), 'Hot', 'a stale high score is Hot, not Breaking');
    assert.equal(hotnessLabel({ tier: 1, hotness: 3 }), 'Hot', 'the hot floor still lifts to Hot');
    const cluster = hotness => ({ hotness, sourceCount: 1, ranking: { signals: { freshness: 0.9 } } });
    assert.equal(getHotnessLabel(cluster(7.0)), '');
    assert.equal(getHotnessLabel(cluster(8.0)), 'Hot');
    assert.equal(getHotnessLabel(cluster(8.8)), 'Breaking');
    assert.equal(getHotnessLabel({ hotness: 3, sourceCount: 12, ranking: { tier: 2, hot: true } }), 'Breaking');
    assert.equal(getHotnessLabel({ hotness: 3, sourceCount: 4, ranking: { tier: 1, hot: true } }), 'Hot');
    const before = process.env.CLASSIC_RANKING;
    process.env.CLASSIC_RANKING = 'legacy';
    try {
        assert.equal(getHotnessLabel({ hotness: 5.4, sourceCount: 1 }), '');
        assert.equal(getHotnessLabel({ hotness: 5.5, sourceCount: 1 }), 'Hot');
        assert.equal(getHotnessLabel({ hotness: 6.5, sourceCount: 6 }), 'Widely reported');
        assert.equal(getHotnessLabel({ hotness: 7.5, sourceCount: 4 }), 'Breaking');
        assert.equal(getHotnessLabel({ hotness: 3, sourceCount: 12, ranking: { tier: 2, hot: true } }), '', 'legacy mode ignores the floor tiers');
        assert.equal(getHotnessLabel({ hotness: 7.5, sourceCount: 3 }), 'Hot');
    } finally { if (before === undefined) delete process.env.CLASSIC_RANKING; else process.env.CLASSIC_RANKING = before; }
});
