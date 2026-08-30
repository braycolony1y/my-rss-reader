import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    alignVozPaginationToRequestedPage,
    getVozPaginationMaxPage,
    getVozThreadPageNumber,
    hasVozDeletedThreadMarker,
    isDeletedVozThreadPayload,
    isUnsafeVozThreadPayload,
    isVozThreadUrl
} from '../src/voz-thread-state.js';

const deletedUrl = 'https://voz.vn/t/example-thread.1268127/unread';

test('recognizes VOZ thread URLs and its authoritative deletion marker', () => {
    assert.equal(isVozThreadUrl(deletedUrl), true);
    assert.equal(isVozThreadUrl('https://voz.vn/f/diem-bao.33/'), false);
    assert.equal(isVozThreadUrl('https://example.com/t/example-thread.1268127'), false);
    assert.equal(hasVozDeletedThreadMarker('The requested thread could not be found.'), true);
    assert.equal(hasVozDeletedThreadMarker('Chủ đề yêu cầu không tìm thấy'), true);
});

test('recognizes every numbered VOZ page without coupling to one thread or page two', () => {
    assert.equal(getVozThreadPageNumber('https://voz.vn/t/first.111/page-1'), 1);
    assert.equal(getVozThreadPageNumber('https://voz.vn/t/second.222/page-37/'), 37);
    assert.equal(getVozThreadPageNumber('https://sub.voz.vn/t/third.333/page-904?x=1'), 904);
    assert.equal(getVozThreadPageNumber('https://voz.vn/t/first.111/unread'), null);
    assert.equal(getVozThreadPageNumber('https://example.com/t/first.111/page-2'), null);
});

test('discovers the final VOZ page from sparse pagination metadata', () => {
    assert.equal(getVozPaginationMaxPage({
        currentPage: 5,
        pages: [{ page: 1 }, { page: 4 }, { page: 5 }, { page: 6 }, { page: 904 }]
    }), 904);
    assert.equal(getVozPaginationMaxPage(null, 37), 37);
});

test('aligns deleted-thread pagination to any requested archived page', () => {
    const baseUrl = 'https://voz.vn/t/example.777';
    const sourcePagination = {
        currentPage: 1,
        pages: [1, 2, 3, 4].map(page => ({
            page,
            url: page === 1 ? baseUrl : `${baseUrl}/page-${page}`,
            isCurrent: page === 1
        })),
        prevUrl: null,
        nextUrl: `${baseUrl}/page-2`
    };
    const aligned = alignVozPaginationToRequestedPage(sourcePagination, `${baseUrl}/page-3`, baseUrl);

    assert.equal(aligned.currentPage, 3);
    assert.deepEqual(aligned.pages.filter(page => page.isCurrent).map(page => page.page), [3]);
    assert.equal(aligned.prevUrl, `${baseUrl}/page-2`);
    assert.equal(aligned.nextUrl, `${baseUrl}/page-4`);
});

test('does not invent links beyond the pages present in the archived-page inventory', () => {
    const baseUrl = 'https://voz.vn/t/archived-thread.999';
    const archivedPagination = {
        pages: [1, 2].map(page => ({
            page,
            url: page === 1 ? baseUrl : `${baseUrl}/page-${page}`,
            isCurrent: false
        }))
    };
    const aligned = alignVozPaginationToRequestedPage(
        archivedPagination,
        `${baseUrl}/page-2`,
        baseUrl
    );

    assert.deepEqual(aligned.pages.map(page => page.page), [1, 2]);
    assert.deepEqual(aligned.pages.filter(page => page.isCurrent).map(page => page.page), [2]);
    assert.equal(aligned.prevUrl, baseUrl);
    assert.equal(aligned.nextUrl, null);
});

test('an uncached high VOZ page is represented as itself instead of page one', () => {
    const baseUrl = 'https://voz.vn/t/another-thread.888';
    const aligned = alignVozPaginationToRequestedPage(null, `${baseUrl}/page-128`, baseUrl);

    assert.equal(aligned.currentPage, 128);
    assert.deepEqual(aligned.pages, [{
        page: 128,
        url: `${baseUrl}/page-128`,
        isCurrent: true
    }]);
    assert.equal(aligned.prevUrl, null);
    assert.equal(aligned.nextUrl, null);
});

