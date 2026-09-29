// Optional real-browser regression: node test/helpers/image-focus-browser.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { selectImagePalette } from '../../src/images/focal-detector.js';
import { backdropColor } from '../../public/image-focus.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const focus = process.env.IMAGE_FOCUS_FIXTURE
    ? JSON.parse(await fs.readFile(process.env.IMAGE_FOCUS_FIXTURE + '.json', 'utf8'))
    : { x: 0.88, y: 0.38, type: 'face', bounds: { left: 0.81, right: 0.95, top: 0.25, bottom: 0.51 } };
const original = await fs.readFile(root + 'index.html', 'utf8');
const dom = new JSDOM(original);
const template = dom.window.document.querySelector('template[x-for*="displayedArticles"]');
const card = template.content.querySelector('.article-card').cloneNode(true);
card.querySelectorAll('template, .story-rank, .story-coverage-orbs, .article-metadata, .article-actions-overlay').forEach(el => el.remove());
card.querySelectorAll('[x-show]').forEach(el => { if (!el.matches('.article-briefing')) el.style.display = 'none'; });
card.querySelector('h2').textContent = focus.title || 'Keeping the subject in view on every screen';
card.querySelector('.article-card-heading p').textContent = focus.description || 'The same focal point adapts to this card’s width and height.';
card.querySelector('.article-briefing').innerHTML = `<div class="story-key-facts"><div class="story-key-fact"><span class="story-key-fact-icon">▣</span><span class="story-key-fact-copy"><strong>Key fact</strong><span>The heading is the clear photo area.</span></span></div></div>
<div class="story-analysis-shell"><div class="story-analysis-tabs"><button class="is-active">Why it matters</button><button>More analysis</button></div>
<div class="story-analysis-body"><p>A tall analysis panel must not cover the face or enlarge the crop.</p><p style="min-height:200px">Additional analysis.</p></div></div>`;
const img = card.querySelector('.thumbnail-img');
img.src = '/fixture-image.svg'; img.removeAttribute('loading');
const cards = ['top', 'classic', 'standard'].map(mode => {
    const copy = card.cloneNode(true);
    copy.classList.add('has-story-briefing');
    if (mode === 'classic') copy.classList.add('is-smart-classic-card');
    if (mode === 'standard') copy.classList.add('is-standard-card');
    copy.dataset.mode = mode;
    copy.dataset.imageLayout = mode === 'top' ? 'top' : 'standard';
    if (mode !== 'top') copy.querySelector('.article-briefing').remove();
    return copy.outerHTML;
}).join('');
const styles = [...dom.window.document.querySelectorAll('style')].map(el => el.outerHTML).join('');
const html = `<!doctype html><html class="theme-glass-light" data-image-focus="loading"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/public/styles.css">${styles}</head><body class="theme-glass-light"><div id="scroll-container"><div class="max-w-4xl mx-auto py-8 px-2 md:px-8">${cards}</div></div><script type="module" src="/public/image-focus.js"></script></body></html>`;
dom.window.close();
const photo = process.env.IMAGE_FOCUS_FIXTURE ? await fs.readFile(process.env.IMAGE_FOCUS_FIXTURE + '.avif') : null;
focus.palette ||= photo
    ? selectImagePalette(await sharp(photo).rotate().removeAlpha().toColourspace('srgb').resize(48, 48).raw().toBuffer(), 48, 48)
    : { primary: [134, 173, 172], secondary: [96, 132, 134] };
