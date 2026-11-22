import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createArticleCache } from '../src/articles/cache.js';
import { createArticlePipeline } from '../src/articles/pipeline.js';
import { registerArticleRoutes } from '../src/routes/article-routes.js';
import { assertArticleResultAcceptedBySource } from '../src/articles/source-results.js';
import { isMismatchedVozThreadPage } from '../src/voz-thread-state.js';
import VozSource from '../src/sources/VozSource.js';
import { fnv1a } from '../src/utils/article-utils.js';
import { extractBalancedElementByClass } from '../src/articles/markup.js';

const base = 'https://voz.vn/t/example.123456';
const post = id => `<div class="voz-post" data-absolute-post-id="${id}">${'A reply with readable content. '.repeat(30)}</div>`;
const payload = (page, count = 1) => ({
    url: `${base}/page-3`, title: 'Thread',
    content: Array.from({ length: count }, (_, i) => post(page * 100 + i)).join(''),
    pagination: { currentPage: page, pages: [{ page, isCurrent: true }], nextUrl: null }
});

test('VOZ permanent post IDs never become thread positions and old cached positions are repaired', () => {
    const source = new VozSource();
    const result = {};
    const html = `<link rel="canonical" href="${base}/page-7177"><article class="message--post" data-content="post-43879958"><div class="bbWrapper">A reply</div></article>`;
    const content = source.parseArticleHtmlContent(html, `${base}/page-7177`, result, { extractBalancedElementByClass, escapeHtml: value => String(value) });
    assert.match(content, /data-post-index="143521"/);
    assert.match(content, /data-absolute-post-id="43879958"/);
    const cached = `<div class="voz-post" id="voz-post-43879958" data-post-index="43879958" data-absolute-post-id="43879958"><a class="voz-post-index" href="https://voz.vn/p/43879958">#43879958</a><div class="voz-post-body">Saved reply</div></div>`;
    const cleaned = source.cleanCachedArticleContent(cached, { pagination: { currentPage: 7177 } });
    assert.match(cleaned, /id="voz-post-143521"/);
    assert.match(cleaned, /data-post-index="143521"/);
    assert.match(cleaned, /data-absolute-post-id="43879958"/);
    assert.match(cleaned, />#143521<\/a>/);
    assert.match(cleaned, /Saved reply/);
    assert.equal(source.cleanCachedArticleContent(cleaned, { pagination: { currentPage: 7177 } }), cleaned);
});

test('requested VOZ pages are validated for path, query and page-one URLs but allow post redirects', () => {
    for (const url of [`${base}/page-3`, `${base}/page-3/#post-1`, `${base}/?page=3`]) {
        assert.equal(isMismatchedVozThreadPage(url, payload(2)), true);
        assert.throws(() => assertArticleResultAcceptedBySource(url, payload(2)), /returned page 2/);
        assert.equal(isMismatchedVozThreadPage(url, payload(3)), false);
    }
    assert.equal(isMismatchedVozThreadPage(base, payload(2)), true);
    for (const suffix of ['/unread', '/latest', '/post-1234']) {
        assert.equal(isMismatchedVozThreadPage(base + suffix, payload(2)), false);
    }
    assert.equal(isMismatchedVozThreadPage(`${base}/page-3`, { content: post(1) }), false);
    assert.equal(isMismatchedVozThreadPage('https://example.org/page-3', payload(2)), false);
});

test('VOZ parser uses source evidence instead of inventing a page from the request', () => {
    const source = new VozSource();
    const queryResult = {};
    source.parseArticleHtmlContent(`<link rel="canonical" href="${base}/?page=3">`, `${base}/?page=3`, queryResult, { extractBalancedElementByClass });
    assert.equal(queryResult.pagination.currentPage, 3);
    const redirectedResult = {};
    source.parseArticleHtmlContent('<li class="pageNav-page pageNav-page--current"><a href="/t/example.123456/page-2">2</a></li>', `${base}/page-3`, redirectedResult, { extractBalancedElementByClass });
    assert.equal(redirectedResult.pagination.currentPage, 2);
    assert.equal(isMismatchedVozThreadPage(`${base}/page-3`, redirectedResult), true);
    for (const suffix of ['/page-2', '/?page=2']) {
        const singlePage = {};
        source.parseArticleHtmlContent(`<link rel="canonical" href="${base}/"><h1>One-page thread</h1>`, base + suffix, singlePage, { extractBalancedElementByClass });
        assert.equal(singlePage.pagination.currentPage, 1);
        assert.equal(singlePage.pagination.pages.length, 1);
        assert.equal(singlePage.pagination.nextUrl, null);
        assert.equal(isMismatchedVozThreadPage(base + suffix, singlePage), true);
    }
    const spacedNavigation = {};
    source.parseArticleHtmlContent('<li class="pageNav-page pageNav-page--current">\n  <a href="/t/example.123456/page-3">\n3</a></li>', `${base}/page-3`, spacedNavigation, { extractBalancedElementByClass });
    assert.equal(spacedNavigation.pagination.currentPage, 3);
});

test('wrong-page cache is ignored including fallback reads and can be replaced by a shorter correct final page', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rss-page-validation-'));
    const previous = process.cwd();
    process.chdir(directory);
    t.after(async () => { process.chdir(previous); await fs.rm(directory, { recursive: true, force: true }); });
    const cache = createArticleCache({ _writeJsonAtomic: (filename, value) => fs.writeFile(filename, JSON.stringify(value)) });
    const url = `${base}/page-3`;
    await fs.mkdir('article_cache');
    const filename = `article_cache/${fnv1a(url)}.json`;
    await fs.writeFile(filename, JSON.stringify({ version: 60, cachedAt: Date.now(), url, result: payload(2, 20) }));
    assert.equal(await cache.getCachedArticle(url), null);
    assert.equal(await cache.getLastKnownCachedArticle(url), null);
    assert.equal(await cache.cacheArticleResult(url, payload(2, 20)), false);
    await cache.cacheArticleResult(url, payload(3, 2));
    assert.equal((await cache.getCachedArticle(url)).pagination.currentPage, 3);
    assert.match((await cache.getLastKnownCachedArticle(url)).content, /data-absolute-post-id="300"/);
    assert.equal(await cache.cacheArticleResult(url, payload(3, 1)), false, 'same-page truncation remains protected');
});

