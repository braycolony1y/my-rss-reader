import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSqliteDatabaseStore } from '../src/database/sqlite/store.js';
import { openSqlite } from '../src/database/sqlite/connection.js';
import { createGoogleNewsResolver } from '../src/articles/google-news.js';
import { publishFeedResults } from '../src/feeds/publish-results.js';
import { registerDataRoutes } from '../src/routes/data-routes.js';
import { createRepository } from '../src/database/sqlite/repository.js';
import { retainedCacheEntries } from '../src/database/sqlite/cache-retention.js';

const wrapper = 'https://news.google.com/read/' + Buffer.from('AU_yqL-storage').toString('base64url');
const memberWrapper = 'https://news.google.com/articles/' + Buffer.from('AU_yqL-member').toString('base64url');

test('SQLite repair adds publisher state aliases and publication preserves them alongside repaired rows and snapshots', async t => {
    const root = await fs.mkdtemp('/tmp/rss-google-news-storage-');
    const feedUrl = 'https://news.google.com/rss/search?q=site%3Aexample.com';
    const primary = { link: wrapper, articleKey: wrapper, title: 'Primary', id: 'stable-id', guid: 'stable-guid',
        feedUrl, pubDate: '2026-11-01', domain: 'news.google.com',
        custom: { retained: true }, relatedArticles: [{ link: memberWrapper, title: 'Related', feedUrl: 'https://news.google.com/rss/search?q=site%3Aexample.net' }] };
    const states = { readStates: [wrapper, memberWrapper], savedStates: [wrapper], hiddenStates: [wrapper, memberWrapper], boardStates: [wrapper] };
    const otherState = { cacheMembers: JSON.stringify({ [wrapper]: { in_cache: true, url: wrapper } }),
        cacheIdentityLedger: JSON.stringify({ articles: { [wrapper]: { keep: 'exact' } } }), userPreferences: '{"theme":"glass"}' };
    const snapshot = { feeds: JSON.stringify([{ url: feedUrl, title: 'News', category: 'News' }]), articles: JSON.stringify([primary]), smartClusters: JSON.stringify([primary]), smartRawArticles: JSON.stringify([primary]),
        topStoriesPublished: JSON.stringify({ articles: [primary], metadata: 'keep' }), universalPrefetchTargets: JSON.stringify([primary]),
        storyBriefings: JSON.stringify({ one: { articles: [primary] } }), topStoriesState: JSON.stringify({ articles: [primary] }), ...Object.fromEntries(Object.entries(states).map(([key, links]) => [key, JSON.stringify(links)])), ...otherState };
    await fs.writeFile(path.join(root, 'database.json'), JSON.stringify(snapshot));
    const owner = createSqliteDatabaseStore({ root }); const db = owner.env.RSS_DATA;
    t.after(async () => { await owner.close(); await fs.rm(root, { recursive: true, force: true }); });
    const initial = await db.get('smartClusters', { type: 'json', shared: true });
    const before = await db.get('topStoriesPublished', { fingerprint: true });
    const result = await db.repairGoogleNewsUrls({ [wrapper]: 'https://example.com/a?utm_source=google', [memberWrapper]: 'https://example.net/b' });
    assert.ok(result.changed.includes('smartClusters'));
    for (const key of ['articles', 'smartClusters', 'smartRawArticles']) {
        const rows = await db.get(key, { type: 'json', shared: true });
        assert.equal(rows[0].link, 'https://example.com/a'); assert.equal(rows[0].originalLink, wrapper);
        assert.equal(rows[0].articleKey, 'https://example.com/a'); assert.equal(rows[0].domain, 'example.com');
        assert.equal(rows[0].relatedArticles[0].link, 'https://example.net/b'); assert.equal(rows[0].relatedArticles[0].originalLink, memberWrapper);
        assert.deepEqual(rows[0].custom, { retained: true }); assert.ok(Array.isArray(rows));
    }
    assert.equal(initial[0].link, wrapper, 'previous immutable shared snapshot must stay unchanged');
    for (const [key, expected] of Object.entries(otherState)) assert.equal(await db.get(key), expected, key);
    const checkAliases = async () => {
        for (const [key, links] of Object.entries(states)) {
            assert.deepEqual(await db.get(key, { type: 'json' }), links.flatMap(link =>
                [link, link === wrapper ? 'https://example.com/a' : 'https://example.net/b']), key);
        }
    };
    await checkAliases();
    assert.equal((await db.findArticles('articles', { links: ['https://example.com/a'] })).length, 1);
    assert.equal((await db.findArticles('articles', { links: [wrapper] })).length, 0);
    const published = await db.get('topStoriesPublished', { type: 'json' });
    assert.equal(published.articles[0].link, 'https://example.com/a'); assert.equal(published.metadata, 'keep');
    assert.notEqual((await db.get('topStoriesPublished', { fingerprint: true })).digest, before.digest);
    await assert.rejects(before.readAsync(), { code: 'SQLITE_SNAPSHOT_CHANGED' });
    assert.equal((await db.get('universalPrefetchTargets', { type: 'json' }))[0].link, 'https://example.com/a');
    assert.equal((await db.get('storyBriefings', { type: 'json' })).one.articles[0].link, 'https://example.com/a');
    assert.equal((await db.get('topStoriesState', { type: 'json' })).articles[0].link, 'https://example.com/a');
    assert.deepEqual((await db.repairGoogleNewsUrls({ [wrapper]: 'https://example.com/a', [memberWrapper]: 'https://example.net/b' })).changed, []);
    const refreshed = await publishFeedResults(db, [{ ...primary, relatedArticles: [], title: 'Latest headline', pubDate: '2026-11-22' }], []);
    assert.equal(refreshed.length, 1);
    assert.equal(refreshed[0].link, 'https://example.com/a');
    assert.equal(refreshed[0].title, 'Latest headline');
    await checkAliases(); // Only the Smart link projection now keeps the related member's aliases alive.

    // A stale Smart candidate or cluster snapshot may have been computed before repair.
    await db.putMany({ smartRawArticles: JSON.stringify([primary]), smartClusters: JSON.stringify([primary]) });
    for (const key of ['smartRawArticles', 'smartClusters']) {
        const [stored] = await db.get(key, { type: 'json' });
        assert.equal(stored.link, 'https://example.com/a');
        assert.equal(stored.relatedArticles[0].link, 'https://example.net/b');
    }
    const inspect = openSqlite(path.join(root, 'database_state', 'reader.sqlite'), { readOnly: true });
    try {
        assert.equal(inspect.prepare("select link from cluster_members where collection='smartClusters'").get().link, 'https://example.net/b');
        assert.equal(inspect.prepare("select shape from collections where name='smartClusters'").get().shape, 'array');
        assert.equal(inspect.prepare('pragma integrity_check').get().integrity_check, 'ok');
    } finally { inspect.close(); }
    assert.equal(await fs.readFile(path.join(root, 'database.json'), 'utf8'), JSON.stringify(snapshot));
});