let requests = 0;
const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/image-focus')) { requests++; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(focus)); }
    if (req.url === '/fixture-image.svg') {
        if (photo) { res.setHeader('Content-Type', 'image/avif'); return res.end(photo); }
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#86adac"/><path d="M0 650L350 300L700 650Z" fill="#608486"/><ellipse cx="1056" cy="650" rx="130" ry="220" fill="#274f65"/><ellipse cx="1056" cy="304" rx="84" ry="104" fill="#f2bc90"/><circle cx="1025" cy="286" r="9"/><circle cx="1087" cy="286" r="9"/><path d="M1027 346Q1056 370 1085 346" fill="none" stroke="#8a483d" stroke-width="8"/></svg>');
    }
    if (req.url.startsWith('/public/')) {
        const pathname = req.url.split('?')[0];
        res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.jpg') ? 'image/jpeg' : 'text/css');
        return res.end(await fs.readFile(root + pathname));
    }
    res.setHeader('Content-Type', 'text/html'); res.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 1200 });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => [...document.querySelectorAll('.thumbnail-img')].every(img => img.dataset.focusState === 'ready'));
    await page.evaluate(async () => {
        await Promise.all([...document.querySelectorAll('.thumbnail-img')].map(img => img.decode()));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.$eval('[data-mode="top"]', card => card.style.getPropertyValue('--thumbnail-primary')), backdropColor(focus.palette.primary).join(' '));
    assert.equal(await page.$eval('[data-mode="top"] .thumbnail-img', img => getComputedStyle(img).filter), 'none');
    for (const viewport of await page.$$('.article-card-image')) {
        // Compare the rendered lower-right interior with the unmasked photo.
        // This catches the old broad cloud even when mask syntax looks valid.
        await page.waitForFunction(() => [...document.querySelectorAll('.thumbnail-img')].every(img => getComputedStyle(img).opacity === '1'));
        const before = await viewport.screenshot();
        const style = await viewport.evaluate(el => {
            const original = el.style.cssText;
            el.style.setProperty('mask-image', 'none', 'important');
            return original;
        });
        const after = await viewport.screenshot();
        await viewport.evaluate((el, original) => { el.style.cssText = original; }, style);
        const { width, height } = await sharp(before).metadata();
        const isTop = await viewport.evaluate(el => el.closest('.article-card').dataset.imageLayout === 'top');
        const patch = { left: Math.floor(width * .82), top: height - (isTop ? 160 : 16), width: Math.floor(width * .1), height: 8 };
        const masked = await sharp(before).extract(patch).removeAlpha().raw().toBuffer();
        const clear = await sharp(after).extract(patch).removeAlpha().raw().toBuffer();
        if (!masked.equals(clear)) {
            await fs.writeFile('/tmp/card-edge-masked.png', before);
            await fs.writeFile('/tmp/card-edge-clear.png', after);
            console.log(await viewport.evaluate(el => ({ mode: el.closest('.article-card').dataset.mode, style: el.style.cssText, mask: getComputedStyle(el).maskImage, opacity: getComputedStyle(el.querySelector('img')).opacity })));
        }
        assert.ok(masked.equals(clear), 'lower-right interior must retain the original photo pixels');
    }
    assert.ok(await page.$$eval('.article-card', cards => cards.every(card => getComputedStyle(card).borderLeftWidth === '0px')),
        'the reading side must have no visible border line');
    for (const width of [1440, 320, 375, 390, 430, 844, 1440]) {
        await page.setViewport({ width, height: 1200 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const blends = await page.$$eval('.article-card', cards => cards.map(card => {
            const image = card.querySelector('.article-card-image');
            const css = getComputedStyle(image);
            return {
                background: getComputedStyle(card).backgroundImage,
                palette: card.style.getPropertyValue('--thumbnail-primary'),
                mask: css.maskImage,
                composite: [...new Set(css.maskComposite.split(', '))].join(', '),
                imageWidth: Math.round(image.getBoundingClientRect().width / card.clientWidth * 100),
                overlay: getComputedStyle(card, '::before').content,
                filter: getComputedStyle(image.querySelector('img')).filter
            };
        }));
        assert.equal(blends.length, 3);
        for (const blend of blends) {
            const { mask, ...shared } = blend;
            const { mask: topMask, ...topShared } = blends[0];
            assert.deepEqual(shared, topShared, `${width}px: all card modes share the thumbnail color treatment`);
            assert.equal(blend.imageWidth, 64);
            assert.ok(!blend.mask.includes('radial-gradient'), 'no radial haze across the lower photo');
            assert.equal(blend.overlay, 'none');
            assert.equal(blend.filter, 'none');
        }
        assert.equal(blends[1].mask, blends[2].mask, 'Classic and normal photos share the same feather');
        assert.notEqual(blends[1].mask, blends[0].mask, 'only Top photos need a bottom transition');
        const checks = await page.evaluate(focus => [...document.querySelectorAll('.thumbnail-img')].map(img => {
            const bounds = focus.bounds || { left: focus.x, right: focus.x, top: focus.y, bottom: focus.y };
            const css = getComputedStyle(img);
            const [px, py] = css.objectPosition.split(' ').map(parseFloat);
            const box = img.getBoundingClientRect();
            const viewport = img.parentElement.getBoundingClientRect();
            const scale = (css.objectFit === 'contain' ? Math.min : Math.max)(box.width / img.naturalWidth, box.height / img.naturalHeight);
            const left = box.left - viewport.left + (box.width - img.naturalWidth * scale) * px / 100;
            const top = (box.height - img.naturalHeight * scale) * py / 100;
            const card = img.closest('.article-card');
            const panel = card.querySelector('.story-analysis-shell');
            return { mode: card.dataset.mode, panelGap: panel ? panel.getBoundingClientRect().top - box.bottom : null,
                fit: css.objectFit, cardHeight: card.clientHeight,
                transform: css.transform, target: Number(css.getPropertyValue('--image-focus-target')),
                left: left + bounds.left * img.naturalWidth * scale, right: viewport.width - (left + bounds.right * img.naturalWidth * scale),
                top: top + bounds.top * img.naturalHeight * scale, bottom: box.height - (top + bounds.bottom * img.naturalHeight * scale), width: box.width, height: box.height };
        }), focus);
        for (const check of checks) {
            assert.equal(check.transform, 'none');
            assert.equal(check.target, width <= 640 ? 0.70 : 0.66);
            assert.ok(check.width > 0 && check.height > 0);
            if (check.mode === 'top') assert.ok(Math.abs(check.panelGap + 100) < 2, 'the Top fade extends behind the panel without changing its layout');
            else {
                assert.equal(check.fit, 'cover', 'Classic/normal images must fill the card without letterboxing');
                assert.ok(Math.abs(check.height - check.cardHeight) < 2);
            }
            for (const edge of ['left', 'right', 'top', 'bottom']) assert.ok(check[edge] >= -0.1, `${width}px ${check.mode}: face clipped at ${edge}: ${JSON.stringify(check)}`);
        }
        if ([1440, 390, 320].includes(width)) await page.screenshot({ path: `${process.env.IMAGE_FOCUS_FIXTURE || '/tmp/rss-focus'}-${width}.png`, fullPage: true });
        console.log(`${width}px: all three card modes retain face bounds`);
    }
    const originalCrop = await page.$eval('[data-mode="top"] .thumbnail-img', img => [img.clientHeight, getComputedStyle(img).objectPosition]);
    await page.$eval('.story-analysis-body', panel => { panel.style.minHeight = '900px'; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await page.$eval('[data-mode="top"] .thumbnail-img', img => [img.clientHeight, getComputedStyle(img).objectPosition]), originalCrop,
        'expanding analysis must not resize or move the heading photo');
    assert.equal(requests, 1, 'resizing and duplicate images must reuse the same focal analysis');
    await page.$$eval('[data-image-layout="standard"]', cards => cards.forEach(card => card.classList.add('is-read')));
    assert.deepEqual(await page.$$eval('[data-image-layout="standard"] .thumbnail-img', images => images.map(img => getComputedStyle(img).opacity)), ['1', '1'],
        'marking Classic/normal cards read must not wash out their photographs');
    assert.deepEqual(errors, []);
    // Hold metadata back while the photo loads: it must not paint centred and
    // then visibly slide to its subject when the request finishes.
    const delayed = await browser.newPage();
    await delayed.setViewport({ width: 390, height: 900 });
    await delayed.setRequestInterception(true);
    let pendingFocus;
    delayed.on('request', request => {
        if (request.url().includes('/api/image-focus')) pendingFocus = request;
        else request.continue();
    });
    await delayed.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
    await delayed.waitForFunction(() => document.querySelector('.thumbnail-img')?.naturalWidth > 0);
    assert.equal(await delayed.$eval('.thumbnail-img', img => getComputedStyle(img).opacity), '0');
    assert.ok(pendingFocus);
    await pendingFocus.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(focus) });
    await delayed.waitForFunction(() => document.querySelector('.thumbnail-img').dataset.focusState === 'ready');
    assert.ok(await delayed.$eval('.thumbnail-img', img => Boolean(img.style.getPropertyValue('--image-focus-x'))));
    await delayed.close();
    // Exercise the actual local fallback, not a mocked palette response.
    await page.$eval('[data-mode="standard"] .thumbnail-img', img => { img.src = '/public/default.jpg'; });
    await page.waitForFunction(() => {
        const card = document.querySelector('[data-mode="standard"]');
        const img = card.querySelector('img.thumbnail-img');
        return img.complete && img.naturalWidth === 816 && card.style.getPropertyValue('--thumbnail-primary') === '';
    });
    const fallbackColor = await page.$eval('[data-mode="standard"]', card => card.style.getPropertyValue('--thumbnail-secondary'));
    assert.equal(fallbackColor, '', 'the default illustration must use the neutral CSS base');
    console.log('IMAGE_FOCUS_BROWSER_OK');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
