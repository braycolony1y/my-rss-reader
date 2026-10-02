// Exercise the actual Alpine card, reader image path, and existing controls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
const base = process.env.READER_URL || 'http://127.0.0.1:3000';
const output = process.env.CARD_OUTPUT || '/tmp/smart-card-review';
await fs.mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setCookie({ name: 'auth', value: 'true', url: base });
    await page.evaluateOnNewDocument(() => localStorage.setItem('theme', 'glass-light'));
    await page.setViewport({ width: 1450, height: 1100, deviceScaleFactor: 1 });
    await page.goto(`${base}/#smart/news_vietnam`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.Alpine?.$data(document.body)?.feeds?.length, { timeout:60000 });
    // A fresh browser can restore the user's shared last-opened category.
    // Use the real News/Vietnam controls after restoration rather than mock
    // article data or changing the reader's navigation implementation.
    await page.evaluate(() => {
        const button = action => [...document.querySelectorAll('button')].find(el => el.getAttribute('@click') === action);
        button("setSmartSection('news')").click();
        button("setFilter('smart', 'news_vietnam')").click();
    });
    try {
        await page.waitForSelector('.article-card[data-image-layout="top"] h2', { timeout: 90000 });
    } catch (error) {
        await page.screenshot({ path:path.join(output, 'load-failure.png') });
        console.log(await page.evaluate(() => ({ url:location.href, body:document.body.innerText.slice(0,1500) })));
        console.log({ errors });
        throw error;
    }
    let card;
    for (const candidate of await page.$$('.article-card[data-image-layout="top"]')) if ((await candidate.$eval('h2', el => el.textContent)).includes('Công tác tư tưởng')) { card = candidate; break; }
    assert.ok(card, 'The linked story is present in the real reader');
    await card.evaluate(el => { el.dataset.liveReview = 'true'; el.style.maxWidth = 'none'; });
    await card.scrollIntoView();
    await page.waitForFunction(() => document.querySelector('[data-live-review]').dataset.storyBlend === 'ready', { timeout: 60000 });
    await page.evaluate(async () => {
        const src = [...document.scripts].find(s => s.src.includes('/public/image-focus.js')).src;
        const code = await (await fetch(src)).text();
        const runtime = code.match(/from ['"](.+blend\/runtime\.js[^'"]*)/)[1];
        window.liveBlendState = (await import(new URL(runtime, src).href)).storyBlendState;
    });
    const report = [];
    for (const width of [645, 800, 1100, 390, 320]) {
        const mobile = width < 640;
        await page.setViewport({ width: mobile ? width : 1450, height: 1100, deviceScaleFactor: 1 });
        await card.evaluate((el, size) => { el.style.width = `${size}px`; }, mobile ? width - 24 : width);
        await card.scrollIntoView();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const dimensions = () => card.evaluate(el => {
            const cr = el.getBoundingClientRect();
            return Object.fromEntries(['.article-card-heading', '.article-metadata', 'h2', '.article-card-heading p', '.story-analysis-shell', '.story-analysis-tabs', '.story-analysis-body', '.story-analysis-next', '.story-coverage-orbs', '.story-rank'].map(selector => {
                const r = el.querySelector(selector).getBoundingClientRect();
                return [selector, { x:r.x-cr.x, y:r.y-cr.y, width:r.width, height:r.height }];
            }));
        });
        const after = await dimensions();
        await card.evaluate(el => { el.dataset.savedBlend = el.dataset.storyBlend; delete el.dataset.storyBlend; });
        const before = await dimensions();
        await card.evaluate(el => { el.dataset.storyBlend = el.dataset.savedBlend; delete el.dataset.savedBlend; });
        const layoutDifference = Math.max(...Object.keys(before).flatMap(k => Object.keys(before[k]).map(p => Math.abs(before[k][p] - after[k][p]))));
        const values = await card.evaluate(el => {
            const image = el.querySelector('.article-card-image'), soft = el.querySelector('.thumbnail-soft');
            const style = node => getComputedStyle(node), state = window.liveBlendState(el);
            const cr=el.getBoundingClientRect(),orbRects=[...el.querySelectorAll('.story-coverage-orb')].map(orb=>orb.getBoundingClientRect());
            return { cardHeight:el.clientHeight, titleWeight:style(el.querySelector('h2')).fontWeight,
                titleSize:parseFloat(style(el.querySelector('h2')).fontSize),
                summarySize:parseFloat(style(el.querySelector('.article-card-heading p')).fontSize),
                bodySize:parseFloat(style(el.querySelector('.story-analysis-text')).fontSize),
                clamp:style(el.querySelector('.article-card-heading p')).webkitLineClamp,
                blend:el.dataset.storyBlend, decoded:soft.complete && soft.naturalWidth > 0, loading:soft.loading,
                ambient:style(el.querySelector('.card-ambient')).display, imageMask:style(image).maskImage,
                panel:style(el.querySelector('.story-analysis-shell')).backdropFilter,
                pageOverflow:document.documentElement.scrollWidth > innerWidth,
                textOverflow:el.querySelector('.story-analysis-text').scrollWidth > el.querySelector('.story-analysis-text').clientWidth,
                objectFit:style(soft).objectFit, transform:style(soft).transform,
                sourceRatio:state.analysis.w/state.analysis.h, imageRatio:parseFloat(style(soft).width)/parseFloat(style(soft).height),
                subjectMask:el.style.getPropertyValue('--subject-scrim-mask'),
                overlayMask:getComputedStyle(el,'::after').maskImage,
                avatarsClipped:orbRects.some(r=>r.left<cr.left+1 || r.right>cr.right-1),
                geometry:state.geometry.p,
                mode:state.geometry.p.mode, placement:state.geometry.p.placement, hue:state.analysis.hMean, subject:state.geometry.p.subject };
        });
        assert.ok(layoutDifference <= 1, 'Palette application does not shift the revised content geometry');
        assert.equal(values.blend, 'ready'); assert.ok(values.decoded); assert.equal(values.loading, 'eager');
        assert.equal(values.titleWeight, '600'); assert.equal(values.clamp, mobile ? '5' : '3');
        assert.ok(values.titleSize <= 28 && values.titleSize >= values.summarySize*1.35);
        assert.ok(values.summarySize <= 16 && values.bodySize <= 15);
        assert.equal(values.objectFit,'contain'); assert.equal(values.transform,'none');
        assert.equal(values.geometry.scale,1);
        assert.ok(Math.abs(values.sourceRatio-values.imageRatio)<.001,'Photo retains its source aspect ratio');
        assert.ok(values.geometry.offsetY+values.geometry.imageH<=values.geometry.heroH+.01,'Complete photo fits vertically');
        assert.equal(values.subjectMask,''); assert.ok(!values.overlayMask.includes('radial-gradient'),'No face-shaped cutout');
        assert.equal(values.avatarsClipped,false,'The complete source stack and +N chip fit inside the card');
        assert.equal(values.ambient, 'block'); assert.equal(values.imageMask, 'none');
        assert.ok(values.panel.includes('blur(18px)')); assert.equal(values.textOverflow, false);
        assert.ok(values.hue > 45 && values.hue < 85, 'The real linked wood photo supplies the warm palette');
        if (mobile) { assert.equal(values.placement, 'stacked'); assert.equal(values.pageOverflow, false); }
        else assert.ok(values.subject.left >= .58 && values.subject.right <= 1.01, 'Face clears the text column');
        await card.screenshot({ path:path.join(output, `smart-top-story-${width}.png`) });
        report.push({ width, layoutDifference, ...values });
    }
    await page.setViewport({ width: 1100, height: 1100, deviceScaleFactor: 1 });
    await card.evaluate(el => { el.style.width = '800px'; });
    const copy = () => card.$eval('.story-analysis-text', el => el.textContent.trim());
    const firstText = await copy();
    await card.$eval('.story-analysis-next', el => el.click());
    assert.notEqual(await copy(), firstText, 'Next analysis changes the active section');
    await card.$eval('.story-analysis-tabs > button:first-child', el => el.click());
    assert.equal(await copy(), firstText, 'Why it matters returns to the existing content');
    await card.$eval('.story-analysis-more-tab', el => el.click());
    await page.waitForFunction(() => document.querySelector('[data-live-review] .story-more-analysis-rail').getBoundingClientRect().height > 0);
    await card.$eval('.story-coverage-more', el => el.click());
    await page.waitForFunction(() => document.querySelector('[data-live-review] .story-coverage-expanded').getBoundingClientRect().height > 0);
    assert.ok(await card.$eval('.story-coverage-orb[href]', el => /^https?:/.test(el.href)));
    await card.hover();
    assert.equal(await card.$eval('.article-actions-overlay', el => getComputedStyle(el).display !== 'none'), true);
    await card.$eval('.story-coverage-more', el => el.click());
    await card.$eval('.story-analysis-tabs > button:first-child', el => el.click());
    await page.mouse.move(0, 0);
    const paint = () => card.$eval('.thumbnail-soft', el => ({ opacity:getComputedStyle(el).opacity, filter:getComputedStyle(el).filter, src:el.src }));
    const originalPaint = await paint();
    await card.evaluate(el => el.classList.add('is-read'));
    assert.deepEqual(await paint(), originalPaint, 'Read state changes text without washing the photograph');
    await card.evaluate(el => el.classList.remove('is-read'));
    let twoFaceCard;
    for (const candidate of await page.$$('.article-card[data-image-layout="top"]')) if ((await candidate.$eval('h2', el => el.textContent)).includes('Nguyễn Thị Lan Anh')) { twoFaceCard=candidate; break; }
    assert.ok(twoFaceCard,'The two-face story from the supplied screenshot is present');
    await twoFaceCard.evaluate(el=>{el.dataset.proportionReview='true';el.style.maxWidth='none';});
    const proportions=[];
    for(const width of [800,560,390]) {
        await page.setViewport({width:width<420?width:1450,height:1100,deviceScaleFactor:1});
        await twoFaceCard.evaluate((el,width)=>{el.style.width=`${width}px`;},width<420?width-24:width);
        await twoFaceCard.scrollIntoView();
        await page.waitForFunction(()=>document.querySelector('[data-proportion-review]').dataset.storyBlend==='ready',{timeout:60000});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const value=await twoFaceCard.evaluate(el=>{
            const grid=el.querySelector('.story-key-facts').getBoundingClientRect(),shell=el.querySelector('.story-analysis-shell').getBoundingClientRect();
            const facts=[...el.querySelectorAll('.story-key-facts > .story-key-fact')].map(node=>{
                const r=node.getBoundingClientRect();return{x:r.x-grid.x,y:r.y-grid.y,width:r.width,height:r.height};
            });
            const state=window.liveBlendState(el);
            return{gridWidth:grid.width,shellWidth:shell.width,facts,geometry:state.geometry.p,
                titleSize:parseFloat(getComputedStyle(el.querySelector('h2')).fontSize),
                summarySize:parseFloat(getComputedStyle(el.querySelector('.article-card-heading p')).fontSize),
                subjectMask:el.style.getPropertyValue('--subject-scrim-mask')};
        });
        assert.equal(value.facts.length,2); assert.ok(Math.abs(value.gridWidth-value.shellWidth)<=1,'Stat row aligns with insight panel');
        assert.ok(Math.abs(value.facts[0].width-value.facts[1].width)<=1,'Two stat tiles have equal widths');
        if(width>=420) {
            assert.equal(value.facts[0].y,value.facts[1].y);
            assert.ok(Math.abs(value.facts[1].x+value.facts[1].width-value.gridWidth)<=1,'Two stats fill the row');
        } else assert.ok(value.facts[1].y>=value.facts[0].height,'Narrow screens stack stats');
        assert.equal(value.subjectMask,''); assert.equal(value.geometry.scale,1);
        await twoFaceCard.screenshot({path:path.join(output,`two-face-story-${width}.png`)});
        proportions.push({width,...value});
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'measurements.json'), JSON.stringify({ cards:report, proportions, interactions:'tabs, next, more analysis, +N, coverage links, hover toolbar, read state', errors }, null, 2));
    console.log(JSON.stringify(report.map(({width,layoutDifference,blend,mode,hue}) => ({width,layoutDifference,blend,mode,hue})), null, 2));
    console.log('Live linked cards, complete photo fit, text hierarchy, stat proportions, and existing interactions passed.');
} finally { await browser.close(); }
