import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { startFixtureServer } from './frontend-refactor/server.js';
import { paintedCardTextContrast } from './card-paint-contrast.js';

const output = process.env.CARD_OUTPUT || '/tmp/rss-edge-bleed-page';
await fs.mkdir(output, { recursive: true });
const manifest = JSON.parse(await fs.readFile(new URL('../../public/top-story-card/demo/manifest.json', import.meta.url)));
const focus = process.env.CARD_FOCUS ? JSON.parse(await fs.readFile(process.env.CARD_FOCUS, 'utf8')) : null;
const analysis = focus?.blend?.story || (process.env.CARD_ANALYSIS
    ? JSON.parse(await fs.readFile(process.env.CARD_ANALYSIS, 'utf8')) : manifest.samples[0].analysis);
const copy = process.env.CARD_COPY ? JSON.parse(await fs.readFile(process.env.CARD_COPY, 'utf8')) : {};
const photo = Buffer.from(analysis.assets.heroImage.split(',')[1], 'base64');
// Reader-owned API images follow the real metadata lifecycle. /public images
// intentionally bypass it, which cannot exercise detected-face placement.
const photoPath = '/api/proxy-image?url=' + encodeURIComponent('https://fixture.example/photo.webp');
const server = await startFixtureServer({ transformResponse(value, url) {
    if (url.pathname === '/api/image-focus') return focus || { x: analysis.focal.x, y: analysis.focal.y, blend: { story: analysis } };
    if (url.pathname !== '/api/data') return value;
    const withPhoto = article => ({ ...article, ...copy, image: process.env.CARD_DEFAULT ? '/public/default.jpg' : photoPath,
        ...(process.env.CARD_TITLE ? { title: process.env.CARD_TITLE } : {}),
        ...(url.searchParams.get('filterType') !== 'smart'
            ? { isCluster: false, topStory: null, sourceCount: 0, relatedArticles: [] } : {}) });
    return { ...value, articles: value.articles.map(withPhoto), topStories: value.topStories.map(withPhoto) };
} });
const browser = await puppeteer.launch({ executablePath: '/snap/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const changedPixels = async (a, b) => {
    const decode = buffer => sharp(buffer).removeAlpha().raw().toBuffer();
    const [left, right] = await Promise.all([decode(a), decode(b)]);
    assert.equal(left.length, right.length);
    let count = 0;
    for (let i = 0; i < left.length; i += 3) {
        if (Math.max(...[0, 1, 2].map(c => Math.abs(left[i + c] - right[i + c]))) > 20) count++;
    }
    return count;
};
try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', async request => {
        if (new URL(request.url()).pathname === '/api/proxy-image'
            && new URL(request.url()).searchParams.get('url') === 'https://fixture.example/photo.webp') {
            await request.respond({ contentType: 'image/webp', body: photo });
        } else if (process.env.CARD_BASELINE_FIELD && new URL(request.url()).pathname === '/public/top-story-card/mobile-color-field.js') {
            await request.respond({ contentType: 'text/javascript', body: await fs.readFile(process.env.CARD_BASELINE_FIELD, 'utf8') });
        } else if (process.env.EDGE_BLEED_REPRO && new URL(request.url()).pathname === '/public/top-story-card/edge-bleed.css') {
            const css = await fs.readFile(new URL('../../public/top-story-card/edge-bleed.css', import.meta.url), 'utf8');
            await request.respond({ contentType: 'text/css', body: css.replace('z-index: -5 !important;', '') });
        } else await request.continue();
    });
    await page.setCookie({ name: 'auth', value: 'true', url: server.url });
    await page.evaluateOnNewDocument(() => localStorage.setItem('theme', 'glass-light'));
    await page.setViewport({ width: 1440, height: 1100 });
    await page.goto(server.url + '/#category/Forum', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.Alpine && Alpine.$data(document.body).articles.length === 8);
    const report = [];
    for (const mode of (process.env.CARD_MODES || 'standard,classic,top').split(','))
        for (const width of (process.env.CARD_WIDTHS || '1440,390').split(',').map(Number)) {
        await page.setViewport({ width, height: 1100 });
        await page.evaluate(mode => {
            const app = Alpine.$data(document.body);
            app.smartTabMode = mode === 'classic' ? 'classic' : 'top';
            app.setFilter(mode === 'standard' ? 'category' : 'smart', mode === 'standard' ? 'Forum' : 'news_vietnam');
        }, mode);
        const axis = width < 768 ? 'bottom' : 'left';
        await page.waitForFunction(({ axis, faceFrame }) => {
            const card = document.querySelector('.article-card');
            const image = card?.querySelector('.thumbnail-img');
            return card?.dataset.edgeBleed === axis && image?.naturalWidth && image.dataset.focusState === 'ready'
                && (!faceFrame || axis === 'left' || card.dataset.mobileFramed === '1');
        }, {}, { axis, faceFrame: Boolean(focus?.bounds) });
        const card = await page.$('.article-card'); await card.scrollIntoView();
        const presentation = () => card.evaluate(card => {
            const origin = card.getBoundingClientRect();
            return {
            nodes: card.querySelectorAll('*').length,
            palette: card.style.getPropertyValue('--edge-bleed-background'),
            source: card.querySelector('.thumbnail-img').currentSrc,
            focus: getComputedStyle(card.querySelector('.thumbnail-img')).objectPosition,
            boxes: ['.article-card-image', '.article-card-heading', 'h2', '.article-card-heading p', '.article-metadata']
                .map(selector => { const r = card.querySelector(selector).getBoundingClientRect(); return [r.x - origin.x, r.y - origin.y, r.width, r.height]; })
            };
        });
        const maskedPresentation = await presentation();
        const savedMask = await card.evaluate(card => {
            const value = card.style.getPropertyValue('--direct-image-mask');
            card.style.setProperty('--direct-image-mask', 'none'); return value;
        });
        assert.deepEqual(await presentation(), maskedPresentation, `${mode}/${width}: transition changes no layout, elements, colors, source or focus`);
        await card.evaluate((card, value) => {
            if (value) card.style.setProperty('--direct-image-mask', value);
            else card.style.removeProperty('--direct-image-mask');
        }, savedMask);
        const layers = await card.evaluate(card => ({
            background: Number(getComputedStyle(card, '::before').zIndex),
            heading: Number(getComputedStyle(card.querySelector('.article-card-heading')).zIndex),
            photo: Number(getComputedStyle(card.querySelector('.article-card-image')).zIndex)
        }));
        // DOM presence alone missed the regression: compare actual painted pixels.
        const clip = await card.evaluate(card => {
            const r = card.getBoundingClientRect();
            return { x: Math.ceil(r.x) + 1, y: Math.ceil(r.y) + 1,
                width: Math.floor(r.width) - 2, height: Math.floor(r.height) - 2 };
        });
        const capture = options => page.screenshot({ clip, captureBeyondViewport: true, ...options });
        const original = await capture({ path: `${output}/${mode}-${width}.png` });
        const hideText = await page.addStyleTag({ content: '.article-card-heading :is(h2,p){visibility:hidden!important}' });
        const textBackground = await capture();
        const textPixels = await changedPixels(original, textBackground);
        const contrast = width < 768 ? await paintedCardTextContrast(card, clip, original, textBackground) : [];
        await hideText.evaluate(node => node.remove());
        const hidePhoto = await page.addStyleTag({ content: '.article-card-image{visibility:hidden!important}' });
        const photoPixels = await changedPixels(original, await capture());
        await hidePhoto.evaluate(node => node.remove());
        report.push({ mode, width, layers, textPixels, photoPixels, contrast });
        assert.ok(textPixels > 100, `${mode}/${width}: headline and summary must actually paint (${textPixels} pixels)`);
        assert.ok(photoPixels > 500, `${mode}/${width}: photo must actually paint (${photoPixels} pixels)`);
        for (const text of contrast) assert.ok(text.samples > 100 && text.minimum >= 4.5,
            `${mode}/${width}/${text.selector}: actual text contrast is ${text.minimum}`);
        if (width >= 768) assert.ok(layers.background < Math.min(layers.heading, layers.photo), `${mode}: background stays below text and photo`);
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(`${output}/measurements.json`, JSON.stringify(report, null, 2));
    console.log(`PASS: ${report.length} full app cases; text/photo pixels painted above blend; unchanged layout, elements, colors, source and focus; no browser errors`);
} finally { await browser.close(); server.close(); }
