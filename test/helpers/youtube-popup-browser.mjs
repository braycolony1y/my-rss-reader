// Browser regression for sandbox inheritance after a native player link click.
import assert from 'node:assert/strict';
import http from 'node:http';
import puppeteer from 'puppeteer-core';
import { sanitizePostMarkup } from '../../src/articles/post-markup-sanitizer.js';
import { cleanVozCachedContent } from '../../src/sources/voz-cached-content.js';

const legacy = '<iframe src="https://www.youtube.com/embed/AQ7-f2epAz8?start=898" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"></iframe>';
const cases = { legacy, fresh: sanitizePostMarkup(legacy), cached: cleanVozCachedContent(legacy) };
const submissions = [];
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Content-Type', 'text/html');
    if (url.pathname === '/watch') {
        res.end(`<form method="post" action="/submitted${url.search}"><button>Continue</button></form>`);
    } else if (url.pathname === '/submitted') {
        submissions.push(url.search);
        res.end('Watch page works');
    } else res.end('<html><body>Reader</body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
    browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    for (const [name, markup] of Object.entries(cases)) {
        const context = await browser.createBrowserContext();
        try {
            const page = await context.newPage();
            await page.setRequestInterception(true);
            page.on('request', request => {
                if (request.url().startsWith('https://www.youtube.com/embed/')) {
                    request.respond({ contentType: 'text/html', body: `<a target="_blank" rel="noopener" href="${origin}/watch?v=AQ7-f2epAz8&time_continue=898">Watch on YouTube</a>` });
                } else request.continue();
            });
            await page.goto(origin);
            await page.setContent(markup);
            const frame = page.frames().find(frame => frame.url().startsWith('https://www.youtube.com/embed/'));
            assert.ok(frame, name + ': player loaded');
            await frame.waitForSelector('a');
            const targetPromise = browser.waitForTarget(target => target.url().startsWith(origin + '/watch'));
            await frame.click('a');
            const popup = await (await targetPromise).page();
            await popup.waitForSelector('button');
            const errors = [];
            popup.on('console', message => errors.push(message.text()));
            if (name === 'legacy') {
                await popup.click('button');
                assert.equal(new URL(popup.url()).pathname, '/watch');
                assert.equal(submissions.length, 0);
                assert.ok(errors.some(message => /sandboxed.*allow-forms/i.test(message)), 'legacy popup inherits form restrictions');
            } else {
                await Promise.all([popup.waitForNavigation(), popup.click('button')]);
                assert.equal(new URL(popup.url()).pathname, '/submitted');
                assert.equal(new URL(popup.url()).searchParams.get('time_continue'), '898');
                assert.equal(await popup.$eval('body', node => node.textContent), 'Watch page works');
            }
            assert.equal(page.url(), origin + '/', 'reader remains open');
            console.log(JSON.stringify({ case: name, popup: popup.url(), inheritedFormRestriction: name === 'legacy' }));
        } finally { await context.close(); }
    }
    assert.equal(submissions.length, 2);
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