test('distinguishes confirmed deletion from a retryable generic VOZ error', () => {
    const jinaText = `Title: Oops! We ran into some problems. | VOZ

Markdown Content:
The requested thread could not be found.
Forums Terms and rules Privacy policy`;
    assert.equal(isDeletedVozThreadPayload(deletedUrl, jinaText), true);
    const genericError = {
        title: 'Oops! We ran into some problems.',
        content: '<p>Forums</p><p>Terms and rules</p>'
    };
    assert.equal(isDeletedVozThreadPayload(deletedUrl, genericError), false);
    assert.equal(isUnsafeVozThreadPayload(deletedUrl, genericError), true);
    assert.equal(isDeletedVozThreadPayload(deletedUrl, {
        title: 'Deleted Thread',
        content: '',
        isDeletedThread: true
    }), true);
    assert.equal(isDeletedVozThreadPayload(deletedUrl, {
        title: 'A valid VOZ thread',
        content: '<div class="voz-post">Real post body</div>'
    }), false);
});

test('deletion/error markers do not affect non-VOZ articles', () => {
    assert.equal(isDeletedVozThreadPayload('https://example.com/story', {
        title: 'Oops! We ran into some problems.',
        content: 'The requested thread could not be found.'
    }), false);
    assert.equal(isUnsafeVozThreadPayload('https://example.com/story', {
        title: 'Oops! We ran into some problems.',
        content: 'The requested thread could not be found.'
    }), false);
});

test('server keeps the old cache until a validated replacement and short-circuits deletion before fallback', () => {
    const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
    const cacheWriter = server.slice(
        server.indexOf('async function cacheArticleResult'),
        server.indexOf('async function deleteCachedArticle')
    );
    assert.ok(cacheWriter.indexOf('isUnsafeVozThreadPayload') < cacheWriter.indexOf('_writeJsonAtomic'));
    assert.ok(cacheWriter.indexOf('existing?.sourceDeleted === true') < cacheWriter.indexOf('_writeJsonAtomic'));

    const parser = server.slice(
        server.indexOf('async function parseArticleHtmlContent'),
        server.indexOf('\nexport {', server.indexOf('async function parseArticleHtmlContent'))
    );
    assert.ok(parser.indexOf('isDeletedArticlePayload(url, html)') < parser.indexOf('discoverArticleAudioUrls'));
    assert.doesNotMatch(server, /if\s*\(bypassCache\)[\s\S]{0,160}deleteCachedArticle\(requestedUrl\)/);
    assert.doesNotMatch(server, /user_settings\.json/);
    assert.match(server, /if \(isExpired \|\| cached\.version !== ARTICLE_CACHE_VERSION\)/);
});

test('VOZ background polling carries feed policy instead of silently enabling Jina', () => {
    const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
    assert.match(script, /checkVozNewPostsInBackground\(url, this\.overlayArticle\.feedUrl \|\| ''\)/);
    assert.match(script, /new URLSearchParams\(\{ url, feedUrl, bypassCache: 'true' \}\)/);
    assert.match(script, /this\.overlayArticle\.sourceDeleted = data\.sourceDeleted === true/);
    assert.match(script, /this\.overlayFetchedFromCache && !this\.overlayArticle\.sourceDeleted/);
});

test('Cache Board refreshes VOZ every minute and crawls past cached pages to the final page', () => {
    const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
    const crawlerStart = server.indexOf('async function runVozCacheBoardCrawlBatch');
    const crawlerEnd = server.indexOf('\nfunction triggerVozNextPagePrefetch', crawlerStart);
    const crawler = server.slice(crawlerStart, crawlerEnd);
    const cronStart = server.indexOf("cron.schedule('* * * * *'");
    const cronEnd = server.indexOf('\n        console.log(`[STAGGERED BOOT]', cronStart);
    const cacheBoardCron = server.slice(cronStart, cronEnd);

    assert.match(server, /const VOZ_CACHE_BOARD_REFRESH_INTERVAL_MS = 55 \* 1000/);
    assert.match(server, /const vozCacheBoardLastCheck = new Map\(\)/);
    assert.match(server, /options\.cacheAllPages \? vozCacheBoardLastCheck : vozBackgroundLastCheck/);
    assert.match(cacheBoardCron, /minimumIntervalMs: VOZ_CACHE_BOARD_REFRESH_INTERVAL_MS/);
    assert.match(cacheBoardCron, /cacheAllPages: true/);
    assert.match(cacheBoardCron, /enqueueVozCacheBoardCrawl\(baseUrl, cached\.pagination/);
    assert.match(crawler, /while \(job\.nextPage <= job\.maxPage/);
    assert.match(crawler, /if \(hasUsableCachedVozPage\(cached, requestedPage\)\) \{[\s\S]*continue;/);
    assert.doesNotMatch(crawler, /if \(hasUsableCachedVozPage\(cached, requestedPage\)\) \{[\s\S]{0,300}return;/);
    assert.match(crawler, /getVozPaginationMaxPage\(result\.pagination, actualPage\)/);
    assert.match(server, /const VOZ_CACHE_BOARD_CRAWL_CONCURRENCY = 2/);
});
