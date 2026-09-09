import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createArticleCache } from '../src/articles/cache.js';
import { createArticlePresentation } from '../src/articles/presentation.js';
import { createArticleFetchPolicy } from '../src/articles/fetch-policy.js';
import { registerDataRoutes } from '../src/routes/data-routes.js';
import { fnv1a } from '../src/utils/article-utils.js';
import { articleContentFilterMatches, normalizeBlockedKeywordEntries } from '../src/filters/content-filter.js';

const url = 'https://voz.vn/t/example.123456';
const image = 'https://example.com/photo.jpg';

test('fast keyword checks agree with detailed filtering and stop after a match', () => {
    const keywords = normalizeBlockedKeywordEntries(['điện thoại', '0', '&']);
    for (const article of [{ title: '<b>ĐIỆN THOẠI</b>' }, { content: 0 }, { summary: '&amp;' }, { title: 'Other news' }, {}]) {
        assert.equal(articleContentFilterMatches(article, keywords), articleContentFilterMatches(article, keywords, true).length > 0);
    }
    assert.equal(articleContentFilterMatches({ title: 'Điện thoại', get content() { throw new Error('Should stop at title'); } }, keywords), true);
});

test('card image lookup preserves cache validity without preparing post markup', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rss-card-image-'));
    const previous = process.cwd();
    try {
        process.chdir(directory);
        await fs.mkdir('article_cache');
        const cache = createArticleCache();
        const write = result => fs.writeFile(`article_cache/${fnv1a(url)}.json`, JSON.stringify({ cachedAt: Date.now(), result }));
        await write({ image, content: '<div class="voz-post">Reply</div>' });
        assert.equal(await cache.getLastKnownCachedArticleImage(url), image);
        assert.equal((await cache.getLastKnownCachedArticle(url)).image, image);
        const readFile = fs.readFile;
        let reads = 0;
        fs.readFile = async (...args) => { reads++; return readFile(...args); };
        try {
            assert.equal(await cache.getLastKnownCachedArticleImage(url), image);
            assert.equal(reads, 0, 'unchanged card images should not read thread bodies again');
        } finally { fs.readFile = readFile; }
        await write({ image, content: '' });
        assert.equal(await cache.getLastKnownCachedArticleImage(url), null);
        await fs.writeFile(`article_cache/${fnv1a(url)}.json`, 'broken JSON');
        assert.equal(await cache.getLastKnownCachedArticleImage(url), null);
    } finally {
        process.chdir(previous);
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('tab requests hold foreground priority until their async work finishes and release it on failure', async () => {
    const progress = { activeForegroundRequests: 2 };
    let handler, finish;
    registerDataRoutes({
        app: { get: (...args) => { handler = args.at(-1); } }, progress,
        serveSmartData: () => new Promise((resolve, reject) => { finish = reject; })
    });
    const request = handler({ query: { filterType: 'smart' } }, {});
    assert.equal(progress.activeForegroundRequests, 3);
    finish(new Error('test failure'));
    await assert.rejects(request, /test failure/);
    assert.equal(progress.activeForegroundRequests, 2);
});

test('Forum cards use the image-only lookup and skip it when an image already exists', async () => {
    let reads = 0;
    const presentation = createArticlePresentation({
        getLastKnownCachedArticle: async () => { throw new Error('Full body must not be loaded for a card'); },
        getLastKnownCachedArticleImage: async requested => { assert.equal(requested, url); reads++; return image; }
    });
    assert.equal((await presentation.prepareArticleForClient({ link: url, title: 'Thread' })).image, image);
    assert.equal((await presentation.prepareArticleForClient({ link: url, title: 'Thread', image })).image, image);
    assert.equal(reads, 1);
});

test('explicit feed policy does not wait for Smart settings and changes apply immediately', async () => {
    const feed = { url: 'https://voz.vn/f/apple.36/index.rss', fetchMethods: ['cloudflare'] };
    let smartReads = 0;
    const policy = createArticleFetchPolicy({
        env: { RSS_DATA: { get: async key => { assert.equal(key, 'feeds'); return [feed]; } } },
        smartNews: { getSourceSettings: async () => { smartReads++; return []; } }
    });
    assert.deepEqual((await policy.getArticleFetchPolicy(url + '/page-219', feed.url)).strategyOrder, ['cloudflare']);
    feed.fetchMethods = ['direct'];
    assert.deepEqual((await policy.getArticleFetchPolicy(url + '/page-220', feed.url)).strategyOrder, ['direct']);
    assert.equal(smartReads, 0);
});

test('tab filtering reuses immutable articles but updates for keywords, snapshots and read state', async () => {
    let titleReads = 0;
    const article = { link: url, feedCategory: 'Forum', get title() { titleReads++; return 'Example thread'; } };
    const state = { articles: [article], blockedArticleKeywords: ['blocked'], readStates: [] };
    let handler;
    registerDataRoutes({
        app: { get: (...args) => { handler = args.at(-1); } },
        env: { RSS_DATA: { get: async key => state[key] } },
        prepareArticleForClient: async article => ({ link: article.link })
    });
    const request = async query => {
        let result;
        await handler({ query: { filterType: 'category', filterValue: 'Forum', ...query } }, { json: data => { result = data; } });
        return result;
    };
    assert.equal((await request()).articles.length, 1);
    const firstReads = titleReads;
    assert.equal((await request()).articles.length, 1);
    assert.equal(titleReads, firstReads);
    state.readStates = [url];
    assert.equal((await request({ hideRead: 'true' })).articles.length, 0);
    state.blockedArticleKeywords = ['example'];
    assert.equal((await request()).articles.length, 0);
    state.articles = [{ link: url, title: 'Replacement', feedCategory: 'Forum' }];
    assert.equal((await request()).articles.length, 1);
});
