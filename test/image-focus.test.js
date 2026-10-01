import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { JSDOM } from 'jsdom';
import { extractLiquidTint, tintProperties } from '../public/liquid-tint.js';
import { coverPosition, installImageFocus, backdropColor } from '../public/image-focus.js';
import { selectFace, detectImageFocus, selectImagePalette } from '../src/images/focal-detector.js';
import { createFocalCache, publicImageUrl, readImageBytes } from '../src/images/focal-cache.js';
import { registerMediaRoutes, downloadFocalImage } from '../src/routes/media-routes.js';

test('card backdrops temper vivid colors and gently lift only darker tints', () => {
    const luminance = rgb => rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    for (const color of [[255, 255, 0], [250, 132, 18]]) {
        const softened = backdropColor(color);
        assert.ok(Math.max(...softened) - Math.min(...softened) <= 65);
        assert.ok(luminance(softened) >= luminance(color) - 1);
        assert.ok(luminance(softened) - luminance(color) < 5);
    }
    for (const color of [[24, 36, 61], [43, 45, 29], [60, 58, 75], [125, 100, 75]]) {
        const softened = backdropColor(color);
        assert.ok(luminance(softened) > luminance(color));
        assert.ok(luminance(softened) - luminance(color) <= 35, 'dark tints receive a modest lift');
        assert.ok(Math.max(...softened) < 160, 'keep visible color, far below white');
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
            if (color[i] > color[j]) assert.ok(softened[i] > softened[j], 'preserve warm/cool channel ordering');
        }
    }
    for (const color of [[180, 205, 220], [220, 210, 190], [255, 255, 255]]) {
        assert.deepEqual(backdropColor(color), color, 'already-light backgrounds stay unchanged');
    }
});

test('AVIF alpha metadata does not distort RGB colors during focal analysis', async () => {
    const bytes = await sharp({ create: { width: 800, height: 600, channels: 4,
        background: { r: 230, g: 140, b: 60, alpha: 1 } } }).avif({ lossless: true }).toBuffer();
    const { palette } = await detectImageFocus(bytes);
    assert.deepEqual(palette.primary, [230, 140, 60]);
    assert.deepEqual(palette.secondary, [230, 140, 60]);
});

test('a Top photo fade tail does not pull the subject behind the analysis panel', () => {
    const focus = { x: .7, y: .6, bounds: { left: .6, right: .8, top: .48, bottom: .72 } };
    const position = coverPosition(1000, 1200, 500, 400, focus, .66, 280);
    const top = (400 - 600) * position.y / 100;
    assert.ok(top + focus.bounds.top * 600 >= 0);
    assert.ok(top + focus.bounds.bottom * 600 <= 280);
});

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
    const { tint, blend, ...result } = await detectImageFocus(bytes);
    assert.equal(tint.h1, 250);
    assert.match(blend.ambientImage, /^data:image\/webp;base64,/);
    assert.equal((await sharp(Buffer.from(blend.ambientImage.split(',')[1], 'base64')).metadata()).width, 96);
    assert.equal((await sharp(Buffer.from(blend.meltImage.split(',')[1], 'base64')).metadata()).width, 320);
    assert.deepEqual(result, { x: 0.5, y: 0.5, type: 'center', confidence: 0,
        palette: { primary: [128, 128, 128], secondary: [128, 128, 128] } });
    await assert.rejects(detectImageFocus(Buffer.from('not an image')));
});

test('thumbnail palettes follow image colors and ignore dark clothing and white highlights', () => {
    for (const color of [[80, 140, 50], [45, 110, 195], [230, 145, 55]]) {
        const pixels = Buffer.alloc(40 * 40 * 3);
        for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
            const sample = x < 20 ? color : x < 34 ? [10, 10, 10] : [250, 250, 250];
            pixels.set(sample, (y * 40 + x) * 3);
        }
        assert.deepEqual(selectImagePalette(pixels, 40, 40), { primary: color, secondary: color });
    }
    assert.deepEqual(selectImagePalette(Buffer.alloc(12, 255), 2, 2).primary, [255, 255, 255]);
    assert.deepEqual(selectImagePalette(Buffer.alloc(12), 2, 2).primary, [0, 0, 0]);
});

