import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { JSDOM } from 'jsdom';
import { coverPosition, installImageFocus } from '../public/image-focus.js';
import { selectFace, detectImageFocus } from '../src/images/focal-detector.js';
import { createFocalCache, publicImageUrl, readImageBytes } from '../src/images/focal-cache.js';
import { registerMediaRoutes } from '../src/routes/media-routes.js';

test('responsive cover crops keep a right-side face in view without exposing empty space', () => {
    const focus = { x: 0.88, y: 0.38, bounds: { left: 0.81, right: 0.95, top: 0.25, bottom: 0.51 } };
    for (const [width, height] of [[440, 220], [185, 260], [215, 200], [340, 180], [150, 300]]) {
        const pos = coverPosition(1200, 800, width, height, focus);
        const scale = Math.max(width / 1200, height / 800);
        const left = (width - 1200 * scale) * pos.x / 100;
        const top = (height - 800 * scale) * pos.y / 100;
        assert.ok(left <= 0.01 && left + 1200 * scale >= width - 0.01);
        assert.ok(top <= 0.01 && top + 800 * scale >= height - 0.01);
        assert.ok(left + focus.bounds.left * 1200 * scale >= -0.01);
        assert.ok(left + focus.bounds.right * 1200 * scale <= width + 0.01);
        assert.ok(top + focus.bounds.top * 800 * scale >= -0.01);
        assert.ok(top + focus.bounds.bottom * 800 * scale <= height + 0.01);
    }
    assert.deepEqual(coverPosition(0, 0, 0, 0), { x: 50, y: 50 });
    assert.deepEqual(coverPosition(800, 400, 400, 200), { x: 50, y: 50 });
    const portrait = coverPosition(400, 1200, 400, 200, { x: 0.5, y: 0.1 });
    assert.ok(portrait.y < 10, 'portrait crop follows subject near the top');
});

test('largest confident face wins over a small face or low-confidence detection', () => {
    const face = selectFace([0.01, 0.99, 0.05, 0.95, 0.6, 0.4], [0.4, 0.4, 0.5, 0.5, 0.75, 0.15, 0.98, 0.65, 0, 0, 1, 1]);
    assert.equal(face.type, 'face');
    assert.ok(face.x > 0.85);
    assert.equal(selectFace([0.8, 0.2], [0, 0, 1, 1]), null);
});

test('bundled detector runs locally and uses centre for a uniform image', async () => {
    const bytes = await sharp({ create: { width: 120, height: 90, channels: 3, background: '#808080' } }).png().toBuffer();
    assert.deepEqual(await detectImageFocus(bytes), { x: 0.5, y: 0.5, type: 'center', confidence: 0 });
    await assert.rejects(detectImageFocus(Buffer.from('not an image')));
});

test('saliency finds a contrasting subject on the right when there is no face', async () => {
    const bytes = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#667788' } })
        .composite([{ input: Buffer.from('<svg width="1200" height="800"><rect x="950" y="150" width="200" height="300" fill="#ffbb22"/></svg>') }])
        .png().toBuffer();
    const focus = await detectImageFocus(bytes);
    assert.equal(focus.type, 'saliency');
    assert.ok(focus.x > 0.75);
    assert.ok(focus.y > 0.1 && focus.y < 0.6);
});

test('focal results deduplicate concurrently and survive a fresh cache instance', async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'rss-focus-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    let downloads = 0;
    const options = { directory, download: async () => { downloads++; return Buffer.from('image'); }, detect: async () => ({ x: 0.88, y: 0.38, type: 'face' }) };
    const cache = createFocalCache(options);
    const results = await Promise.all(Array.from({ length: 5 }, () => cache.get('https://example.com/image.jpg')));
    assert.equal(downloads, 1);
    assert.ok(results.every(r => r.x === 0.88));
    assert.equal((await createFocalCache(options).get('https://example.com/image.jpg')).y, 0.38);
    assert.equal(downloads, 1);
    await cache.get('https://example.com/changed.jpg');
    assert.equal(downloads, 2);
});

