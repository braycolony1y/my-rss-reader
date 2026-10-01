import { readReaderHtml } from './reader-source.js';
import { verifyClearPhotoRegion } from './card-photo-clarity.js';
// Optional real-browser regression: node test/helpers/image-focus-browser.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { selectImagePalette } from '../../src/images/focal-detector.js';
import { extractLiquidTint } from '../../public/liquid-tint.js';
import { buildCardBlendAssets } from '../../src/images/card-blend/assets.js';
import { backdropColor } from '../../public/image-focus.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const focus = process.env.IMAGE_FOCUS_FIXTURE
    ? JSON.parse(await fs.readFile(process.env.IMAGE_FOCUS_FIXTURE + '.json', 'utf8'))
    : { x: 0.88, y: 0.38, type: 'face', bounds: { left: 0.81, right: 0.95, top: 0.25, bottom: 0.51 } };
const original = readReaderHtml();
assert.ok(!original.includes('article-panel-toggle'), 'the added Show/Hide details control is removed');
const dom = new JSDOM(original);
const template = dom.window.document.querySelector('template[x-for*="displayedArticles"]');
const card = template.content.querySelector('.article-card').cloneNode(true);
card.querySelectorAll('template, .story-coverage-orbs, .article-metadata, .article-actions-overlay').forEach(el => el.remove());
card.querySelectorAll('[x-show]').forEach(el => { if (!el.matches('.article-briefing')) el.style.display = 'none'; });
card.querySelector('.story-rank').textContent = '#12';
card.querySelector('.story-rank').removeAttribute('x-show');
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
    if (mode === 'classic') copy.querySelector('.article-briefing').innerHTML = '<div class="story-coverage-expanded story-coverage-classic-popover"><strong>More publishers</strong><p style="min-height:180px">Additional publisher coverage remains below the header.</p></div>';
    copy.dataset.mode = mode;
    copy.querySelector('.story-rank').style.display = mode === 'top' ? 'block' : 'none';
    copy.dataset.imageLayout = mode === 'top' ? 'top' : 'standard';
    copy.querySelector('.article-card-panel').style.display = mode === 'standard' ? 'none' : '';
    copy.querySelector('.article-card-panel').dataset.expanded = mode === 'top' ? 'true' : 'false';
    return copy.outerHTML;
}).join('');
const styles = [...dom.window.document.querySelectorAll('style')].map(el => el.outerHTML).join('');
const html = `<!doctype html><html class="theme-glass-light" data-image-focus="loading"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/public/styles.css">${styles}<link rel="stylesheet" href="/public/liquid-cards.css"></head><body class="theme-glass-light"><div id="scroll-container"><div class="max-w-4xl mx-auto py-8 px-2 md:px-8">${cards}</div></div><script type="module" src="/public/image-focus.js"></script></body></html>`;
dom.window.close();
const synthetic = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#86adac"/><path d="M0 650L350 300L700 650Z" fill="#608486"/><ellipse cx="1056" cy="650" rx="130" ry="220" fill="#274f65"/><ellipse cx="1056" cy="304" rx="84" ry="104" fill="#f2bc90"/><circle cx="1025" cy="286" r="9"/><circle cx="1087" cy="286" r="9"/><path d="M1027 346Q1056 370 1085 346" fill="none" stroke="#8a483d" stroke-width="8"/></svg>');
const photo = process.env.IMAGE_FOCUS_FIXTURE ? await fs.readFile(process.env.IMAGE_FOCUS_FIXTURE + '.avif') : null;
focus.palette ||= photo
    ? selectImagePalette(await sharp(photo).rotate().removeAlpha().toColourspace('srgb').resize(48, 48).raw().toBuffer(), 48, 48)
    : { primary: [134, 173, 172], secondary: [96, 132, 134] };
