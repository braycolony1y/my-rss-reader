import test from 'node:test';
import assert from 'node:assert/strict';
import { createTopStoriesSnapshots } from '../src/articles/top-stories-snapshot.js';

const MB = 1024 * 1024;
const time = Date.parse('2026-09-23T08:00:00Z');
const article = id => ({
    clusterId: id, link: `https://example.com/${id}`, title: `Central bank cuts interest rates ${id}`,
    content: 'The central bank approved a national interest rate cut.',
    language: 'en', smartCategory: 'news_global', feedCategory: 'news_global',
    feedUrl: 'https://example.com/rss', pubDate: new Date(time).toISOString()
});
const old = {
    policy: 2, signature: 'old', articles: [{...article('old'), ranking: {score: 1},
        topStory: {feed: 'news_global', rank: 1, isTop: true, cutoff: {count: 1}}}]
};
function fixture(extra = {}) {
    const values = {
        topStoriesPublished: structuredClone(old), smartClusters: JSON.stringify([article('new')]),
        smartRawArticles: '[]', smartSources: [{url: 'https://example.com/rss', category: 'news_global'}],
        smartClusterVersion: 'v2', topStoriesState: '{}', ...extra
    };
    const reads = [], writes = [];
    const db = {
        async get(key, options) {
            reads.push([key, options]);
            assert.ok(!['smartClusters', 'smartRawArticles', 'smartProgressivePublication', 'topStoriesState'].includes(key) || !options?.type,
                `${key} must remain serialized in the parent`);
            return values[key];
        },
        async put(key, value) { writes.push(key); values[key] = value; }
    };
    return {db, reads, writes, values};
}

test('real worker ranks above the old memory threshold without parsing the corpus in the parent', async t => {
    const f = fixture();
    const warnings = [];
    const snapshots = createTopStoriesSnapshots({db: f.db, now: () => time,
        heapStatistics: () => ({heap_size_limit: 4288 * MB}), memoryUsage: () => ({heapUsed: 3200 * MB}),
        report: (...args) => warnings.push(args)});
    t.after(() => snapshots.dispose());
    const result = await snapshots.revalidate();
    assert.notEqual(result.signature, 'old', JSON.stringify(warnings));
    assert.equal(result.articles[0].link, article('new').link);
    assert.deepEqual(f.writes, ['topStoriesState', 'topStoriesPublished']);
    await snapshots.revalidate();
    assert.equal(f.writes.length, 2, 'unchanged input is not reranked');
    f.values.smartRawArticles = JSON.stringify([article('fresh')]);
    await snapshots.revalidate();
    assert.equal(f.writes.length, 4, 'fresh raw articles invalidate the ranking immediately');
});

test('critical pressure preserves cached cards and retries automatically after memory recovers', async t => {
    t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: time});
    const f = fixture();
    let heapUsed = 4100 * MB;
    const snapshots = createTopStoriesSnapshots({db: f.db,
        heapStatistics: () => ({heap_size_limit: 4288 * MB}), memoryUsage: () => ({heapUsed}), report: () => {}});
    t.after(() => snapshots.dispose());
    assert.equal((await snapshots.revalidate()).signature, 'old');
    assert.equal(f.writes.length, 0);
    assert.ok(snapshots.pending, 'recovery timer remains armed');
    heapUsed = 700 * MB;
    t.mock.timers.tick(15000);
    const result = await snapshots.revalidate();
    assert.notEqual(result.signature, 'old');
    assert.ok(f.writes.includes('topStoriesPublished'));
});

test('worker rejects a mismatched progressive revision without changing durable state', async t => {
    const f = fixture({smartProgressiveClusterState: {active: true, provisional: true, version: 'p1', revision: 2},
        smartProgressivePublication: JSON.stringify({version: 'p1', revision: 1, clusters: [article('new')]})});
    const snapshots = createTopStoriesSnapshots({db: f.db, report: () => {}});
    t.after(() => snapshots.dispose());
    assert.equal((await snapshots.revalidate()).signature, 'old');
    assert.deepEqual(f.writes, []);
});

test('raw articles can publish the first ranking before any clusters exist', async t => {
    const f = fixture({smartClusters: '[]', smartRawArticles: JSON.stringify([article('new')])});
    const snapshots = createTopStoriesSnapshots({db: f.db, report: () => {}});
    t.after(() => snapshots.dispose());
    assert.equal((await snapshots.revalidate()).articles[0].link, article('new').link);
});

test('invalid ranking does not overwrite editorial state', async t => {
    const values = {topStoriesPublished: old, smartClusters: [article('new')], smartSources: [], topStoriesState: '{}'};
    const writes = [];
    const snapshots = createTopStoriesSnapshots({db: {get: async key => values[key], put: async key => writes.push(key)},
        compute: async () => ({articles: [], statesJson: '{"invalid":true}'}), report: () => {}});
    t.after(() => snapshots.dispose());
    assert.equal((await snapshots.revalidate()).signature, 'old');
    assert.deepEqual(writes, []);
});

test('split stories cannot reuse an identity already inherited by a sibling', async () => {
    const {createTopStoriesIndex} = await import('../src/articles/top-stories.js');
    const {createHash} = await import('node:crypto');
    const second = {...article('second'), clusterId: undefined, title: 'Earthquake forces evacuation of coastal cities', content: 'A powerful earthquake forces residents to evacuate coastal cities.'};
    const collisionId = createHash('sha256').update(JSON.stringify([second.link])).digest('hex').slice(0, 24);
    const first = {...article('first'), clusterId: collisionId};
    const values = {};
    const index = createTopStoriesIndex({db: {get: async key => values[key], put: async (key, value) => {values[key] = JSON.parse(value);}}});
    const sources = [{url: first.feedUrl, category: 'news_global'}];
    const result = await index.rank([first, second], sources, time);
    assert.equal(result.length, 2);
    assert.equal(new Set(result.map(a => a.clusterId)).size, 2);
    assert.equal(Object.keys(values.topStoriesState).length, 2);
    const repeated = await index.rank([first, second], sources, time + 60000);
    for (const a of result) assert.equal(repeated.find(b => b.link === a.link).clusterId, a.clusterId);
});
