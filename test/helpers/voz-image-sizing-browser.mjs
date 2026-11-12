import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { load } from 'cheerio';

const base = process.env.READER_URL || 'http://127.0.0.1:3000';
const output = process.env.READER_BROWSER_OUTPUT || '/tmp/voz-image-sizing';
const article = 'https://voz.vn/t/openai-tiep-tuc-lo-nang.1297823/page-2';
const selector = '.article-rendered-content [data-absolute-post-id="44335467"]';
const fixture = process.env.READER_BROWSER_ARTICLE_FILE ? await readFile(process.env.READER_BROWSER_ARTICLE_FILE, 'utf8') : null;
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const reports = [];
try {
    for (const width of [1440, 390]) {
        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        page.on('pageerror', error => console.error('PAGE ERROR:', error.message));
        await page.setViewport({ width, height: 1000, isMobile: width === 390, hasTouch: width === 390 });
        await context.setCookie({ name: 'auth', value: 'true', url: base });
        await page.evaluateOnNewDocument(() => localStorage.setItem('theme', 'glass-light'));
        await page.setRequestInterception(true);
        page.on('request', request => {
            if (fixture && request.url().includes('/api/article-content?')) {
                return request.respond({ status: 200, contentType: 'application/json', body: fixture });
            }
            if (process.env.READER_BROWSER_FIXTURE_IMAGE === '1' && request.url().includes('G2Ym1om')) {
                return request.respond({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254"><rect width="1254" height="1254" fill="#dedede"/></svg>' });
            }
            if (request.url().includes('/api/') && request.method() !== 'GET') {
                return request.respond({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return request.continue();
        });
        if (fixture) {
            const shell = await (await fetch(base, { headers: { Cookie: 'auth=true' } })).text();
            const $ = load(shell);
            const styles = $('link[rel="stylesheet"]').toString();
            const content = load(JSON.parse(fixture).content)('[data-absolute-post-id="44335467"]').toString();
            await page.setContent(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${base}/">${styles}</head><body class="theme-glass-light"><main class="article-rendered-content" style="margin:16px">${content}</main></body></html>`, { waitUntil: 'domcontentloaded' });
        } else {
            await page.goto(`${base}/#category/Forum`, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForFunction(() => window.Alpine && !Alpine.$data(document.body).isLoadingArticles, { timeout: 60000 });
            await page.evaluate(article => { void Alpine.$data(document.body).openArticleOverlay({ link: article, title: 'OpenAI tiếp tục lỗ nặng' }); }, article);
        }
        try { await page.waitForSelector(selector, { visible: true, timeout: 60000 }); }
        catch (error) {
            await page.screenshot({ path: `${output}/${width}-failure.png` });
            console.error(await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 1500), alpine: Boolean(window.Alpine) })));
            throw error;
        }
        let visiblePost;
        for (const post of await page.$$(selector)) {
            if (await post.evaluate(node => node.getBoundingClientRect().width > 0)) { visiblePost = post; break; }
        }
        assert.ok(visiblePost, 'post is visible');
        await visiblePost.evaluate(node => node.scrollIntoView({ block: 'start' }));
        await page.waitForFunction(selector => {
            const post = [...document.querySelectorAll(selector)].find(node => node.getBoundingClientRect().width > 0);
            const image = post?.querySelector('.voz-post-body img');
            return image?.complete && image.naturalWidth > 0;
        }, { timeout: 60000 }, selector);
        const metrics = await visiblePost.evaluate(post => {
            const image = post.querySelector('.voz-post-body img');
            const quote = image.closest('blockquote');
            const rect = image.getBoundingClientRect();
            return { width: rect.width, height: rect.height, naturalWidth: image.naturalWidth,
                displayWidth: image.getAttribute('width'), inline: getComputedStyle(image).display,
                imageSource: image.currentSrc, quoteWidth: quote.clientWidth,
                quoteOverflow: quote.scrollWidth > quote.clientWidth,
                replyVisible: post.textContent.includes('Nó edu cho bạn') };
        });
        assert.equal(metrics.displayWidth, '100');
        assert.ok(Math.abs(metrics.width - 100) < 1, JSON.stringify(metrics));
        assert.ok(Math.abs(metrics.height - 100) < 1, JSON.stringify(metrics));
        assert.equal(metrics.inline, 'inline-block');
        assert.equal(metrics.quoteOverflow, false);
        assert.equal(metrics.replyVisible, true);
        await visiblePost.screenshot({ path: `${output}/${width}.png` });
        reports.push({ viewport: width, ...metrics });
        await context.close();
    }
    await writeFile(`${output}/report.json`, JSON.stringify(reports, null, 2));
    console.log(JSON.stringify(reports, null, 2));
} finally { await browser.close(); }