focus.blend = await buildCardBlendAssets(photo || synthetic);
focus.tint ||= extractLiquidTint(await sharp(photo || synthetic).rotate().removeAlpha().toColourspace('srgb').resize(64, 64).raw().toBuffer(), 64, 64, 3);
let requests = 0;
const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/image-focus')) { requests++; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(focus)); }
    if (req.url === '/fixture-image.svg') {
        if (photo) { res.setHeader('Content-Type', 'image/avif'); return res.end(photo); }
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.end(synthetic);
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
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => [...document.querySelectorAll('.thumbnail-img')].every(img => img.dataset.focusState === 'ready'));
    await page.evaluate(async () => {
        await Promise.all([...document.querySelectorAll('.thumbnail-img')].map(img => img.decode()));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.$eval('[data-mode="top"]', card => card.style.getPropertyValue('--thumbnail-primary')), backdropColor(focus.palette.primary).join(' '));
    assert.equal(await page.$eval('[data-mode="top"] .thumbnail-img', img => getComputedStyle(img).filter), 'none');
    assert.ok(await page.$$eval('.thumbnail-soft', images => images.every(img => img.src.startsWith('data:image/webp;base64,'))), 'each mode uses the cached tiny soft copy');
    for (const width of [1440, 320, 375, 390, 430, 844]) {
        await page.setViewport({ width, height: 1200 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const checks = await page.$$eval('.article-card', cards => cards.map(card => {
            const header = card.querySelector('.article-card-header').getBoundingClientRect();
            const image = card.querySelector('.article-card-image').getBoundingClientRect();
            const panel = card.querySelector('.article-card-panel').getBoundingClientRect();
            const css = getComputedStyle(card.querySelector('.thumbnail-plate'));
            const mobile = card.getBoundingClientRect().width < 640;
            return { mobile, mode: card.dataset.mode, bottom: image.bottom, headerBottom: header.bottom,
                panelTop: panel.top, panelVisible: panel.height > 0,
                width: Math.round(image.width / header.width * 100), expectedWidth: parseInt(card.style.getPropertyValue('--liquid-image-width')),
                mask: css.maskImage, composite: css.maskComposite,
                imageFilter: getComputedStyle(card.querySelector('.thumbnail-img')).filter,
                softFilter: getComputedStyle(card.querySelector('.thumbnail-soft')).filter,
                panelFilter: getComputedStyle(card.querySelector('.story-analysis-shell') || card.querySelector('.article-card-panel')).backdropFilter };
        }));
        checks.forEach(check => {
            assert.ok(check.mobile ? check.bottom < check.headerBottom : Math.abs(check.bottom - check.headerBottom) < 1, `${width}px ${check.mode}: photo stays in its header`);
            if (check.panelVisible) assert.ok(check.bottom <= check.panelTop + 1, 'photo cannot reach the panel');
            assert.equal(check.width, check.mobile ? 100 : 52, 'banner on mobile, protected side column on desktop');
            assert.equal(check.imageFilter, 'none'); assert.equal(check.softFilter, 'saturate(1.15)');
            assert.ok(check.mask.includes('linear-gradient'), 'shared eased masks are applied');
            assert.equal(check.panelFilter, 'none', 'panels do not add a backdrop filter');
        });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if ([1440, 390, 320].includes(width)) {
            await verifyClearPhotoRegion(page);
            await page.screenshot({ path: root + `test/fixtures/generated/liquid-production-${width}.png`, fullPage: true });
        }
        console.log(`${width}px: Top, Classic and normal thumbnails remain confined to their headers`);
    }
    await page.setViewport({ width: 1440, height: 1200 });
    // ResizeObserver updates the focal position after layout; record the new
    // desktop crop only after it has painted, not the previous tablet crop.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    const top = await page.$('[data-mode="top"]');
    await (await top.$('.article-card-header')).screenshot({ path: root + 'test/fixtures/generated/liquid-corrected-header.png' });
    const before = await top.$eval('.thumbnail-img', img => [img.clientWidth, img.clientHeight, getComputedStyle(img).objectPosition]);
    const panel = await top.$('.article-card-panel');
    const painted = await panel.screenshot();
    await top.$eval('.article-card-image', image => image.style.visibility = 'hidden');
    const withoutPhoto = await panel.screenshot();
    await fs.writeFile(root + 'test/fixtures/generated/liquid-panel.png', painted);
    await fs.writeFile(root + 'test/fixtures/generated/liquid-panel-hidden-photo.png', withoutPhoto);
    // Native element captures can round the card's outer clipped border by
    // two pixels when scrolling. Compare the full interior, including both
    // margins beside the inset panel, without that capture boundary.
    const panelSize = await sharp(painted).metadata();
    const interior = { left: 2, top: 2, width: panelSize.width - 4, height: panelSize.height - 4 };
    assert.ok((await sharp(painted).extract(interior).raw().toBuffer()).equals(await sharp(withoutPhoto).extract(interior).raw().toBuffer()), 'zero sharp/melt photo pixels appear behind or beside the panel');
    await top.$eval('.article-card-image', image => image.style.visibility = '');
    await panel.evaluate(el => el.dataset.expanded = 'false');
    await page.waitForFunction(() => document.querySelector('[data-mode="top"] .article-card-panel').getBoundingClientRect().height < 1);
    assert.deepEqual(await top.$eval('.thumbnail-img', img => [img.clientWidth, img.clientHeight, getComputedStyle(img).objectPosition]), before, 'collapse cannot resize or move the photo');
    await panel.evaluate(el => el.dataset.expanded = 'true');
    await page.waitForFunction(() => document.querySelector('[data-mode="top"] .article-card-panel').getBoundingClientRect().height > 100);
    await top.$eval('.story-analysis-body', body => body.style.minHeight = '900px');
    assert.deepEqual(await top.$eval('.thumbnail-img', img => [img.clientWidth, img.clientHeight, getComputedStyle(img).objectPosition]), before, 'tall analysis cannot resize the photo');
    const classic = await page.$('[data-mode="classic"]');
    const classicCrop = await classic.$eval('.thumbnail-img', img => [img.clientWidth,img.clientHeight,getComputedStyle(img).objectPosition]);
    await classic.$eval('.article-card-panel', panel => panel.dataset.expanded = 'true');
    await page.waitForFunction(() => document.querySelector('[data-mode="classic"] .article-card-panel').getBoundingClientRect().height > 100);
    assert.deepEqual(await classic.$eval('.thumbnail-img', img => [img.clientWidth,img.clientHeight,getComputedStyle(img).objectPosition]), classicCrop, 'Classic coverage expansion cannot resize the photo');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    assert.equal(await panel.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    assert.equal(await top.$eval('.article-panel-content', el => getComputedStyle(el).transform), 'none');
    const beforeRead = await page.$$eval('.article-card', cards => cards.map(card => ({ title: getComputedStyle(card.querySelector('h2')).color, background: getComputedStyle(card).background, image: getComputedStyle(card.querySelector('.thumbnail-img')).filter })));
    await page.$$eval('.article-card', cards => cards.forEach(card => card.classList.add('is-read')));
    const afterRead = await page.$$eval('.article-card', cards => cards.map(card => ({ title: getComputedStyle(card.querySelector('h2')).color, background: getComputedStyle(card).background, image: getComputedStyle(card.querySelector('.thumbnail-img')).filter })));
    afterRead.forEach((after,i) => { assert.notEqual(after.title, beforeRead[i].title); assert.equal(after.background, beforeRead[i].background); assert.equal(after.image, beforeRead[i].image); });
    assert.equal(requests, 1, 'duplicate thumbnails and resizing reuse metadata');
    assert.deepEqual(errors, []);
    await page.$eval('[data-mode="standard"] .thumbnail-img', img => img.src = '/public/default.jpg');
    await page.waitForFunction(() => document.querySelector('[data-mode="standard"]').style.getPropertyValue('--thumbnail-primary') === '');
    assert.equal(await page.$eval('[data-mode="standard"] .thumbnail-soft', img => img.getAttribute('src')), null, 'fallback cannot keep the previous soft photo');
    console.log('IMAGE_FOCUS_BROWSER_OK');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
