import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const threadUrl = 'https://voz.vn/t/example.123';
const imageUrl = 'https://publisher.example/photo.jpg';
const proxyUrl = '/api/proxy-image?url=' + encodeURIComponent(imageUrl);

function createReader() {
    const dom = new JSDOM(`<!doctype html><html><head>
        <link rel="stylesheet" href="/public/styles.css?v=current">
        <style>.voz-post .voz-like-icon { width: 18px; height: 18px; }</style>
    </head><body class="theme-glass-light"><div id="overlay-scroll-container">
        <figure data-article-export-header class="w-full mb-8">
            <img src="${proxyUrl}" class="rounded-2xl" loading="lazy" @error="retry()">
            <figcaption x-show="caption">Photo caption</figcaption>
        </figure>
        <h1 data-article-export-header class="text-3xl" x-text="title">Displayed title</h1>
        <div data-article-export-header class="flex gap-2">
            <template x-if="author"><span>Unrendered author</span></template>
            <span class="rounded-full"><img src="https://voz.vn/avatar.jpg">Displayed author</span>
            <span class="rounded-full">04/09/2026, 18:43</span>
        </div>
        <button>Download</button>
    </div></body></html>`, { url: 'https://rss.cht.edu.vn/', runScripts: 'outside-only' });
    dom.window.eval(script);
    const app = dom.window.rssApp();
    app.theme = 'glass-light';
    app.overlayArticle = { title: 'Displayed title', author: 'Displayed author', link: threadUrl, overlayImage: proxyUrl };
    app.overlayContent = `<div class="voz-post" data-post-index="1">
        <div class="voz-post-body"><blockquote><h2>Quoted heading</h2>Quoted text</blockquote>
            <img src="${proxyUrl}" loading="lazy" onerror="retry()">
        </div>
        <div class="voz-post-likes flex items-center"><div class="flex gap-0.5">
            <img class="voz-like-icon" src="https://voz.vn/reaction.png" loading="lazy">
        </div><a class="voz-like-users" href="/p/1/reactions">Readers and 140 others</a></div>
    </div>`;
    return { app, dom };
}

test('PDF keeps the displayed header, reader classes and working image URLs', t => {
    const { app, dom } = createReader();
    t.after(() => dom.window.close());
    const payload = app.buildArticlePrintPayload(app.overlayContent);
    const output = new JSDOM(payload.html).window.document;

    assert.equal(output.querySelector('article').className, 'article-print');
    assert.equal(output.querySelector('header').firstElementChild.tagName, 'FIGURE');
    assert.equal(output.querySelectorAll('h1').length, 1);
    assert.equal(output.querySelector('h1').textContent, 'Displayed title');
    assert.equal(output.querySelector('figcaption').textContent, 'Photo caption');
    assert.equal(output.querySelectorAll('header .rounded-full').length, 2);
    assert.ok(output.querySelector('.article-rendered-content .voz-post blockquote'));
    assert.ok(output.querySelector('.voz-post-likes .flex .voz-like-icon'));
    assert.equal(output.querySelector('.voz-like-users').textContent, 'Readers and 140 others');
    assert.equal(output.querySelector('.voz-post-body img').src, 'https://rss.cht.edu.vn' + proxyUrl);
    assert.equal(output.querySelector('.voz-like-users').href, 'https://voz.vn/p/1/reactions');
    assert.equal(output.querySelector('.pdf-source').href, threadUrl);
    assert.equal(output.querySelector('button, template, script, [loading], [onerror], [x-text]'), null);
    assert.doesNotMatch(payload.html, /@error=|x-show=/);
    assert.ok(dom.window.document.querySelector('template'), 'export must not mutate the open reader');
});

test('clipboard still uses portable publisher URLs', t => {
    const { app, dom } = createReader();
    t.after(() => dom.window.close());
    const output = new JSDOM(app.buildArticleClipboardPayload().html).window.document;

    assert.equal(output.querySelector('.voz-post-body img').src, imageUrl);
    assert.equal(output.querySelector('.article-print'), null);
});

test('print document shares current reader styles and theme without application scripts', t => {
    const { app, dom } = createReader();
    t.after(() => dom.window.close());
    dom.window.document.documentElement.className = 'dark';
    const payload = app.buildArticlePrintPayload(app.overlayContent);
    const output = new JSDOM(app.articlePrintDocument(payload)).window.document;

    assert.equal(output.querySelector('link[rel="stylesheet"]').href, 'https://rss.cht.edu.vn/public/styles.css?v=current');
    assert.equal(output.querySelector('style').textContent, dom.window.document.querySelector('style').textContent);
    assert.ok(output.body.classList.contains('theme-glass-light'));
    assert.equal(output.documentElement.className, 'dark');
    assert.equal(output.title, 'Displayed title');
    assert.equal(output.querySelector('script'), null);
});

test('all collected thread pages retain their posts and reactions in the print payload', async t => {
    const { app, dom } = createReader();
    t.after(() => dom.window.close());
    app.overlayPagination = { currentPage: 1, pages: [{ page: 1 }, { page: 2 }] };
    app.fetchVozPdfPage = async (_url, page) => ({
        content: app.overlayContent.replace('data-post-index="1"', `data-post-index="${page}"`),
        pagination: app.overlayPagination,
        sourceDeleted: true
    });
    const content = await app.collectVozThreadForPdf(new AbortController().signal);
    const output = new JSDOM(app.buildArticlePrintPayload(content).html).window.document;

    assert.equal(output.querySelectorAll('.pdf-thread-page').length, 2);
    assert.equal(output.querySelectorAll('.voz-post').length, 2);
    assert.equal(output.querySelectorAll('.voz-post-likes .voz-like-icon').length, 2);
});

