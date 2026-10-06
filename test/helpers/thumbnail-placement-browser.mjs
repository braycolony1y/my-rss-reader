import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { startFixtureServer } from './frontend-refactor/server.js';
import { verifyThumbnailClarity } from './thumbnail-photo-clarity.js';

const output = process.env.CARD_OUTPUT || '/tmp/thumbnail-placement-regression';
await fs.mkdir(output, { recursive: true });
const server = await startFixtureServer();
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1600, height: 1100 });
    // Serve the existing captured production card through the fixture server.
    // Its HTML page has no MIME mapping there, so retain it with an explicit response.
    await page.setRequestInterception(true);
    page.on('request', async request => {
        if (new URL(request.url()).pathname === '/public/top-story-card/demo/index.html') {
            await request.respond({ status: 200, contentType: 'text/html',
                body: await fs.readFile(new URL('../../public/top-story-card/demo/index.html', import.meta.url)) });
        } else await request.continue();
    });
    await page.goto(server.url + '/public/top-story-card/demo/index.html');
    await page.waitForFunction(() => window.topStoryReview?.entries[0].img.complete);
    const html = await fs.readFile(new URL('../../index.html', import.meta.url), 'utf8');
    const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match => match[1]);
    await page.evaluate(async styles => {
        document.querySelectorAll('link[rel="stylesheet"]').forEach(node => node.remove());
        await Promise.all(styles.map(href => new Promise((resolve, reject) => {
            const node = document.createElement('link'); node.rel = 'stylesheet'; node.href = href;
            node.onload = resolve; node.onerror = reject; document.head.append(node);
        })));
    }, styles);
    await page.addStyleTag({ content: '.review-controls,.review-caption{display:none} body{height:auto!important;overflow:auto!important} #scroll-container{display:block!important;padding:12px!important;height:auto!important;overflow:visible!important}' });
    await page.evaluate(() => window.topStoryReview.entries.splice(1).forEach(entry => entry.card.closest('section').remove()));
    // Exercise the actual production fact markup, with readable fixture content.
    const component = await fs.readFile(new URL('../../public/components/article-card.html', import.meta.url), 'utf8');
    await page.evaluate(component => {
        const root = document.createElement('template'); root.innerHTML = component;
        const articleTemplate = root.content.querySelector('template').content;
        const source = articleTemplate.querySelector('.story-key-facts template').content.querySelector('.story-key-fact');
        const facts = document.querySelector('.story-key-facts'); facts.style.display = '';
        for (const [value, label] of [['18%', 'Growth'], ['3', 'Publishers'], ['2026', 'Year']]) {
            const fact = source.cloneNode(true);
            fact.querySelector('strong').textContent = value;
            fact.querySelector('.story-key-fact-copy > span').textContent = label;
            facts.append(fact);
        }
    }, component);
    const report = await page.evaluate(async () => {
        const entry = window.topStoryReview.entries[0], card = entry.card;
        card.classList.remove('is-read');
        const original = structuredClone(entry.state.blend.story);
        const { applyTopStoryImage } = await import('/public/top-story-card/blend/runtime.js?v=20261004_fill_1');
        const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const box = node => {
            const rect = node.getBoundingClientRect();
            return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
        };
        const content = () => Object.fromEntries(['.article-card-heading', '.article-metadata', 'h2', '.article-card-heading p', '.story-key-facts', '.story-analysis-shell']
            .map(selector => [selector, box(card.querySelector(selector))]));
        const snapshot = () => {
            const hero = card.querySelector('.article-card-image'), soft = card.querySelector('.thumbnail-soft');
            const imgCSS = getComputedStyle(entry.img), softCSS = getComputedStyle(soft), overlay = getComputedStyle(card, '::after');
            return { card: box(card), innerWidth: card.clientWidth, innerLeft: card.getBoundingClientRect().left + card.clientLeft,
                innerTop: card.getBoundingClientRect().top + card.clientTop,
                layers: [hero, card.querySelector('.thumbnail-plate'), entry.img, soft].map(box),
                content: content(), focus: imgCSS.objectPosition, softFocus: softCSS.objectPosition,
                fit: imgCSS.objectFit, mask: imgCSS.maskImage, heroMask: getComputedStyle(hero).maskImage,
                transform: imgCSS.transform, photoPaint: { opacity: imgCSS.opacity, filter: imgCSS.filter, source: entry.img.currentSrc,
                    background: getComputedStyle(card).backgroundColor, softOpacity: softCSS.opacity, softFilter: softCSS.filter },
                titleColor: getComputedStyle(card.querySelector('h2')).color,
                extent: card.dataset.smartHeroExtent, placement: card.dataset.storyHeroPlacement,
                edge: { state: card.dataset.edgeColor, content: overlay.content, background: overlay.backgroundImage,
                    gradient: card.style.getPropertyValue('--edge-bottom-gradient'), mask: overlay.maskImage },
                icons: [...card.querySelectorAll('.article-metadata img,.story-coverage-orb img')].map(node =>
                    ({ width: node.getBoundingClientRect().width, mask: getComputedStyle(node).maskImage, filter: getComputedStyle(node).filter })) };
        };
        const apply = async analysis => {
            entry.state.blend.story = analysis; applyTopStoryImage(entry.img, entry.state);
            await tick(); await tick(); return snapshot();
        };
        const results = [];
        for (const width of [642, 740, 1100]) {
            const control = document.querySelector('#width');
            if (![...control.options].some(option => Number(option.value) === width)) control.add(new Option(width, width));
            control.value = width; card.style.width = width + 'px';
            for (const mode of ['top', 'normal', 'classic']) {
                card.dataset.imageLayout = mode === 'top' ? 'top' : 'standard';
                card.dataset.smartClusterId = mode === 'top' ? 'fixture' : '';
                card.classList.toggle('is-standard-card', mode === 'normal');
                card.classList.toggle('is-smart-classic-card', mode === 'classic');
                card.querySelector('.story-rank').style.display = mode === 'top' ? '' : 'none';
                for (const analysis of [false, true]) {
                    card.querySelector('.article-card-panel').style.display = analysis ? '' : 'none';
                    const ordinary = await apply({ ...original, hasTransparency: false });
                    const alpha = await apply({ ...original, hasTransparency: true });
                    card.classList.add('is-read'); await tick(); const read = snapshot();
                    card.classList.remove('is-read'); await tick();
                    results.push({ width, mode, analysis, ordinary, alpha, read });
                }
            }
        }
        // Geometry must follow asynchronous panel changes without changing x, y,
        // width or focus. Use the existing lifecycle, with no extra observer.
        const before = snapshot();
        card.querySelector('.story-analysis-shell').style.marginTop = '37px';
        const moved = await apply(entry.state.blend.story);
        card.querySelector('.story-analysis-shell').style.marginTop = '';
        await apply(entry.state.blend.story);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const rgb = color => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
        const facts = [...card.querySelectorAll('.story-key-fact')].filter(node => node.getBoundingClientRect().width).map(node => ({
            backgroundCSS: getComputedStyle(node).backgroundColor,
            background: rgb(getComputedStyle(node).backgroundColor),
            text: [...node.querySelectorAll('.story-key-fact-copy strong,.story-key-fact-copy > span')].map(text => rgb(getComputedStyle(text).color))
        }));
        const sheet = [...document.styleSheets].find(sheet => sheet.href?.includes('/shared-card-style/card.css'));
        const unaffected = async () => {
            const enabled = snapshot(); sheet.disabled = true; const disabled = snapshot(); sheet.disabled = false;
            return { enabled, disabled };
        };
        card.dataset.imageLayout = 'standard'; document.body.className = 'theme-glass-dark';
        await apply(original); const dark = await unaffected();
        document.body.className = 'theme-glass-light'; await apply({ ...original, hasTransparency: true });
        window.thumbnailPlacementRegression = { card, snapshot, unaffected, entry };
        return { results, before, moved, facts, dark, focal: original.focal };
    });
    await fs.writeFile(output + '/measurements.json', JSON.stringify(report, null, 2));
    for (const { width, mode, analysis, ordinary, alpha, read } of report.results) {
        const label = `${width}/${mode}/${analysis ? 'analysis' : 'bottom'}`;
        assert.equal(alpha.placement, 'editorial', label); assert.equal(alpha.fit, 'cover');
        const target = analysis ? alpha.content['.story-analysis-shell'].top + 18 : alpha.card.bottom;
        for (const layer of alpha.layers) {
            assert.ok(Math.abs(layer.bottom - target) < .1, `${label}: every photo layer reaches the required bottom`);
            assert.ok(Math.abs(layer.top - alpha.innerTop) < .1, `${label}: every photo layer starts at the card top`);
        }
        assert.ok(Math.abs((alpha.layers[2].left - alpha.innerLeft) / alpha.innerWidth - .48) < .001, `${label}: approved left anchor`);
        assert.ok(Math.abs(alpha.layers[2].width / alpha.innerWidth - .66) < .001, `${label}: independent width`);
        assert.equal(alpha.transform, 'none');
        assert.deepEqual(alpha.layers, ordinary.layers, `${label}: alpha pixels cannot change framing`);
        assert.deepEqual(alpha.content, ordinary.content, `${label}: text, facts and analysis stay fixed`);
        assert.equal(alpha.focus, ordinary.focus); assert.equal(alpha.softFocus, alpha.focus);
        const focus = alpha.focus.split(' ').map(parseFloat);
        assert.ok(Math.abs(focus[0] - report.focal.x * 100) < .011 && Math.abs(focus[1] - report.focal.y * 100) < .011);
        assert.ok(alpha.mask.startsWith('radial-gradient') && !alpha.mask.includes('data:image/svg+xml'), `${label}: retain only the left feather`);
        if (analysis) {
            assert.equal(alpha.extent, 'analysis'); assert.ok(alpha.heroMask.includes('18px'));
            assert.equal(alpha.edge.state, 'ready'); assert.notEqual(alpha.edge.content, 'none');
            assert.ok(alpha.edge.gradient.includes('linear-gradient') && alpha.edge.background.includes('linear-gradient'), `${label}: sampled color is actually painted`);
        } else { assert.equal(alpha.extent, 'card-bottom-no-feather'); assert.equal(alpha.heroMask, 'none'); }
        assert.deepEqual(read.layers, alpha.layers); assert.deepEqual(read.photoPaint, alpha.photoPaint, `${label}: read state changes text only`);
        assert.notEqual(read.titleColor, alpha.titleColor);
        assert.ok(alpha.icons.every(icon => icon.width <= 30 && icon.mask === 'none' && icon.filter === 'none'));
    }
    for (const [index, layer] of report.moved.layers.entries()) {
        assert.ok(Math.abs(layer.bottom - report.moved.content['.story-analysis-shell'].top - 18) < .1);
        for (const key of ['left', 'top', 'width']) assert.equal(layer[key], report.before.layers[index][key]);
    }
    assert.equal(report.moved.focus, report.before.focus);
    const luminance = rgb => rgb.slice(0, 3).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; })
        .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    assert.ok(report.facts.length, 'The preview contains real fact cards');
    for (const fact of report.facts) for (const text of fact.text) {
        const bg = fact.background.slice(0, 3).map(value => value * fact.background[3] / 255);
        const contrast = (luminance(bg) + .05) / (luminance(text) + .05);
        assert.ok(contrast >= 4.5, `Fact text stays readable over a dark photo: ${contrast}`);
    }
    assert.deepEqual(report.dark.enabled, report.dark.disabled);
    report.clarity = await verifyThumbnailClarity(page, await page.$('.article-card'));
    await (await page.$('.article-card')).screenshot({ path: output + '/desktop-with-analysis.png' });
    await page.setViewport({ width: 390, height: 1100 });
    await page.evaluate(() => { document.querySelector('#width').value = '340'; window.topStoryReview.update(); });
    await page.waitForFunction(() => document.querySelector('.article-card').dataset.mobileClean === '1');
    report.mobile = await page.evaluate(() => window.thumbnailPlacementRegression.unaffected());
    assert.deepEqual(report.mobile.enabled, report.mobile.disabled);
    assert.deepEqual(errors, []);
    await fs.writeFile(output + '/measurements.json', JSON.stringify(report, null, 2));
    console.log('THUMBNAIL_REQUIREMENTS_OK: 18 desktop cases, alpha/ordinary framing, top/bottom fill, analysis overlap, sampled color painting, unchanged content/focus, sharp pixels, read text only, fact contrast, icons, responsive panel changes and mobile/theme isolation');
} finally { await browser.close(); server.close(); }