test('failed downloads are not persisted and queue saturation degrades to centre', async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'rss-focus-failure-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const failed = createFocalCache({ directory, download: async () => { throw new Error('offline'); } });
    assert.equal((await failed.get('https://example.com/a.jpg')).retry, true);
    let release;
    const cache = createFocalCache({ directory, maxPending: 1, download: () => new Promise(r => { release = r; }), detect: async () => ({ x: 0.8, y: 0.3 }) });
    const pending = cache.get('https://example.com/a.jpg');
    assert.equal((await cache.get('https://example.com/b.jpg')).retry, true);
    while (!release) await new Promise(r => setImmediate(r));
    release(Buffer.from('image'));
    assert.equal((await pending).x, 0.8);
});

test('image downloads reject local URLs, unsupported content and oversized streams', async () => {
    for (const url of ['file:///tmp/a.jpg', 'http://127.0.0.1/a', 'http://[::1]/a', 'http://localhost/a', 'http://foo.internal/a', 'https://user:pass@example.com/a']) assert.equal(publicImageUrl(url), null);
    assert.equal(publicImageUrl('https://images.example.com/a.jpg#fragment'), 'https://images.example.com/a.jpg');
    await assert.rejects(readImageBytes(new Response('<html>', { headers: { 'content-type': 'text/html' } })));
    await assert.rejects(readImageBytes(new Response(new Uint8Array(8 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } })));
    assert.equal((await readImageBytes(new Response('image', { headers: { 'content-type': 'image/jpeg' } }))).toString(), 'image');
});

test('focus route requires authentication and resolves reader-owned image URLs', async () => {
    const routes = new Map();
    const seen = [];
    registerMediaRoutes({
        app: { get: (url, ...handlers) => routes.set(url, handlers) },
        getLastKnownCachedArticleImage: async () => '/api/proxy-image?url=https%3A%2F%2Fexample.com%2Fphoto.jpg',
        imageFocalCache: { get: async url => { seen.push(url); return { x: 0.8, y: 0.3 }; } }
    });
    const [auth, handler] = routes.get('/api/image-focus');
    const res = { code: 200, status(code) { this.code = code; return this; }, send() {}, setHeader() {}, json(value) { this.value = value; return this; } };
    auth({ headers: {} }, res, () => assert.fail('must reject unauthenticated requests'));
    assert.equal(res.code, 401);
    await handler({ query: { src: '/api/og-image?url=https%3A%2F%2Fexample.com%2Fstory' } }, res);
    assert.deepEqual(seen, ['https://example.com/photo.jpg']);
    assert.equal(res.value.x, 0.8);
    await handler({ query: { src: '/api/unrelated?url=https%3A%2F%2Fexample.com' } }, res);
    assert.equal(res.code, 400);
});

test('browser ignores stale focal results, responds to resize and cleans up removed cards', async () => {
    const dom = new JSDOM('<div class="article-card-image"><img class="thumbnail-img" src="https://example.com/a.jpg"></div>', { url: 'https://reader.example.com' });
    const win = dom.window;
    const img = win.document.querySelector('img');
    let boxWidth = 200;
    Object.defineProperties(img, { complete: { get: () => true }, naturalWidth: { get: () => 1200 }, naturalHeight: { get: () => 800 }, clientWidth: { get: () => boxWidth }, clientHeight: { get: () => 300 } });
    const responses = [];
    win.fetch = () => new Promise(resolve => responses.push(resolve));
    const stop = installImageFocus(win);
    const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
    assert.equal(responses.length, 1);
    img.src = 'https://example.com/b.jpg';
    await flush();
    assert.equal(responses.length, 2);
    responses[1]({ ok: true, json: async () => ({ x: 0.9, y: 0.4 }) });
    await flush();
    const correctPosition = img.style.getPropertyValue('--image-focus-x');
    responses[0]({ ok: true, json: async () => ({ x: 0.1, y: 0.4 }) });
    await flush();
    assert.equal(img.style.getPropertyValue('--image-focus-x'), correctPosition);
    boxWidth = 350;
    win.dispatchEvent(new win.Event('resize'));
    const expected = coverPosition(1200, 800, 350, 300, { x: 0.9, y: 0.4 });
    assert.equal(img.style.getPropertyValue('--image-focus-x'), `${expected.x.toFixed(3)}%`);
    img.remove();
    await flush();
    stop(); dom.window.close();
});