test('resolver schedules stored-record repairs after a cached resolution without network', async t => {
    const repaired = []; let done;
    const finished = new Promise(resolve => { done = resolve; });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const service = createGoogleNewsResolver({ env: { RSS_DATA: {
        get: async () => ({ [wrapper]: { resolvedUrl: 'https://example.com/a', cachedAt: Date.now(), individuallyDecoded: true } }),
        repairGoogleNewsUrls: async values => { repaired.push(values); done(); }
    } }, decoder: { decode() { throw Error('network should not run'); } } });
    assert.equal(await service.resolveGoogleNewsUrl(wrapper, {}, { backgroundResolve: true }), 'https://example.com/a');
    t.mock.timers.tick(3000);
    await finished;
    assert.deepEqual(repaired, [{ [wrapper]: { resolvedUrl: 'https://example.com/a', source: undefined } }]);
});

test('retention expires permanent Google News failures at 30 days', () => {
    const day = 86400000, now = Date.now();
    const oldFailure = ['old', { cachedAt: now - 30 * day, permanentFailure: true }];
    const youngFailure = ['new', { cachedAt: now - 30 * day + 1, permanentFailure: true }];
    assert.deepEqual(retainedCacheEntries('googleNewsUrlCache', [oldFailure, youngFailure], now), [youngFailure]);
});

test('source-less repairs add aliases only after validating stored publisher hints', () => {
    const db = openSqlite(':memory:');
    try {
        const repo = createRepository(db);
        const feedUrl = 'https://news.google.com/rss/search?q=site%3Aexample.com';
        const withoutRecord = 'https://news.google.com/read/unknown';
        repo.write('articles', [{ link: wrapper, feedUrl }, { link: memberWrapper, feedUrl }]);
        repo.write('hiddenStates', [wrapper, memberWrapper, withoutRecord]);
        repo.repairGoogleNewsUrls({
            [wrapper]: { resolvedUrl: 'https://example.net/wrong' },
            [memberWrapper]: { resolvedUrl: 'https://example.com/verified?ref=rss&gclid=1' },
            [withoutRecord]: { resolvedUrl: 'https://example.com/unverified' }
        });
        assert.deepEqual(repo.read('articles').map(article => article.link), [wrapper, 'https://example.com/verified']);
        assert.deepEqual(repo.read('hiddenStates'), [wrapper, memberWrapper, 'https://example.com/verified', withoutRecord]);
    } finally { db.close(); }
});