test('PDF freezes reader breakpoints, viewport image limits and content width before printing', t => {
    const { app, dom } = createReader();
    t.after(() => dom.window.close());
    const { document } = dom.window;
    dom.window.matchMedia = query => ({ matches: query === '(min-width: 768px)' });
    const style = document.createElement('style');
    style.textContent = `
        @media (min-width: 768px) { h1 { font-size: 36px; } }
        @media (max-width: 640px) { h1 { font-size: 30px; } }
        .hero { max-height: 40vh; }
    `;
    document.head.appendChild(style);
    const content = document.createElement('div');
    content.className = 'article-rendered-content';
    content.getBoundingClientRect = () => ({ width: 624 });
    document.querySelector('#overlay-scroll-container').appendChild(content);
    const output = new JSDOM(app.articlePrintDocument(app.buildArticlePrintPayload(app.overlayContent))).window.document;
    const css = [...output.querySelectorAll('style')].map(node => node.textContent).join('\n');

    assert.match(css, /h1 \{ font-size: 36px; \}/);
    assert.doesNotMatch(css, /font-size: 30px|@media \(min-width: 768px\)/);
    const heroHeight = Number(css.match(/\.hero \{ max-height: ([\d.]+)px/)[1]);
    assert.ok(Math.abs(heroHeight - dom.window.innerHeight * 0.4) < 0.001);
    assert.match(css, /width: 704px/);
    assert.match(css, /width: 632px/);
    assert.ok(output.querySelector('#overlay-scroll-container .article-print .article-rendered-content'));
    assert.equal(output.defaultView.getComputedStyle(output.body).backgroundImage, 'none');
    assert.equal(output.defaultView.getComputedStyle(output.documentElement).backgroundImage, 'none');
});

test('printing waits for the document styles, fonts and images to finish loading', async t => {
    const { app, dom } = createReader();
    t.after(() => dom.window.close());
    const printWindow = new dom.window.EventTarget();
    const image = new dom.window.EventTarget();
    image.complete = false;
    let resolveFonts;
    printWindow.document = {
        readyState: 'loading',
        fonts: { ready: new Promise(resolve => { resolveFonts = resolve; }) },
        images: [image]
    };
    let ready = false;
    const waiting = app.waitForArticlePrintAssets(printWindow).then(() => { ready = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ready, false);
    printWindow.dispatchEvent(new dom.window.Event('load'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ready, false);
    resolveFonts();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ready, false);
    image.dispatchEvent(new dom.window.Event('load'));
    await waiting;
    assert.equal(ready, true);
});

test('PDF download uses a completed server file without opening a print window', async t => {
    const { app, dom } = createReader();
    t.after(() => dom.window.close());
    const requests = [], downloads = [];
    dom.window.open = () => { throw new Error('A print popup must not open'); };
    dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.getAttribute('href')); };
    dom.window.fetch = async (url, options) => {
        requests.push({ url, options });
        return { ok: true, text: async () => JSON.stringify({ id: 'pdf-id', status: 'ready', current: 6803, total: 6803, downloadUrl: '/api/article-pdf/pdf-id/download' }) };
    };
    app.overlayPagination = { currentPage: 6703, pages: [{ page: 1 }, { page: 6803 }] };
    await app.saveArticleAsPdf();
    assert.equal(requests[0].url, '/api/article-pdf');
    assert.equal(JSON.parse(requests[0].options.body).totalPages, 6803);
    assert.deepEqual(downloads, ['/api/article-pdf/pdf-id/download']);
    assert.equal(app.articlePdfState, 'ready');
});

test('closing the reader stops polling but leaves the server export running', t => {
    const { app, dom } = createReader();
    t.after(() => dom.window.close());
    const requests = [];
    dom.window.fetch = (...args) => { requests.push(args); return Promise.resolve({}); };
    app.articlePdfJobId = 'pdf-id';
    app.articlePdfAbortController = new dom.window.AbortController();
    const controller = app.articlePdfAbortController;
    app.cancelArticlePdf({ silent: true });
    assert.equal(controller.signal.aborted, true);
    assert.equal(requests.length, 0);
});


test('PDF API handles a temporary HTML response and reconnects without a JSON parse error', async t => {
    const { app, dom } = createReader(); t.after(() => dom.window.close());
    let calls = 0;
    dom.window.setTimeout = callback => { callback(); return 1; };
    dom.window.fetch = async () => ++calls === 1
        ? { ok: false, status: 502, text: async () => '<!DOCTYPE html><title>Bad Gateway</title>' }
        : { ok: true, status: 200, text: async () => JSON.stringify({ status: 'rendering', current: 10, total: 416 }) };
    const job = await app.requestArticlePdf('/api/article-pdf/example');
    assert.equal(calls, 2); assert.equal(job.current, 10);
});

test('PDF API explains persistent HTML errors and expired authentication', async t => {
    const { app, dom } = createReader(); t.after(() => dom.window.close());
    dom.window.setTimeout = callback => { callback(); return 1; };
    dom.window.fetch = async () => ({ ok: false, status: 502, text: async () => '<!DOCTYPE html>' });
    await assert.rejects(app.requestArticlePdf('/api/article-pdf/example'), /temporarily unavailable/);
    dom.window.fetch = async () => ({ ok: false, status: 401 });
    await assert.rejects(app.requestArticlePdf('/api/article-pdf/example'), /sign in again/);
});