test('analysis starts before lazy image loading and the first reveal uses the final crop', async () => {
    const dom = new JSDOM('<div class="article-card-image"><img class="thumbnail-img" loading="lazy" src="https://example.com/unloaded.jpg"></div>', { url: 'https://reader.example.com' });
    const win = dom.window;
    const img = win.document.querySelector('img');
    let loaded = false;
    Object.defineProperties(img, { complete: { get: () => loaded }, naturalWidth: { get: () => loaded ? 1200 : 0 }, naturalHeight: { get: () => loaded ? 800 : 0 }, clientWidth: { get: () => 200 }, clientHeight: { get: () => 300 } });
    let finish, requests = 0;
    win.fetch = () => { requests++; return new Promise(resolve => { finish = resolve; }); };
    const stop = installImageFocus(win);
    assert.equal(requests, 1, 'do not wait for the lazy image load or scrolling');
    assert.equal(img.dataset.focusState, 'pending');
    finish({ ok: true, json: async () => ({ x: 0.9, y: 0.4 }) });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(img.dataset.focusState, 'pending', 'no reveal before dimensions are available');
    loaded = true;
    img.dispatchEvent(new win.Event('load'));
    assert.equal(img.dataset.focusState, 'ready');
    assert.equal(img.style.getPropertyValue('--image-focus-x'), '100.000%');
    stop();
    win.fetch = () => assert.fail('a repeated visit must reuse the session focal result');
    const stopAgain = installImageFocus(win);
    assert.equal(img.dataset.focusState, 'ready');
    stopAgain(); dom.window.close();
});

test('late detection never moves a visible fallback, and applies after it leaves view', async () => {
    const dom = new JSDOM('<div class="article-card-image"><img class="thumbnail-img" src="https://example.com/slow.jpg"></div>', { url: 'https://reader.example.com' });
    const win = dom.window;
    const img = win.document.querySelector('img');
    let top = 20;
    img.getBoundingClientRect = () => ({ top, bottom: top + 300, left: 20, right: 220, width: 200, height: 300 });
    Object.defineProperties(img, { complete: { get: () => true }, naturalWidth: { get: () => 1200 }, naturalHeight: { get: () => 800 }, clientWidth: { get: () => 200 }, clientHeight: { get: () => 300 } });
    const observers = [];
    win.IntersectionObserver = class { constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); } observe() {} unobserve() {} disconnect() {} };
    let fallback, finish;
    const realTimer = win.setTimeout.bind(win);
    win.setTimeout = (callback, delay) => delay === 2500 ? (fallback = callback, -1) : realTimer(callback, delay);
    win.fetch = () => new Promise(resolve => { finish = resolve; });
    const stop = installImageFocus(win);
    assert.equal(observers[0].options.rootMargin, '1600px 0px');
    assert.ok(finish, 'offscreen cards already request their focal metadata');
    observers[0].callback([{ target: img, isIntersecting: true }]);
    fallback();
    assert.equal(img.dataset.focusState, 'ready');
    const originalPosition = img.style.getPropertyValue('--image-focus-x');
    finish({ ok: true, json: async () => ({ x: 0.9, y: 0.4 }) });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(img.style.getPropertyValue('--image-focus-x'), originalPosition, 'do not visibly recrop a slow fallback');
    top = 2000;
    observers[1].callback([{ target: img, isIntersecting: false }]);
    assert.equal(img.style.getPropertyValue('--image-focus-x'), '100.000%');
    stop(); dom.window.close();
});