test('related foliage shades beat a larger uniform gray area in the thumbnail', () => {
    const pixels = Buffer.alloc(40 * 40 * 3);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
        const rgb = y >= 20 ? [180, 180, 180] : [80 + x, 120 + x, 35 + x];
        pixels.set(rgb, (y * 40 + x) * 3);
    }
    const palette = selectImagePalette(pixels, 40, 40);
    assert.ok(palette.primary[1] - palette.primary[2] > 60, 'retain the environmental green/yellow hue');
    assert.deepEqual(palette.secondary, palette.primary, 'neutral clothing at the bottom must not turn the feather gray');
});

test('dark, muted backgrounds beat a smaller bright face or white collar', () => {
    for (const color of [[24, 36, 61], [43, 45, 31]]) {
        const pixels = Buffer.alloc(48 * 48 * 3);
        for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
            const face = x > 19 && x < 28 && y > 4 && y < 18;
            const collar = x > 18 && x < 30 && y >= 18;
            pixels.set(face ? [215, 150, 112] : collar ? [245, 245, 245] : color, (y * 48 + x) * 3);
        }
        assert.deepEqual(selectImagePalette(pixels, 48, 48), { primary: color, secondary: color });
    }
});

test('background palette ignores central shirts and keeps neutral walls neutral', () => {
    for (const background of [[194, 128, 82], [170, 170, 170], [245, 245, 245]]) {
        for (const shirt of [[255, 255, 255], [220, 25, 45], [20, 70, 220]]) {
            const pixels = Buffer.alloc(80 * 60 * 3);
            for (let y = 0; y < 60; y++) for (let x = 0; x < 80; x++) {
                const subject = x >= 18 && x <= 61 || y >= 25;
                pixels.set(subject ? shirt : background, (y * 80 + x) * 3);
            }
            assert.deepEqual(selectImagePalette(pixels, 80, 60), { primary: background, secondary: background });
        }
    }
});

test('background palette excludes off-center faces and their clothing at both edges', () => {
    const background = [188, 125, 84];
    const faces = [{ left: .02, top: .08, right: .12, bottom: .25 },
        { left: .85, top: .2, right: .95, bottom: .4 }];
    const pixels = Buffer.alloc(100 * 100 * 3);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
        const face = (x <= 12 && y >= 8 && y <= 25) || (x >= 85 && x <= 95 && y >= 20 && y <= 40);
        const shirt = (x <= 22 && y > 25) || (x >= 75 && y > 40);
        pixels.set(face ? [230, 174, 146] : shirt ? [15, 60, 230] : background, (y * 100 + x) * 3);
    }
    assert.deepEqual(selectImagePalette(pixels, 100, 100, 3, faces), { primary: background, secondary: background });
});

test('fully obscured or transparent backgrounds use a neutral fallback', () => {
    const pixels = Buffer.alloc(40 * 40 * 4);
    assert.deepEqual(selectImagePalette(pixels, 40, 40, 4).primary, [244, 251, 252]);
    pixels.fill(230);
    assert.deepEqual(selectImagePalette(pixels, 40, 40, 4,
        [{ left: 0, top: 0, right: 1, bottom: 1 }]).primary, [244, 251, 252]);
});

test('default thumbnails clear existing tints without sampling the navy illustration', () => {
    const dom = new JSDOM('<div class="article-card"><div class="article-card-image"><img class="thumbnail-img" src="/public/default.jpg"></div></div>', { url: 'https://reader.example.com' });
    const win = dom.window, img = win.document.querySelector('img');
    Object.defineProperties(img, { complete: { get: () => true }, naturalWidth: { get: () => 816 }, naturalHeight: { get: () => 544 }, clientWidth: { get: () => 420 }, clientHeight: { get: () => 220 } });
    const card = img.closest('.article-card');
    card.style.setProperty('--thumbnail-primary', '24 36 61');
    card.style.setProperty('--thumbnail-secondary', '24 36 61');
    win.HTMLCanvasElement.prototype.getContext = () => assert.fail('default image must not be sampled');
    win.fetch = () => assert.fail('local images must not need remote analysis');
    const stop = installImageFocus(win);
    assert.equal(card.style.getPropertyValue('--thumbnail-primary'), '');
    assert.equal(card.style.getPropertyValue('--thumbnail-secondary'), '');
    assert.equal(img.dataset.focusState, 'ready');
    stop(); dom.window.close();
});

