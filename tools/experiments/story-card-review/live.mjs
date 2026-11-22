// Render the existing Alpine component with live data and existing controls.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { decode, textContrast, sampleSurface } from './pixels.mjs';
const base = process.env.READER_URL || 'http://127.0.0.1:3000';
const output = process.env.CARD_OUTPUT || '/tmp/story-card-editorial-review';
const pass = process.env.CARD_PASS || 'final';
const widths = (process.env.CARD_WIDTHS || '320,375,390,430,560,645,800,1000,1100').split(',').map(Number);
await fs.mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setCookie({ name: 'auth', value: 'true', url: base });
    await page.evaluateOnNewDocument(() => localStorage.setItem('theme', 'glass-light'));
    await page.setViewport({ width: 1450, height: 1200, deviceScaleFactor: 1 });
    await page.goto(base + '/#smart/news_vietnam', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.Alpine?.$data(document.body)?.feeds?.length, { timeout: 60000 });
    await page.evaluate(() => {
        const button = action => [...document.querySelectorAll('button')].find(el => el.getAttribute('@click') === action);
        button("setSmartSection('news')").click(); button("setFilter('smart', 'news_vietnam')").click();
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.article-card h2')].some(el => el.textContent.includes('Hải Sâm')), { timeout: 60000 });
    const card = await page.$('::-p-xpath(//h2[contains(., "Hải Sâm")]/ancestor::div[contains(@class,"article-card ")])');
    assert.ok(card, 'The supplied story exists in the reader');
    await card.evaluate(el => { el.dataset.editorialReview = 'true'; el.style.maxWidth = 'none'; });
    await card.scrollIntoView();
    await page.waitForFunction(() => document.querySelector('[data-editorial-review]').dataset.storyBlend === 'ready', { timeout: 60000 });
    const report = [];
    for (const width of widths) {
        const mobile = width < 640;
        await page.setViewport({ width: mobile ? width : 1450, height: 1400, deviceScaleFactor: 1 });
        await card.evaluate((el, size) => { el.style.width = `${size}px`; }, mobile ? width - 24 : width);
        await card.scrollIntoView();
        await page.mouse.move(0, 0);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const metrics = await card.evaluate(el => {
            const cr = el.getBoundingClientRect(), style = node => getComputedStyle(node);
            const heading = el.querySelector('.article-card-heading'), image = el.querySelector('.thumbnail-img');
            const text = Object.fromEntries([['headline', el.querySelector('h2')], ['summary', heading.querySelector('p')], ['analysis', el.querySelector('.story-analysis-text')], ['context', el.querySelector('.story-key-fact-copy')]].map(([name, node]) => {
                const b = node.getBoundingClientRect(), canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
                const ctx = canvas.getContext('2d'); ctx.fillStyle = style(node).color; ctx.fillRect(0, 0, 1, 1);
                return [name, { x: b.x - cr.x, y: b.y - cr.y, width: b.width, height: b.height, color: [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)] }];
            }));
            const orbs = [...el.querySelectorAll('.story-coverage-orb')].filter(node => node.getBoundingClientRect().width);
            return { cardWidth: el.clientWidth, cardHeight: el.clientHeight, text,
                natural: [image.naturalWidth, image.naturalHeight], photo: [parseFloat(style(image).width), parseFloat(style(image).height)],
                source: image.src, photoFilter: style(image).filter, photoOpacity: style(image).opacity, mask: style(image).maskImage.includes('data:image/svg+xml'),
                softFilter: style(el.querySelector('.thumbnail-soft')).filter, panel: style(el.querySelector('.story-analysis-shell')).backdropFilter,
                headingBottom: heading.getBoundingClientRect().bottom - cr.top, imageTop: el.querySelector('.article-card-image').getBoundingClientRect().top - cr.top,
                metadataOverflow: el.querySelector('.article-metadata').scrollWidth > el.clientWidth,
                pageOverflow: document.documentElement.scrollWidth > innerWidth,
                contentOverflow: [...el.querySelectorAll('.article-card-heading,.story-analysis-shell,.story-key-fact')].some(node => { const b = node.getBoundingClientRect(); return b.width && (b.left < cr.left || b.right > cr.right); }),
                textOverflow: el.querySelector('.story-analysis-text').scrollWidth > el.querySelector('.story-analysis-text').clientWidth,
                clippedPublishers: orbs.some(node => { const b = node.getBoundingClientRect(); return b.left < cr.left || b.right > cr.right; }),
                titleSize: parseFloat(style(el.querySelector('h2')).fontSize), summarySize: parseFloat(style(heading.querySelector('p')).fontSize) };
        });
        const actual = await card.screenshot({ path: path.join(output, `${pass}-${width}.png`) });
        const hideText = await page.addStyleTag({ content: '[data-editorial-review] :is(h2,.article-card-heading p,.story-analysis-text,.story-key-fact-copy) { visibility: hidden; }' });
        const hidden = await card.screenshot();
        const [a, b] = await Promise.all([decode(actual), decode(hidden)]);
        const contrasts = Object.fromEntries(Object.entries(metrics.text).map(([name, text]) => [name, textContrast(a, b, text)]));
        await hideText.evaluate(el => el.remove());
        const hideContent = await page.addStyleTag({ content: '[data-editorial-review] :is(.article-card-heading,.article-card-panel,.story-rank,.story-coverage-orbs,.article-actions-overlay) { visibility: hidden; }' });
        const clean = await card.screenshot({ path: path.join(output, `${pass}-${width}-surface.png`) });
        const surface = sampleSurface(await decode(clean));
        await hideContent.evaluate(el => el.remove());
        assert.equal(metrics.textOverflow, false); assert.equal(metrics.contentOverflow, false); assert.equal(metrics.clippedPublishers, false);
        assert.ok(metrics.mask); assert.equal(metrics.photoFilter, 'none'); assert.equal(metrics.photoOpacity, '1');
        assert.ok(Math.abs(metrics.natural[0] / metrics.natural[1] - metrics.photo[0] / metrics.photo[1]) < .001, 'Uniform source aspect ratio');
        if (mobile) { assert.equal(metrics.pageOverflow, false); assert.ok(metrics.imageTop >= metrics.headingBottom - 1, 'Mobile text precedes the photograph'); }
        for (const [name, measured] of Object.entries(contrasts)) if (!process.env.REPORT_ONLY) assert.ok(measured.minimum >= (name === 'headline' ? 7 : 4.5), `${width}/${name}: ${measured.minimum}`);
        report.push({ width, ...metrics, contrasts, surface });
        console.log(JSON.stringify({ width, size: [metrics.cardWidth, metrics.cardHeight], contrasts: Object.fromEntries(Object.entries(contrasts).map(([name, c]) => [name, c.minimum?.toFixed(2)])) }));
    }
    await page.setViewport({ width: 1450, height: 1200 }); await card.evaluate(el => { el.style.width = '1000px'; });
    await card.scrollIntoView();
    const copy = () => card.$eval('.story-analysis-text', el => el.textContent.trim());
    const first = await copy(); await card.$eval('.story-analysis-next', el => el.click()); assert.notEqual(await copy(), first);
    await card.$eval('.story-analysis-tabs > button:first-child', el => el.click()); assert.equal(await copy(), first);
    await card.$eval('.story-analysis-more-tab', el => el.click());
    await page.waitForFunction(() => document.querySelector('[data-editorial-review] .story-more-analysis-rail').getBoundingClientRect().height > 0);
    assert.ok(await card.$eval('.top-story-citations a', el => /^https?:/.test(el.href)));
    await card.$eval('.story-analysis-tabs > button:first-child', el => el.click());
    await card.hover(); assert.equal(await card.$eval('.article-actions-overlay', el => getComputedStyle(el).display !== 'none'), true);
    await page.mouse.move(0, 0);
    const paint = () => card.$eval('.thumbnail-img', el => ({ filter: getComputedStyle(el).filter, opacity: getComputedStyle(el).opacity, mask: getComputedStyle(el).maskImage, src: el.src }));
    const before = await paint(); await card.evaluate(el => el.classList.add('is-read')); assert.deepEqual(await paint(), before);
    await card.evaluate(el => el.classList.remove('is-read'));
    await card.screenshot({ path: path.join(output, `${pass}-desktop.png`) });
    await page.screenshot({ path: path.join(output, `${pass}-page.png`) });
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, `${pass}-measurements.json`), JSON.stringify({ cards: report, errors, interactions: 'Next analysis, both tabs, extra analysis, citation destination, hover actions and text-only read state passed' }, null, 2));
} finally { await browser.close(); }
