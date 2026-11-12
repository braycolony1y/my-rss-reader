import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { protectBrowserApiWrites } from './read-only-browser.mjs';

const output = process.argv[2];
if (!output) throw Error('Usage: sqlite-browser.mjs OUTPUT');
const base = process.env.READER_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const reports = [];
try {
    for (const mobile of process.env.RSS_SQLITE_AUDIT_MOBILE_ONLY === 'true' ? [true] : [false, true]) {
        const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
        await protectBrowserApiWrites(context);
        await context.addCookies([{ name: 'auth', value: 'true', url: base }]);
        const page = await context.newPage(), errors = [], views = [], failedResponses = [];
        console.log(JSON.stringify({ phase: 'page-created', mobile }));
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 400) failedResponses.push({ path: new URL(response.url()).pathname, status: response.status() }); });
        await page.goto(base + '/#category/Forum', { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log(JSON.stringify({ phase: 'page-loaded', mobile }));
        try {
            await page.waitForFunction(() => window.Alpine && Alpine.$data(document.body).articles?.length && !Alpine.$data(document.body).isLoadingArticles, null, { timeout: 90000 });
        } catch (error) {
            const state = await page.evaluate(() => { const app = window.Alpine && Alpine.$data(document.body); return { title: document.title, alpine: !!window.Alpine, articles: app?.articles?.length, loading: app?.isLoadingArticles, filter: app?.filterType, error: app?.error }; });
            await fs.writeFile(output, JSON.stringify({ mobile, state, errors, failedResponses }, null, 2));
            throw error;
        }
        for (const filter of ['category', 'saved', 'board']) {
            await page.evaluate(filter => Alpine.$data(document.body).setFilter(filter, filter === 'category' ? 'Forum' : ''), filter);
            await page.waitForFunction(() => !Alpine.$data(document.body).isLoadingArticles && Alpine.$data(document.body).articles?.length, null, { timeout: 90000 });
            views.push(await page.evaluate(filter => ({ filter, articles: Alpine.$data(document.body).articles.length, renderedCards: document.querySelectorAll('.article-card').length }), filter));
            console.log(JSON.stringify({ mobile, ...views.at(-1) }));
        }
        await page.screenshot({ path: output.replace(/\.json$/, mobile ? '-mobile.png' : '-desktop.png') });
        assert.ok(views.every(view => view.renderedCards > 0));
        assert.deepEqual(errors, []);
        reports.push({ mobile, engine: 'Chromium; mobile emulation', views, errors });
        await fs.writeFile(output, JSON.stringify(reports, null, 2));
        console.log(JSON.stringify({ phase: 'verified', mobile }));
        await context.close();
    }
} finally { await browser.close(); }
console.log(JSON.stringify(reports, null, 2));