test('existing SQLite databases index personal aliases and both Smart rewrite lookups', async t => {
    const root = await fs.mkdtemp('/tmp/rss-google-news-index-');
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const filename = path.join(root, 'reader.sqlite');
    const before = openSqlite(filename);
    const publisher = 'https://example.com/story';
    const item = { link: publisher, originalLink: wrapper + '/#fragment', googleNewsDecodeSource: 'offline',
        relatedArticles: [{ link: 'https://example.com/member', originalLink: memberWrapper, googleNewsDecodeSource: 'offline' }] };
    createRepository(before).write('smartClusters', [item, ...Array.from({ length: 100 }, (_, i) => ({ link: 'https://example.com/' + i }))]);
    before.exec('DROP INDEX articles_original_link; DROP INDEX cluster_members_original_link;');
    before.close();

    const db = openSqlite(filename);
    try {
        const lookupPlans = [];
        const repo = createRepository({ prepare(query) {
            const statement = db.prepare(query);
            if (!(query.includes('UNION') && query.includes('$.originalLink'))) return statement;
            return { all(...params) {
                lookupPlans.push(db.prepare('EXPLAIN QUERY PLAN ' + query).all(...params).map(row => row.detail).join('\n'));
                return statement.all(...params);
            } };
        } });
        const found = repo.findArticles('smartClusters', { normalizedLinks: [publisher, wrapper], includeOriginalLink: true, limit: 1 });
        assert.equal(found.length, 1);
        assert.equal(found[0].link, publisher);
        assert.deepEqual(repo.findArticles('smartClusters', { normalizedLinks: [wrapper, publisher], includeOriginalLink: true })
            .map(article => article.link), [publisher]);
        assert.equal((repo.findArticles('smartClusters', { normalizedLinks: [wrapper], includeOriginalLink: true }))[0].link, publisher);
        assert.match(lookupPlans[0], /SEARCH articles USING (?:COVERING )?INDEX articles_normalized_link/);
        assert.match(lookupPlans[0], /SEARCH articles USING (?:COVERING )?INDEX articles_original_link/);
        assert.match(lookupPlans[0], /SEARCH articles USING INTEGER PRIMARY KEY/);
        assert.doesNotMatch(lookupPlans[0], /SCAN articles\b/);
        repo.write('smartClusters', [{ link: wrapper, relatedArticles: [{ link: memberWrapper + '/' }] }],
            { allowLargeReduction: true });
        const plan = lookupPlans.at(-1);
        assert.match(plan, /SEARCH articles USING INDEX articles_original_link/);
        assert.match(plan, /SEARCH cluster_members USING INDEX cluster_members_original_link/);
        assert.doesNotMatch(plan, /SCAN (articles|cluster_members)\b/);
        const rewritten = repo.read('smartClusters')[0];
        assert.equal(rewritten.link, publisher);
        assert.equal(rewritten.relatedArticles[0].link, 'https://example.com/member');
        repo.write('smartRawArticles', [item]);
        repo.write('smartRawArticles', [{ link: wrapper }]);
        assert.equal(repo.read('smartRawArticles')[0].link, publisher);
        assert.doesNotMatch(lookupPlans.at(-1), /SCAN (articles|cluster_members)\b/);
    } finally { db.close(); }
});

test('feed unread and personal views honor wrapper-only state for decoded articles', async () => {
    const feedUrl = 'https://example.com/feed';
    const link = 'https://example.com/a';
    const article = { link, originalLink: wrapper, title: 'Decoded article', feedUrl, feedCategory: 'News', pubDate: new Date().toISOString() };
    const state = {
        feeds: [{ url: feedUrl, category: 'News' }], articles: [article],
        readStates: [wrapper], savedStates: [wrapper], boardStates: [wrapper], hiddenStates: [],
        userPreferences: { boardFolderMappings: { [wrapper]: 'News' } }
    };
    let handler;
    registerDataRoutes({
        app: { get(url, ...args) { if (url === '/api/data') handler = args.at(-1); }, post() {} },
        env: { RSS_DATA: { get: async key => state[key] } },
        prepareArticleForClient: async value => value
    });
    const request = async query => {
        let result;
        await handler({ query }, { setHeader() {}, json(value) { result = value; } });
        return result;
    };
    const feed = await request({ filterType: 'feed', filterValue: feedUrl, hideRead: 'true' });
    assert.equal(feed.unreadCounts.total, 0);
    assert.deepEqual(feed.articles, []);
    for (const filterType of ['recent', 'saved', 'board']) {
        const result = await request({ filterType, ...(filterType === 'board' ? { filterValue: 'News' } : {}) });
        assert.deepEqual(result.articles.map(a => a.link), [link], filterType);
    }
    state.hiddenStates = [wrapper];
    assert.deepEqual((await request({ filterType: 'hidden' })).articles.map(a => a.link), [link]);
});
