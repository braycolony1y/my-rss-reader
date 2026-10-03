import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
const root = process.cwd();
const out = process.env.CARD_OUTPUT || '/tmp/hero-extent-review';
await fs.mkdir(out, { recursive: true });
const server = http.createServer(async (req, res) => {
    try {
        const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
        res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream');
        res.end(await fs.readFile(file));
    } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 1100 });
    await page.goto(`http://127.0.0.1:${server.address().port}/public/top-story-card/demo/index.html`);
    await page.waitForFunction(() => window.topStoryReview?.entries[0].img.complete);
    console.log('Preview loaded');
    await page.addStyleTag({ url: '/public/top-story-card/hero-extent.css' });
    const results = await page.evaluate(async () => {
        const { scheduleHeroExtent } = await import('/public/top-story-card/hero-extent.js?v=20261003_1');
        const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const entry = window.topStoryReview.entries[0], card = entry.card;
        card.dataset.smartClusterId = 'fixture-smart-top';
        const sheet = [...document.styleSheets].find(s => s.href?.includes('hero-extent.css'));
        const read = () => {
            const rect = n => { const r = n.getBoundingClientRect(); return { left:r.left, top:r.top, width:r.width, height:r.height, bottom:r.bottom }; };
            return {
                boxes: Object.fromEntries(['.article-card-image','.thumbnail-plate','.thumbnail-img','.thumbnail-soft','.story-analysis-shell','.article-card-heading','.story-key-facts'].map(s => [s, rect(card.querySelector(s))])),
                card: rect(card), focus: getComputedStyle(entry.img).objectPosition,
                softFocus: getComputedStyle(card.querySelector('.thumbnail-soft')).objectPosition,
                focal: [card.style.getPropertyValue('--focal-x'),card.style.getPropertyValue('--focal-y')],
                mask: getComputedStyle(card.querySelector('.article-card-image')).maskImage,
                imageMask: getComputedStyle(entry.img).maskImage, mode: card.dataset.smartHeroExtent
            };
        };
        sheet.disabled = true; await tick(); const before = read();
        sheet.disabled = false; scheduleHeroExtent(card); await tick(); const analysis = read();
        const panel = card.querySelector('.story-analysis-shell'); panel.style.display = 'none';
        scheduleHeroExtent(card); await tick(); const absent = read();
        panel.style.display = ''; scheduleHeroExtent(card); await tick();
        panel.style.marginTop = '37px'; scheduleHeroExtent(card); await tick(); const moved = read();
        panel.style.marginTop = ''; scheduleHeroExtent(card); await tick();
        return { before, analysis, absent, moved };
    });
    for (const key of ['analysis','absent','moved']) {
        const r = results[key], target = key === 'absent' ? r.card.bottom : r.boxes['.story-analysis-shell'].top + 18;
        for (const s of ['.article-card-image','.thumbnail-plate','.thumbnail-img','.thumbnail-soft']) {
            assert.ok(Math.abs(r.boxes[s].bottom - target) < .1, `${key} ${s} bottom`);
            for (const p of ['left','top','width']) assert.ok(Math.abs(r.boxes[s][p] - results.before.boxes[s][p]) < .1, `${key} ${s} ${p}`);
        }
        assert.equal(r.focus, results.before.focus); assert.equal(r.softFocus, r.focus);
        assert.deepEqual(r.focal, results.before.focal);
    }
    for (const s of ['.story-analysis-shell','.article-card-heading','.story-key-facts']) assert.deepEqual(results.analysis.boxes[s], results.before.boxes[s]);
    assert.equal(results.absent.mask, 'none');
    assert.ok(results.analysis.mask.includes('18px'));
    assert.ok(!results.analysis.imageMask.includes('bottom'));
    const card = await page.$('.article-card');
    await card.screenshot({ path: path.join(out, 'with-analysis.png') });
    await page.evaluate(async () => { const c=window.topStoryReview.entries[0].card; c.querySelector('.story-analysis-shell').style.display='none'; (await import('/public/top-story-card/hero-extent.js?v=20261003_1')).scheduleHeroExtent(c); });
    await new Promise(r => setTimeout(r, 100));
    await card.screenshot({ path: path.join(out, 'without-analysis.png') });
    for (const width of [320,375,390,430,767,844,1440]) {
        await page.setViewport({ width, height: 1100 });
        const unchanged = await page.evaluate(async width => {
            const {scheduleHeroExtent} = await import('/public/top-story-card/hero-extent.js?v=20261003_1');
            const c=window.topStoryReview.entries[0].card;
            c.style.width=`${Math.min(width-24,740)}px`;
            if (width >= 768) c.classList.add('is-smart-classic-card');
            scheduleHeroExtent(c); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
            const snapshot = () => [...c.querySelectorAll('.article-card-image,.thumbnail-plate,.thumbnail-img,.thumbnail-soft')].map(n => {
                const r=n.getBoundingClientRect(),s=getComputedStyle(n);
                return [r.x,r.y,r.width,r.height,s.maskImage,s.objectFit,s.objectPosition];
            });
            const enabled=snapshot();
            const sheet=[...document.styleSheets].find(s=>s.href?.includes('hero-extent.css'));
            sheet.disabled=true; const disabled=snapshot(); sheet.disabled=false;
            return !c.dataset.smartHeroExtent && JSON.stringify(enabled)===JSON.stringify(disabled);
        }, width);
        assert.ok(unchanged, `outside scope ${width}`);
    }
    assert.ok(await page.evaluate(async () => {
        const c=window.topStoryReview.entries[0].card;
        c.classList.remove('is-smart-classic-card'); c.classList.add('is-standard-card'); c.dataset.imageLayout='standard';
        (await import('/public/top-story-card/hero-extent.js?v=20261003_1')).scheduleHeroExtent(c);
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        return !c.dataset.smartHeroExtent;
    }), 'standard cards excluded');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(out,'measurements.json'), JSON.stringify(results,null,2));
    console.log('PASS: live DOM edges, fixed horizontal boxes, focus, panel/fact geometry, async panel changes, mobile/classic exclusions.');
    console.log(out);
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
