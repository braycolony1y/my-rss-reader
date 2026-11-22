import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
const base = process.env.READER_URL || 'http://127.0.0.1:3000';
const output = process.env.CARD_OUTPUT || '/tmp/top-story-adaptive/review';
await fs.mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const linear = v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const lum = rgb => .2126 * linear(rgb[0]) + .7152 * linear(rgb[1]) + .0722 * linear(rgb[2]);
const contrast = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
const decode = buffer => sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
function contrastFromRenders(actual, hidden, text) {
    const { width, channels } = hidden.info;
    const foreground = lum(text.color);
    let minimum = Infinity, samples = 0;
    for (let y = Math.max(0, Math.floor(text.y)); y < Math.min(hidden.info.height, Math.ceil(text.y + text.height)); y++)
        for (let x = Math.max(0, Math.floor(text.x)); x < Math.min(width, Math.ceil(text.x + text.width)); x++) {
            const i = (y * width + x) * channels;
            if (Math.max(...[0, 1, 2].map(c => Math.abs(actual.data[i + c] - hidden.data[i + c]))) < 30) continue;
            minimum = Math.min(minimum, contrast(foreground, lum(hidden.data.subarray(i, i + 3)))); samples++;
        }
    return { minimum: samples ? minimum : null, samples };
}
function seamProfiles(render, state) {
    const { width, height, channels } = render.info;
    const pixel = (x, y) => lum(render.data.subarray((y * width + x) * channels, (y * width + x) * channels + 3));
    const rows = [], columns = [];
    for (let y = Math.max(0, Math.floor((state.meltStart - .05) * height)); y < height - 34; y++) {
        let sum = 0, count = 0;
        for (let x = Math.floor(width * .45); x < width * .95; x++) { sum += pixel(x, y); count++; }
        rows.push(sum / count);
    }
    for (let x = Math.floor(width * .30); x < width * .65; x++) {
        let sum = 0, count = 0;
        for (let y = Math.floor(height * .05); y < height * .55; y++) { sum += pixel(x, y); count++; }
        columns.push(sum / count);
    }
    const jump = profile => profile.slice(6).reduce((max, value, i) => Math.max(max, Math.abs(value - profile[i])), 0);
    return { bottom: jump(rows), left: jump(columns) };
}
try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1580, height: 1100, deviceScaleFactor: 1 });
    await page.goto(base + '/public/top-story-card/demo/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.documentElement.dataset.reviewReady === 'true', { timeout: 60000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.thumbnail-soft')].every(img => img.complete && img.naturalWidth));
    await page.addStyleTag({content:'.review-controls { display: none !important; }'});
    const report = [];
    for (const theme of (process.env.CARD_THEMES || 'light,dark').split(',')) for (const width of (process.env.CARD_WIDTHS || '340,560,740').split(',').map(Number)) {
        await page.evaluate((width, theme) => { const select=document.querySelector('#width'); if(![...select.options].some(o=>o.value===String(width)))select.add(new Option(width,width)); select.value = String(width); document.querySelector('#theme').value = theme; window.topStoryReview.update(); }, width, theme);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        for (const card of await page.$$('.article-card')) {
            await card.scrollIntoView();
            await card.evaluate(async el => Promise.all([...el.querySelectorAll('.thumbnail-img,.thumbnail-soft')].map(img=>img.decode().catch(()=>{}))));
            const info = await card.evaluate(el => {
                const r = el.getBoundingClientRect();
                const visible = selector => [...el.querySelectorAll(selector)].find(node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
                const text = Object.fromEntries([['headline', visible('h2')], ['summary', visible('.article-card-heading p')], ['footer', visible('.story-freshness')]].map(([name, node]) => {
                    if (!node) return [name, null];
                    const b = node.getBoundingClientRect(), canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
                    const ctx = canvas.getContext('2d'); ctx.fillStyle = getComputedStyle(node).color; ctx.fillRect(0, 0, 1, 1);
                    return [name, { x: b.x - r.x, y: b.y - r.y, width: b.width, height: b.height, color: Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)) }];
                }));
                const state = window.topStoryReview.storyBlendState(el);
                const photo=getComputedStyle(el.querySelector('.thumbnail-soft'));
                const orbRects=[...el.querySelectorAll('.story-coverage-orb')].map(orb=>orb.getBoundingClientRect());
                return { id: el.dataset.fixture, text, geometry: state.geometry.p, avatarZoneLum: state.avatarZoneLum,
                    sourceRatio:state.analysis.w/state.analysis.h, imageRatio:parseFloat(photo.width)/parseFloat(photo.height),
                    objectFit:photo.objectFit, transform:photo.transform,
                    titleSize:parseFloat(getComputedStyle(el.querySelector('h2')).fontSize),
                    summarySize:parseFloat(getComputedStyle(el.querySelector('.article-card-heading p')).fontSize),
                    subjectMask:el.style.getPropertyValue('--subject-scrim-mask'),
                    overlayMask:getComputedStyle(el,'::after').maskImage,
                    avatarsClipped:orbRects.some(b=>b.left<r.left+1 || b.right>r.right-1),
                    panel: getComputedStyle(el.querySelector('.story-analysis-shell')).backdropFilter,
                    titleWeight: getComputedStyle(el.querySelector('h2')).fontWeight,
                    clamp: getComputedStyle(el.querySelector('.article-card-heading p')).webkitLineClamp,
                    overflow: el.querySelector('.story-analysis-text').scrollWidth > el.querySelector('.story-analysis-text').clientWidth };
            });
            const dimensions = () => card.evaluate(el => {
                const cr = el.getBoundingClientRect();
                return Object.fromEntries(['.article-card-heading', '.article-metadata', 'h2', '.article-card-heading p', '.story-analysis-shell', '.story-analysis-tabs', '.story-analysis-body', '.story-analysis-next', '.story-coverage-orbs', '.story-rank'].map(selector => {
                    const r = el.querySelector(selector)?.getBoundingClientRect();
                    return [selector, r && { x: r.x - cr.x, y: r.y - cr.y, width: r.width, height: r.height }];
                }));
            });
            const after = await dimensions();
            await card.evaluate(el => { el.dataset.savedBlend = el.dataset.storyBlend; delete el.dataset.storyBlend; });
            const before = await dimensions();
            await card.evaluate(el => { el.dataset.storyBlend = el.dataset.savedBlend; delete el.dataset.savedBlend; });
            const layoutDifference = Math.max(...Object.keys(before).flatMap(k => Object.keys(before[k] || {}).map(p => Math.abs(before[k][p] - after[k][p]))));
            const original = await card.screenshot({ path: path.join(output, `${info.id}-${width}-${theme}.png`) });
            const hideText = await page.addStyleTag({ content: '[data-fixture] :is(h2,.article-card-heading p,.story-freshness) { visibility:hidden; }' });
            const background = await card.screenshot();
            const [a, b] = await Promise.all([decode(original), decode(background)]);
            const contrasts = Object.fromEntries(Object.entries(info.text).map(([name, text]) => [name, text ? contrastFromRenders(a, b, text) : null]));
            await hideText.evaluate(el => el.remove());
            const hideContent = await page.addStyleTag({ content: '[data-fixture] :is(.article-card-heading,.article-card-panel,.story-coverage-orbs,.story-rank,.article-entity-row,.article-actions-overlay) { visibility:hidden; }' });
            const clean = await card.screenshot({ path: path.join(output, `${info.id}-${width}-${theme}-surface.png`) });
            const surface = await decode(clean);
            const seams = seamProfiles(surface, info.geometry);
            const blurred = await sharp(clean).blur(40).png().toBuffer();
            const blurredSeams = seamProfiles(await decode(blurred), info.geometry);
            if (theme === 'light' && width === 740) {
                await sharp(clean).resize(32, 20, { fit: 'fill' }).png().toFile(path.join(output, `${info.id}-32x20.png`));
                await fs.writeFile(path.join(output, `${info.id}-blur40.png`), blurred);
            }
            await hideContent.evaluate(el => el.remove());
            assert.ok(layoutDifference <= 1, `${info.id}/${width}: palette application shifted content by ${layoutDifference}px`);
            assert.equal(info.clamp, width < 640 ? '5' : '3'); assert.equal(info.titleWeight, '600'); assert.equal(info.overflow, false);
            assert.equal(info.objectFit,'contain'); assert.equal(info.transform,'none'); assert.equal(info.geometry.scale,1);
            assert.ok(Math.abs(info.sourceRatio-info.imageRatio)<.001,`${info.id}/${width}: photo aspect ratio`);
            assert.ok(info.geometry.offsetY+info.geometry.imageH<=info.geometry.heroH+.01,`${info.id}/${width}: whole photo fits`);
            assert.equal(info.subjectMask,''); assert.ok(!info.overlayMask.includes('radial-gradient'));
            assert.equal(info.avatarsClipped,false,`${info.id}/${width}: source avatar clipping`);
            assert.ok(info.titleSize<=28 && info.titleSize>=info.summarySize*1.35); assert.ok(info.summarySize<=16);
            assert.ok(info.panel.includes('blur(18px)'));
            report.push({ theme, width, ...info, layoutDifference, contrasts, seams, blurredSeams });
            console.log(JSON.stringify({ id: info.id, theme, width, mode: info.geometry.mode, layoutDifference, contrast: Object.fromEntries(Object.entries(contrasts).map(([k, v]) => [k, v?.minimum?.toFixed(2)])), seams }));
        }
    }
    await page.evaluate(() => { document.querySelector('#debug').checked = true; window.topStoryReview.update(); });
    assert.equal(await page.$$eval('.blend-debug-layer', els => els.length), 6);
    await page.screenshot({ path: path.join(output, 'debug.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'measurements.json'), JSON.stringify(report, null, 2));
    const failures = report.flatMap(r => Object.entries(r.contrasts).filter(([name, c]) => c?.minimum && c.minimum < (name === 'headline' ? 7 : 4.5)).map(([name, c]) => `${r.id}/${r.width}/${r.theme}/${name}: ${c.minimum.toFixed(2)}`));
    console.log(JSON.stringify({ cards: report.length, contrastFailures: failures, maxSeam: Math.max(...report.flatMap(r => Object.values(r.seams))), maxBlurredSeam: Math.max(...report.flatMap(r => Object.values(r.blurredSeams))) }, null, 2));
    if (!process.env.STORY_BLEND_REPORT_ONLY) assert.deepEqual(failures, [], 'Rendered text contrast gate');
} finally { await browser.close(); }