test('a desktop photo without horizontal crop room still centers its face in the clear area', async () => {
    const dom = new JSDOM('<div class="article-card"><div class="article-card-image"><img class="thumbnail-img" src="https://example.com/portrait.jpg" style="--image-focus-target: .66"></div></div>', { url: 'https://reader.example.com' });
    const win = dom.window, img = win.document.querySelector('img');
    Object.defineProperties(img, { complete: { get: () => true }, naturalWidth: { get: () => 1390 }, naturalHeight: { get: () => 927 }, clientWidth: { get: () => 530 }, clientHeight: { get: () => 220 } });
    const focus = { x: .508, y: .214, type: 'face', bounds: { left: .456, right: .56, top: .083, bottom: .344 } };
    win.fetch = async () => ({ ok: true, json: async () => focus });
    const stop = installImageFocus(win);
    await new Promise(resolve => setTimeout(resolve, 0));
    const shift = parseFloat(img.style.getPropertyValue('--image-focus-shift-x'));
    assert.ok(Math.abs(focus.x * 530 + shift - .66 * 530) < .01);
    assert.ok(shift < .26 * 530, 'the exposed strip must remain inside the transparent mask');
    assert.equal(img.style.getPropertyValue('--image-focus-y'), '0.000%', 'preserve the top of the head');
    stop(); dom.window.close();
});

test('VOZ attachment analysis uses the working direct path and keeps redirects disabled', async () => {
    const calls = [];
    const fetchImage = async (url, options) => {
        calls.push({ url, options });
        return new Response('image', { headers: { 'content-type': 'image/webp' } });
    };
    const url = 'https://voz.vn/attachments/photo-webp.123/';
    assert.equal((await downloadFocalImage(url, { proxyBase: 'https://proxy.example/?url=', fetchImage })).toString(), 'image');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, url);
    assert.equal(calls[0].options.redirect, 'manual');
    calls.length = 0;
    await downloadFocalImage('https://other.example/photo.jpg', { proxyBase: 'https://proxy.example/?url=', fetchImage });
    assert.ok(calls[0].url.startsWith('https://proxy.example/?url='));
});

test('card palette changes with its thumbnail and stale image responses cannot recolor it', async () => {
    const dom = new JSDOM('<div class="article-card"><div class="article-card-image"><img class="thumbnail-img" src="https://example.com/green.jpg"></div></div>', { url: 'https://reader.example.com' });
    const win = dom.window;
    const img = win.document.querySelector('img');
    const card = win.document.querySelector('.article-card');
    Object.defineProperties(img, { complete: { get: () => true }, naturalWidth: { get: () => 1200 }, naturalHeight: { get: () => 800 }, clientWidth: { get: () => 200 }, clientHeight: { get: () => 300 } });
    const responses = [];
    win.fetch = () => new Promise(resolve => responses.push(resolve));
    const stop = installImageFocus(win);
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));
    img.src = 'https://example.com/blue.jpg';
    await flush();
    const result = primary => ({ ok: true, json: async () => ({ x: .8, y: .4, palette: { primary, secondary: primary }, tint: extractLiquidTint(primary, 1, 1, 3) }) });
    responses[1](result([45, 110, 195]));
    await flush();
    assert.equal(card.style.getPropertyValue('--thumbnail-primary'), backdropColor([45, 110, 195]).join(' '));
    assert.equal(card.style.getPropertyValue('--tint-a'), tintProperties(extractLiquidTint([45, 110, 195], 1, 1, 3))['--tint-a']);
    responses[0](result([80, 140, 50]));
    await flush();
    assert.equal(card.style.getPropertyValue('--thumbnail-primary'), backdropColor([45, 110, 195]).join(' '));
    assert.equal(card.style.getPropertyValue('--tint-a'), tintProperties(extractLiquidTint([45, 110, 195], 1, 1, 3))['--tint-a']);
    img.src = 'https://example.com/orange.jpg';
    await flush();
    assert.equal(card.style.getPropertyValue('--thumbnail-primary'), '');
    responses[2](result([230, 145, 55]));
    await flush();
    assert.equal(card.style.getPropertyValue('--thumbnail-secondary'), backdropColor([230, 145, 55]).join(' '));
    img.src = 'https://example.com/pending.jpg';
    await flush();
    img.src = '/public/default.jpg?v=2';
    await flush();
    responses[3](result([24, 36, 61]));
    await flush();
    assert.equal(card.style.getPropertyValue('--thumbnail-primary'), '', 'a late response must not recolor the default image');
    assert.equal(card.style.getPropertyValue('--thumbnail-secondary'), '');
    assert.equal(card.style.getPropertyValue('--tint-a'), tintProperties(null)['--tint-a']);
    stop(); dom.window.close();
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
