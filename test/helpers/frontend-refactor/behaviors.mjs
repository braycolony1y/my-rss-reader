import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startFixtureServer } from './server.js';
import { articleUrl } from './fixtures.js';

const server = await startFixtureServer();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: 'auth', value: 'true', url: server.url }]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.url);
    await page.waitForFunction(() => window.Alpine && Alpine.$data(document.body).articles?.length === 8);
    // Emulate the authoritative read-state snapshot for this isolated browser.
    // The ordinary server fixture deliberately does not persist API writes.
    await page.evaluate(() => {
        const original = window.fetch;
        window.fetch = async (url, options) => {
            const response = await original(url, options);
            if (!String(url).startsWith('/api/data?')) return response;
            const data = await response.json();
            data.readStates = [...Alpine.$data(document.body).readStates];
            return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };
    });
    await page.evaluate(url => Alpine.$data(document.body).markAsReadExplicit(url), articleUrl);
    assert.equal(await page.evaluate(url => Alpine.$data(document.body).readStates.has(url), articleUrl), true);
    await page.evaluate(() => Alpine.$data(document.body).toggleHideRead());
    await page.waitForFunction(() => !Alpine.$data(document.body).isLoadingArticles && Alpine.$data(document.body).articles.length === 7);
    assert.equal(await page.evaluate(() => localStorage.getItem('hideRead')), 'true');
    await page.evaluate(() => Alpine.$data(document.body).toggleHideRead());
    await page.waitForFunction(() => !Alpine.$data(document.body).isLoadingArticles && Alpine.$data(document.body).articles.length === 8);
    await page.locator('input[x-model="searchQuery"]').fill('fixture 3');
    await page.waitForFunction(() => !Alpine.$data(document.body).isLoadingArticles && Alpine.$data(document.body).articles.length === 1);
    assert.match(await page.locator('.article-card h2').innerText(), /fixture 3/);
    await page.locator('input[x-model="searchQuery"]').fill('');
    await page.waitForFunction(() => !Alpine.$data(document.body).isLoadingArticles && Alpine.$data(document.body).articles.length === 8);
    await page.evaluate(() => Alpine.$data(document.body).setFilter('feed', 'https://example.test/feed'));
    await page.waitForFunction(() => !Alpine.$data(document.body).isLoadingArticles && location.hash.startsWith('#feed/'));
    await page.evaluate(() => Alpine.$data(document.body).openArticleOverlay(Alpine.$data(document.body).articles[0]));
    await page.waitForSelector('.embedded-suggested-card a', { state: 'visible' });
    await page.locator('.embedded-suggested-card a').click();
    await page.waitForFunction(() => Alpine.$data(document.body).articleOverlayStack.length === 1 && !Alpine.$data(document.body).isLoadingOverlay);
    await page.goBack();
    await page.waitForFunction(url => Alpine.$data(document.body).articleOverlayOpen && Alpine.$data(document.body).articleRouteUrl(Alpine.$data(document.body).overlayArticle) === url, articleUrl);
    await page.evaluate(() => Alpine.$data(document.body).closeArticleOverlay({ closeAll: true }));
    await page.waitForFunction(() => !Alpine.$data(document.body).articleOverlayOpen && !location.hash.includes('?article='));
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('rssAppState')));
    assert.equal(persisted.selectedFilterType, 'feed');
    assert.deepEqual(errors, []);
    console.log('FRONTEND_BEHAVIORS_OK: read/unread presentation, hide-read, search, feed filter, suggested article, browser Back, overlay close and persisted state');
} finally { await browser.close(); server.close(); }
