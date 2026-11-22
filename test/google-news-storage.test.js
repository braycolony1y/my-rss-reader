import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSqliteDatabaseStore } from '../src/database/sqlite/store.js';
import { openSqlite } from '../src/database/sqlite/connection.js';
import { createGoogleNewsResolver } from '../src/articles/google-news.js';

const wrapper = 'https://news.google.com/read/' + Buffer.from('AU_yqL-storage').toString('base64url');
const memberWrapper = 'https://news.google.com/articles/' + Buffer.from('AU_yqL-member').toString('base64url');

test('background repair updates current SQLite rows, members, indexes, revisions and snapshots; personal state remains exact', async t => {
    const root = await fs.mkdtemp('/tmp/rss-google-news-storage-');
    const primary = { link: wrapper, articleKey: wrapper, title: 'Primary', id: 'stable-id', domain: 'news.google.com',
        custom: { retained: true }, relatedArticles: [{ link: memberWrapper, title: 'Related', feedUrl: 'https://news.google.com/rss/search?q=site%3Aexample.net' }] };
    const state = { readStates: JSON.stringify([wrapper]), savedStates: JSON.stringify([wrapper]), hiddenStates: JSON.stringify([wrapper]),
        boardStates: JSON.stringify([wrapper]), cacheMembers: JSON.stringify({ [wrapper]: { in_cache: true, url: wrapper } }),
        cacheIdentityLedger: JSON.stringify({ articles: { [wrapper]: { keep: 'exact' } } }), userPreferences: '{"theme":"glass"}' };
    const snapshot = { feeds: '[]', articles: JSON.stringify([primary]), smartClusters: JSON.stringify([primary]), smartRawArticles: JSON.stringify([primary]),
        topStoriesPublished: JSON.stringify({ articles: [primary], metadata: 'keep' }), universalPrefetchTargets: JSON.stringify([primary]),
        storyBriefings: JSON.stringify({ one: { articles: [primary] } }), topStoriesState: JSON.stringify({ articles: [primary] }), ...state };
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
    for (const [key, expected] of Object.entries(state)) assert.equal(await db.get(key), expected, key);
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
    const service = createGoogleNewsResolver({ env: { RSS_DATA: {
        get: async () => ({ [wrapper]: { resolvedUrl: 'https://example.com/a', cachedAt: Date.now(), individuallyDecoded: true } }),
        repairGoogleNewsUrls: async values => { repaired.push(values); done(); }
    } }, decoder: { decode() { throw Error('network should not run'); } } });
    assert.equal(await service.resolveGoogleNewsUrl(wrapper, {}, { backgroundResolve: true }), 'https://example.com/a');
    const keepAlive = setTimeout(() => {}, 4000);
    try { await finished; } finally { clearTimeout(keepAlive); }
    assert.deepEqual(repaired, [{ [wrapper]: 'https://example.com/a' }]);
});
