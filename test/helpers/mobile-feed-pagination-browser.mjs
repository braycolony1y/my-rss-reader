// Controlled reply-bump replay through the real mobile shell and Alpine buttons.
// Only /api/data is replaced; all writes and article prefetches are blocked.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { selectFeedPage, feedPageKey } from '../../src/feeds/page-selection.js';
const base = 'http://127.0.0.1:3000';
const thread = id => ({ link: `https://voz.vn/t/paging-fixture.${id}`, title: `Pagination fixture ${id}`,
    feedCategory: 'Forum', feedUrl: 'fixture-voz', feedTitle: 'VOZ', content: '', pubDate: new Date().toISOString() });
let articles = Array.from({ length: 45 }, (_, i) => thread(i + 1));
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium',
    headless: true, args: ['--no-sandbox'] });
try {
    const context = await browser.createBrowserContext();
    await context.setCookie({ name: 'auth', value: 'true', url: base });
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 390, height: 844 });
    await page.setRequestInterception(true);
    page.on('request', async request => {
        const url = new URL(request.url());
        if (url.pathname === '/api/data') {
            const query = Object.fromEntries(url.searchParams);
            const body = request.postData() ? JSON.parse(request.postData()) : {};
            requests.push({ method: request.method(), page: query.page, seen: body.seenArticleKeys?.length || 0 });
            const selection = selectFeedPage({ articles, query, body, page: Number(query.page), limit: Number(query.limit),
                readSet: new Set(), hiddenSet: new Set() });
            return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({
                articles: selection.articles.map(article => ({ ...article, feedPageKey: feedPageKey(article) })),
                hasMore: selection.hasMore, feedPageMode: selection.live ? 'unseen' : undefined,
                feeds: [{ title: 'VOZ', url: 'fixture-voz', category: 'Forum' }], userPreferences: { theme: 'classic' }
            }) });
        }
        if (request.method() !== 'GET' || ['/api/article-content', '/api/og-image', '/api/events'].includes(url.pathname)) return request.abort();
        return request.continue();
    });
    await page.goto(base + '/#category/Forum', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.Alpine && Alpine.$data(document.body).articles.length === 15
        && !Alpine.$data(document.body).isLoadingArticles, { timeout: 60000 });
    const read = () => page.evaluate(() => { const app = Alpine.$data(document.body); return {
        page: app.currentPage, keys: app.articles.map(a => a.feedPageKey), mobile: app.isMobile,
        titles: [...document.querySelectorAll('.article-card')].map(n => n.textContent)
    }; });
    const click = async direction => {
        const selector = `[x-show="displayedArticles.length > 0 && isMobile"] button[\\@click="goToPage(currentPage ${direction === 'next' ? '+' : '-'} 1)"]`;
        const button = await page.$(selector);
        assert.ok(button, 'real mobile paging button exists');
        await button.evaluate(node => node.scrollIntoView({ block: 'center' }));
        await button.click();
        await page.waitForFunction(() => { const app = Alpine.$data(document.body); return !app.isLoadingMore && !app.isLoadingArticles; });
    };
    const first = await read(); assert.equal(first.mobile, true);
    articles = [thread(99), thread(40), thread(3), ...articles.filter(a => ![thread(40).link, thread(3).link].includes(a.link))];
    await page.evaluate(async () => Alpine.$data(document.body).fetchData(false, false, true));
    assert.deepEqual((await read()).keys, first.keys);
    await click('next');
    const second = await read(); assert.equal(second.page, 2);
    assert.deepEqual(second.keys.slice(0, 2), ['voz:99', 'voz:40']);
    assert.ok(second.keys.every(key => !first.keys.includes(key)));
    articles = [thread(98), ...articles.reverse()];
    await click('prev'); assert.deepEqual((await read()).keys, first.keys);
    await click('next'); assert.deepEqual((await read()).keys, second.keys);
    // Verify compact session restoration, then advance with the restored history.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.Alpine && Alpine.$data(document.body).currentPage === 2
        && !Alpine.$data(document.body).isLoadingArticles, { timeout: 60000 });
    await click('next');
    const third = await read(); assert.equal(third.page, 3); assert.equal(third.keys[0], 'voz:98');
    assert.ok(third.keys.every(key => ![...first.keys, ...second.keys].includes(key)));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'MOBILE_REPLY_BUMP_PAGING_OK', pages: [first.page, second.page, third.page],
        counts: [first.keys.length, second.keys.length, third.keys.length], backAndForward: true, reload: true, requests }));
} finally { await browser.close(); }
