import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { startFixtureServer } from './frontend-refactor/server.js';

const output = process.env.CARD_OUTPUT || '/tmp/rss-edge-bleed-preview';
await fs.mkdir(output, { recursive: true });
const server = await startFixtureServer();
const manifest = JSON.parse(await fs.readFile(new URL('../../public/top-story-card/demo/manifest.json', import.meta.url)));
const publisherPhoto = Buffer.from(manifest.samples[0].analysis.assets.heroImage.split(',')[1], 'base64');
const browser = await puppeteer.launch({ executablePath: '/snap/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', async request => {
        if (new URL(request.url()).hostname === 'publisher.invalid') {
            await request.respond({ contentType: 'image/webp', body: publisherPhoto });
        } else if (new URL(request.url()).pathname === '/public/top-story-card/demo/index.html') {
            await request.respond({ contentType: 'text/html', body: await fs.readFile(new URL('../../public/top-story-card/demo/index.html', import.meta.url)) });
        } else await request.continue();
    });
    await page.setViewport({ width: 1440, height: 1100 });
    await page.goto(server.url + '/public/top-story-card/demo/index.html');
    console.log('Preview page loaded');
    await page.waitForFunction(() => window.topStoryReview?.entries.every(e => e.img.complete && e.img.naturalWidth));
    const html = await fs.readFile(new URL('../../index.html', import.meta.url), 'utf8');
    const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match => match[1]);
    await page.evaluate(async styles => {
        document.querySelectorAll('link[rel="stylesheet"]').forEach(node => node.remove());
        await Promise.all(styles.map(href => new Promise((resolve, reject) => {
            const node = document.createElement('link'); node.rel = 'stylesheet'; node.href = href;
            node.onload = resolve; node.onerror = reject; document.head.append(node);
        })));
    }, styles);
    console.log('Production styles loaded');
    await page.addStyleTag({ content: '.review-controls,.review-caption{display:none} body{height:auto!important;overflow:auto!important} #scroll-container{display:grid!important;grid-template-columns:1fr!important;gap:20px!important;padding:12px!important;height:auto!important;overflow:visible!important}.review-sample{margin:0!important}' });
    if (process.env.EDGE_BLEED_PHOTO) {
        const data = 'data:image/webp;base64,' + (await fs.readFile(process.env.EDGE_BLEED_PHOTO)).toString('base64');
        await page.evaluate(async data => {
            const e = window.topStoryReview.entries[0]; e.img.src = data; await e.img.decode();
            const { clusterPalette } = await import('/public/top-story-card/blend/palette.js');
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
            const ctx = canvas.getContext('2d'); ctx.drawImage(e.img, 0, 0, 32, 32);
            e.state.source = data;
            e.state.blend.story = { ...e.state.blend.story, ...clusterPalette(ctx.getImageData(0,0,32,32).data,32,32,4),
                w: e.img.naturalWidth, h: e.img.naturalHeight, crop: [0,0,0,0],
                assets: { heroImage: data }, focal: { x: .72, y: .5, w: .1, h: .1, kind: 'default' } };
            e.card.querySelector('h2').textContent = '(Đông Á) Thế hệ chỉ lo đời mình';
            e.card.querySelector('.article-card-heading p').textContent = 'Thế hệ chỉ lo đời mình Giới trẻ khu vực các quốc gia Đông Á rộ lên cụm từ "thế hệ chỉ lo đời mình". Họ vẫn đi làm, kiếm tiền, tích lũy, nhưng từ chối kiệt sức vì những cột mốc chung.';
        }, data);
    }
    const report = [];
    for (const [viewport, width, axis] of [[390, 364, 'bottom'], [760, 700, 'bottom'], [1440, 1100, 'left']]) {
        console.log(`Checking ${axis}/${width}`);
        await page.setViewport({ width: viewport, height: 1100 });
        await page.evaluate(width => {
            const select = document.querySelector('#width'); select.add(new Option(width, width)); select.value = width;
            for (const e of window.topStoryReview.entries) {
                e.card.dataset.smartClusterId = 'fixture';
                e.card.querySelector('.article-card-panel').style.display = 'none';
                e.card.querySelector('.story-rank').style.display = 'none';
            }
            window.topStoryReview.update();
        }, width);
        await page.waitForFunction(axis => window.topStoryReview.entries.every(e => e.card.dataset.edgeBleed === axis), {}, axis);
        const geometry = () => page.evaluate(() => window.topStoryReview.entries.map(({ card, img }) => {
            const rect = node => { const r = node.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; };
            return { card: rect(card), img: rect(img), heading: rect(card.querySelector('.article-card-heading')), focus: getComputedStyle(img).objectPosition };
        }));
        const after = await geometry();
        await page.evaluate(() => { [...document.styleSheets].find(s => s.href?.includes('/edge-bleed.css')).disabled = true; });
        assert.deepEqual(await geometry(), after, 'color continuation preserves all geometry and focus');
        await (await page.$('.article-card')).screenshot({ path: `${output}/${axis}-${width}-before.png` });
        await page.evaluate(() => { [...document.styleSheets].find(s => s.href?.includes('/edge-bleed.css')).disabled = false; });
        await (await page.$('.article-card')).screenshot({ path: `${output}/${axis}-${width}-after.png` });
        const paints = await page.evaluate(axis => window.topStoryReview.entries.map(({ card }) => ({
            gradient: card.style.getPropertyValue('--edge-bleed-background'),
            paint: getComputedStyle(card, axis === 'left' ? '::before' : null).backgroundImage
        })), axis);
        assert.ok(paints.every(p => axis === 'bottom'
            ? p.gradient.includes('data:image/png') && p.paint.includes('data:image/png')
            : (p.gradient.match(/oklch/g) || []).length === 6 && p.paint.includes('linear-gradient')), 'all six images paint spatial colors');
        report.push({ viewport, width, axis, paints });
    }
    const crossOrigin = await page.evaluate(async story => {
        const e = window.topStoryReview.entries[0];
        e.img.src = 'http://publisher.invalid/photo.webp'; await e.img.decode();
        e.state.source = e.img.src; e.state.blend.story = story;
        delete e.card.dataset.edgeBleed;
        window.topStoryReview.update();
        const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
        ctx.drawImage(e.img, 0, 0);
        try { ctx.getImageData(0,0,1,1); return false; } catch (error) { return error.name === 'SecurityError'; }
    }, manifest.samples[0].analysis);
    assert.equal(crossOrigin, true, 'publisher source actually blocks canvas sampling');
    await page.waitForFunction(() => window.topStoryReview.entries[0].card.dataset.edgeBleed === 'left');
    await page.evaluate(async () => {
        const e = window.topStoryReview.entries[0];
        const { applyTopStoryImage } = await import('/public/top-story-card/blend/runtime.js?v=20261006_requirements_2');
        applyTopStoryImage(e.img, e.state, { isDefault: true });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.evaluate(() => window.topStoryReview.entries[0].card.dataset.edgeBleed), undefined,
        'default artwork retains its neutral material');
    assert.deepEqual(errors, []);
    await fs.writeFile(`${output}/measurements.json`, JSON.stringify(report, null, 2));
    console.log('PASS: six images across two mobile widths and desktop; edge gradients painted; geometry and focus unchanged; no browser errors');
} finally { await browser.close(); server.close(); }
