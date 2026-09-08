import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import cron from 'node-cron';
import { createDatabaseStore } from '../src/database/store.js';
import { createArticleCache } from '../src/articles/cache.js';
import { createBackgroundStartup } from '../src/jobs/startup.js';
import { summaryQueue } from '../summary-engine.js';

test('database persistence, recovery, and article archives survive service extraction', async () => {
    const previousDirectory = process.cwd();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rss-services-'));
    process.chdir(directory);
    try {
        await fs.writeFile('database.json', JSON.stringify({ articles: '[]', feeds: '[]' }));
        const database = createDatabaseStore();
        const db = database.env.RSS_DATA;
        const feed = { url: 'https://example.org/feed.xml', title: 'Fixture' };
        await db.put('feeds', JSON.stringify([feed]));
        await Promise.all([
            db.put('readStates', JSON.stringify(['https://example.org/a'])),
            db.put('savedStates', JSON.stringify(['https://example.org/saved'])),
            db.put('smartClusters', JSON.stringify([{ link: 'https://example.org/smart', title: 'Smart fixture' }]))
        ]);
        const disk = JSON.parse(await fs.readFile('database.json', 'utf8'));
        assert.equal(disk.readStates, '["https://example.org/a"]');
        assert.equal(disk.savedStates, '["https://example.org/saved"]');
        assert.equal(disk.smartClusters, undefined);
        assert.equal(JSON.parse(await fs.readFile('smart-data.json', 'utf8')).smartClusters.includes('Smart fixture'), true);
        assert.deepEqual(JSON.parse(await fs.readFile('feeds_backup.json', 'utf8')), [feed]);
        const independentRead = await db.get('feeds', { type: 'json' });
        independentRead[0].title = 'Changed locally';
        assert.equal((await db.get('feeds', { type: 'json' }))[0].title, 'Fixture');
        await assert.rejects(db.put('feeds', '[]'), /Refusing to wipe/);
        assert.deepEqual(await db.get('feeds', { type: 'json' }), [feed]);
        await assert.rejects(database._writeJsonAtomic('invalid.json', '{broken'), SyntaxError);
        await assert.rejects(fs.stat('invalid.json'), { code: 'ENOENT' });

        const cache = createArticleCache({ env: database.env, _writeJsonAtomic: database._writeJsonAtomic });
        const url = 'https://example.org/article';
        const article = { title: 'A real article', content: '<p>Substantial archived article content.</p>', fetchStrategy: 'direct' };
        assert.equal(await cache.cacheArticleResult(url, article), true);
        assert.deepEqual(await cache.getCachedArticle(url), article);
        await cache._initArticleCacheIndex();
        const [filename, metadata] = [...cache._articleCacheIndex][0];
        assert.equal(metadata.url, url);
        const filenamePath = path.join('article_cache', filename);
        const entry = JSON.parse(await fs.readFile(filenamePath, 'utf8'));
        assert.equal(entry.version, 55);
        entry.cachedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
        await fs.writeFile(filenamePath, JSON.stringify(entry));
        assert.equal(await cache.getCachedArticle(url), null);
        assert.deepEqual(await cache.getLastKnownCachedArticle(url), article);
        await db.put('boardStates', JSON.stringify([url]));
        assert.deepEqual(await cache.getCachedArticle(url), article);
        assert.equal(await cache.cacheArticleResult(url, { title: 'Just a moment', content: '<p>Enable javascript and cookies to continue</p>' }), false);
        assert.deepEqual(await cache.getLastKnownCachedArticle(url), article);
        const archived = { ...article, sourceDeleted: true, sourceDeletedHasCache: true };
        assert.equal(await cache.cacheArticleResult(url, archived), true);
        assert.equal(await cache.cacheArticleResult(url, article), false);
        assert.equal((await cache.getCachedArticle(url)).sourceDeleted, true);

        // A fresh owner must recover the same public data format after a damaged main file.
        await fs.writeFile('database.json.backup', JSON.stringify(disk));
        await fs.writeFile('database.json', '{broken');
        const recovered = createDatabaseStore();
        assert.deepEqual(await recovered.env.RSS_DATA.get('feeds', { type: 'json' }), [feed]);
        assert.equal((await recovered.env.RSS_DATA.get('smartClusters', { type: 'json' }))[0].title, 'Smart fixture');
        assert.equal(JSON.parse(await fs.readFile('database.json', 'utf8')).feeds, disk.feeds);
    } finally {
        process.chdir(previousDirectory);
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('startup retains the immediate RSS phase, exact stagger delays, intervals, and VOZ cron', async t => {
    const timeouts = [], intervals = [], cronJobs = [], calls = [];
    const timer = () => ({ unref() {} });
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => { timeouts.push({ callback, delay }); return timer(); });
    t.mock.method(globalThis, 'setInterval', (callback, delay) => { intervals.push({ callback, delay }); return timer(); });
    t.mock.method(cron, 'schedule', (expression, callback) => { cronJobs.push({ expression, callback }); return {}; });
    t.mock.method(summaryQueue, 'start', () => calls.push('summary'));
    const startup = createBackgroundStartup({
        reconcileAllConfiguredSourceFetchMethods: async () => calls.push('policy'),
        cleanupArticleCache: () => calls.push('cache'),
        env: { RSS_DATA: { get: async () => ({ clusteringModel: 'gemini-3.5-flash-lite' }) } },
        normalizeClusteringModel: value => value,
        startSequentialSyncLoop: () => calls.push('rss'),
        gcAndLogMemory: () => {},
        smartNews: { start: () => calls.push('smart'), getSources: async () => [] },
        waitForHttpIdle: async () => {},
        prefetchOpenCliOnlyArticles: async () => {},
        resolveSmartArticleDestinations: async () => {},
        BROWSER_HEADERS: {},
        runUniversalTabPrefetch: () => calls.push('prefetch'),
        deletedVozThreads: new Set(),
        getCachedArticle: async () => null,
        enqueueVozCacheBoardCrawl: () => {},
        triggerVozCurrentPageBackgroundUpdate: () => {},
        VOZ_CACHE_BOARD_REFRESH_INTERVAL_MS: 55 * 1000,
        http: { lastHttpActivityAt: 0 }
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(timeouts.map(timer => timer.delay), [0]);
    startup.startBackgroundServices();
    assert.deepEqual(calls, ['cache', 'rss']);
    assert.deepEqual(timeouts.map(timer => timer.delay), [0, 30000, 45000, 60000, 90000]);
    assert.deepEqual(intervals.map(timer => timer.delay), [3600000, 1800000]);
    assert.deepEqual(cronJobs.map(job => job.expression), ['* * * * *']);
    timeouts.find(timer => timer.delay === 30000).callback();
    timeouts.find(timer => timer.delay === 60000).callback();
    timeouts.find(timer => timer.delay === 90000).callback();
    assert.deepEqual(calls, ['cache', 'rss', 'smart', 'prefetch', 'summary']);
    await Promise.resolve();
});

test('lightweight Board state is durable and cannot replay over a newer full snapshot', async () => {
    const previousDirectory = process.cwd();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rss-state-'));
    process.chdir(directory);
    try {
        const initial = JSON.stringify({ articles: '[]', feeds: '[]' });
        await fs.writeFile('database.json', initial);
        const db = createDatabaseStore().env.RSS_DATA;
        await db.putMany({ boardStates: '["https://example.org/a"]', userPreferences: '{"theme":"light"}' }, { lightweight: true });
        assert.equal(await fs.readFile('database.json', 'utf8'), initial, 'small save must not rewrite the main database');
        const staleOverlay = await fs.readFile('database-state.json', 'utf8');
        const restarted = createDatabaseStore().env.RSS_DATA;
        assert.deepEqual(await restarted.get('boardStates', { type: 'json' }), ['https://example.org/a']);
        assert.equal((await restarted.get('userPreferences', { type: 'json' })).theme, 'light');
        await restarted.put('userPreferences', '{"theme":"dark"}');
        await fs.writeFile('database-state.json', staleOverlay); // Crash after snapshot rename, before overlay cleanup.
        const recovered = createDatabaseStore().env.RSS_DATA;
        assert.equal((await recovered.get('userPreferences', { type: 'json' })).theme, 'dark');
        await recovered.putMany({ boardStates: '[]' }, { lightweight: true });
        const again = createDatabaseStore().env.RSS_DATA;
        assert.deepEqual(await again.get('boardStates', { type: 'json' }), []);
        assert.equal((await again.get('userPreferences', { type: 'json' })).theme, 'dark');
        // A failed atomic write must leave the last acknowledged state intact.
        await fs.unlink('database-state.json'); await fs.mkdir('database-state.json');
        await assert.rejects(again.putMany({ boardStates: '["bad"]' }, { lightweight: true }));
        assert.deepEqual(await again.get('boardStates', { type: 'json' }), []);
    } finally { process.chdir(previousDirectory); await fs.rm(directory, { recursive: true, force: true }); }
});