test('background HTML fetches reject another page before it can enter the archive', async () => {
    const pipeline = createArticlePipeline({
        fetchArticleHtmlByStrategy: async () => `<html><body>${post(1)}</body></html>`,
        parseArticleHtmlContent: async () => payload(2)
    });
    await assert.rejects(pipeline.fetchParsedArticleByStrategy('direct', `${base}/page-3`, { availableStrategies: ['direct'] }), /returned page 2/);
});

test('interactive pagination retries the next configured HTML method after a wrong-page response', async () => {
    let handler, response;
    const attempted = [], saved = [];
    const methods = ['cloudflare', 'opencli-fetch'];
    registerArticleRoutes({
        app: { get(route, ...handlers) { if (route === '/api/article-content') handler = handlers.at(-1); }, post() {} },
        progress: { activeForegroundRequests: 0 }, articleReaderSessions: new Map(), googleNews: {},
        updateArticleFetchProgress() {}, finishArticleFetchProgress() {},
        isProtectedDeletedSourceSnapshot: async () => false,
        getCachedArticle: async () => null,
        getArticleFetchPolicy: async () => ({ availableStrategies: methods, allAvailableStrategies: methods, strategyOrder: methods, configuredMethods: methods, hasStrictConfiguredMethods: true }),
        getArticleFetchPreferences: async () => ({}),
        fetchArticleHtmlByStrategy: async method => { attempted.push(method); return `<html><body>${post(1)}</body></html>`; },
        parseArticleHtmlContent: async (_html, _url, method) => ({ ...payload(method === 'cloudflare' ? 2 : 3), fetchStrategy: method }),
        expandArticleResultForSource: async (_url, result) => result,
        recordArticleFetchOutcome: async () => {},
        cacheArticleResult: async (_url, result) => saved.push(result)
    });
    await handler({ query: { url: `${base}/page-3`, threadPage: '1' } }, { json(value) { response = value; } });
    assert.equal(response.error, undefined);
    assert.deepEqual(attempted, methods);
    assert.equal(response.pagination.currentPage, 3);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].pagination.currentPage, 3);
});
