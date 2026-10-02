import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { startFixtureServer } from './server.js';
import { articleUrl } from './fixtures.js';

const output = process.env.READER_BROWSER_OUTPUT || '/tmp/rss-frontend-refactor/current';
await mkdir(output, { recursive: true });
const server = await startFixtureServer({ baseline: process.env.READER_BASELINE || '' });
const browser = await (process.env.READER_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true, args: process.env.READER_BROWSER === 'webkit' ? [] : ['--no-sandbox'] });
const reports = [];
const selectedCases = process.env.READER_CASES?.split(',');
try {
    for (const width of [390, 1440]) {
        for (const theme of ['classic', 'glass', 'glass-light']) {
            if (selectedCases && !selectedCases.includes(`${width}:${theme}`)) continue;
            const context = await browser.newContext({ viewport: { width, height: 1000 } });
            await context.addCookies([{ name: 'auth', value: 'true', url: server.url }]);
            await context.addInitScript(({ theme }) => {
                localStorage.setItem('theme', theme);
                const dateNow = Date.now;
                Date.now = () => 1790928000000;
                window.__originalDateNow = dateNow;
                window.__startupRequests = [];
                const originalFetch = window.fetch;
                window.fetch = function(url, options) {
                    window.__startupRequests.push({ url: String(url), state: document.readyState, hasBody: Boolean(document.body), hasApp: typeof window.rssApp === 'function' });
                    return originalFetch.call(this, url, options);
                };
            }, { theme });
            const page = await context.newPage();
            const errors = [], warnings = [], failedAssets = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => { if (['error', 'warning'].includes(message.type())) warnings.push(message.text()); });
            page.on('response', response => { if (/\.(js|css)(\?|$)/.test(response.url()) && response.status() !== 200) failedAssets.push([response.url(), response.status()]); });
            await page.goto(server.url, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => window.Alpine && Alpine.$data(document.body).articles?.length === 8 && !Alpine.$data(document.body).isLoadingArticles);
            if (process.env.READER_DISABLE_ANIMATIONS === '1') {
                await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });
            }
            const early = await page.evaluate(() => window.__startupRequests.find(r => r.url.startsWith('/api/data')));
            assert.equal(early.state, 'loading');
            assert.equal(early.hasBody, false, 'initial Smart request starts in the head');
            const label = `${width}-${theme}`;
            await page.waitForTimeout(500);
            await page.screenshot({ path: `${output}/${label}-collapsed.png`, animations: 'disabled' });
            await page.evaluate(() => Alpine.$data(document.body).toggleSidebar());
            await page.waitForTimeout(400);
            await page.screenshot({ path: `${output}/${label}-expanded.png`, animations: 'disabled' });
            await page.evaluate(() => Alpine.$data(document.body).closeSidebar());
            await page.evaluate(() => Alpine.$data(document.body).setSmartRegion('global'));
            await page.waitForFunction(() => Alpine.$data(document.body).selectedFilterValue === 'news_global' && !Alpine.$data(document.body).isLoadingArticles);
            await page.evaluate(() => Alpine.$data(document.body).setSmartTabMode('classic'));
            await page.waitForFunction(() => Alpine.$data(document.body).smartTabMode === 'classic' && !Alpine.$data(document.body).isLoadingArticles);
            await page.screenshot({ path: `${output}/${label}-classic.png`, animations: 'disabled' });
            await page.evaluate(() => Alpine.$data(document.body).openArticleOverlay(Alpine.$data(document.body).articles[0]));
            await page.waitForSelector('.article-rendered-content .voz-post', { state: 'visible' });
            await page.waitForTimeout(400);
            await page.screenshot({ path: `${output}/${label}-overlay.png`, animations: 'disabled' });
            await page.locator('[data-ground-filter="left"]').click();
            assert.equal(await page.locator('[data-ground-bias="right"]').isHidden(), true);
            await page.locator('.compare-slider').evaluate(el => { el.value = 65; el.dispatchEvent(new Event('input', { bubbles: true })); });
            assert.equal(await page.locator('.compare-handle').evaluate(el => el.style.left), '65%');
            await page.evaluate(() => { const el = document.getElementById('overlay-scroll-container'); el.scrollTop = 500; });
            assert.ok(await page.locator('#overlay-scroll-container').evaluate(el => el.scrollTop) > 0);
            await page.evaluate(() => Alpine.$data(document.body).closeArticleOverlay());
            await page.waitForFunction(() => !Alpine.$data(document.body).articleOverlayOpen);
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => window.Alpine && Alpine.$data(document.body).articles?.length === 8);
            assert.equal(await page.evaluate(() => Alpine.$data(document.body).theme), theme);
            await page.goto(`${server.url}/#smart/news_global?article=${encodeURIComponent(articleUrl)}`, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('.article-rendered-content .voz-post', { state: 'visible' });
            assert.deepEqual(errors, []);
            assert.deepEqual(failedAssets, []);
            reports.push({ label, early, warnings, errors, failedAssets });
            await context.close();
        }
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(server.url);
    await page.waitForFunction(() => window.Alpine && typeof Alpine.$data(document.body).login === 'function');
    assert.equal(await page.evaluate(() => Alpine.$data(document.body).isLoggedIn), false);
    assert.equal(await page.locator('input[x-model="password"]').isVisible(), true);
    await context.close();
    await writeFile(`${output}/report.json`, JSON.stringify({ reports, requests: server.requests }, null, 2));
    console.log(`FRONTEND_BROWSER_OK: ${reports.length} responsive/theme cases, initial fetch, sidebar, Smart navigation, source widgets, overlay, refresh, deep links, authentication`);
} finally { await browser.close(); server.close(); }
