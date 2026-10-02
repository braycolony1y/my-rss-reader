// Verify the approved envelope on real Alpine cards and captured reader images.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
const base = process.env.READER_URL || 'http://127.0.0.1:3000';
const output = process.env.CARD_OUTPUT || '/tmp/top-story-photo-review';
await fs.mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const selectors = ['.article-card-heading', '.article-metadata', 'h2', '.article-card-heading p', '.story-freshness', '.story-key-facts', '.story-analysis-shell', '.story-analysis-tabs', '.story-analysis-body', '.story-coverage-orbs', '.story-rank'];
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function decoded(card) {
    await card.evaluate(async el => Promise.all([...el.querySelectorAll('.thumbnail-img,.thumbnail-soft')].map(img => img.decode().catch(() => {}))));
}
async function bounds(card) {
    return card.evaluate((el, selectors) => {
        const cr = el.getBoundingClientRect();
        return Object.fromEntries(selectors.map(s => {
            const node = [...el.querySelectorAll(s)].find(n => n.getBoundingClientRect().width);
            const r = node?.getBoundingClientRect();
            return [s, r && { x: r.x - cr.x, y: r.y - cr.y, width: r.width, height: r.height }];
        }));
    }, selectors);
}
async function verify(page, card, label, width, { screenshot = false } = {}) {
    await card.scrollIntoView(); await decoded(card); await frames(page);
    const after = await bounds(card);
    await card.evaluate(el => { el.dataset.reviewBlend = el.dataset.storyBlend; delete el.dataset.storyBlend; });
    const before = await bounds(card);
    await card.evaluate(el => { el.dataset.storyBlend = el.dataset.reviewBlend; delete el.dataset.reviewBlend; });
    await frames(page);
    const layoutDifference = Math.max(0, ...Object.keys(before).flatMap(k => Object.keys(before[k] || {}).map(p => Math.abs(before[k][p] - after[k][p]))));
    assert.ok(layoutDifference <= 1, `${label}/${width}: content moved`);
    const values = await card.evaluate(el => {
        const img = el.querySelector('.thumbnail-img'), soft = el.querySelector('.thumbnail-soft');
        const cr = el.getBoundingClientRect(), ir = img.getBoundingClientRect(), css = getComputedStyle(img);
        const icons = [...el.querySelectorAll('.article-metadata img,.story-coverage-orb img')].filter(i => i.getBoundingClientRect().width);
        return {
            width: el.clientWidth, height: el.clientHeight,
            photo: { left: ir.x - cr.x - el.clientLeft, top: ir.y - cr.y - el.clientTop, width: ir.width, height: ir.height,
                naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, objectFit: css.objectFit,
                opacity: css.opacity, filter: css.filter, mask: css.maskImage, ratio: css.aspectRatio },
            soft: { opacity: getComputedStyle(soft).opacity, filter: getComputedStyle(soft).filter },
            ambient: { opacity: getComputedStyle(el.querySelector('.card-ambient')).opacity, filter: getComputedStyle(el.querySelector('.card-ambient')).filter },
            rank: getComputedStyle(el.querySelector('.story-rank')).position,
            coverage: getComputedStyle(el.querySelector('.story-coverage-orbs')).position,
            clipping: getComputedStyle(el).overflow, radius: getComputedStyle(el).borderRadius,
            veil: getComputedStyle(el, '::after').backgroundImage,
            icons: icons.map(i => ({ width: i.getBoundingClientRect().width, height: i.getBoundingClientRect().height, mask: getComputedStyle(i).maskImage, filter: getComputedStyle(i).filter })),
            pageOverflow: document.documentElement.scrollWidth > innerWidth,
            placement: el.dataset.storyHeroPlacement, source: img.currentSrc
        };
    });
    assert.equal(values.rank, 'absolute'); assert.equal(values.coverage, 'absolute'); assert.equal(values.clipping, 'hidden');
    assert.equal(values.photo.objectFit, 'contain');
    assert.ok(Math.abs(values.photo.width / values.photo.height - values.photo.naturalWidth / values.photo.naturalHeight) < .002);
    assert.ok(values.icons.every(i => i.width <= 29 && i.height <= 29 && i.mask === 'none' && i.filter === 'none'));
    if (values.width >= 640 && values.placement === 'editorial') {
        assert.ok(Math.abs(values.photo.left / values.width - .48) < .001);
        assert.ok(Math.abs(values.photo.width / values.width - .66) < .001);
        assert.ok(Math.abs((values.photo.left + values.photo.width) / values.width - 1.14) < .001);
        assert.equal(values.veil, 'none'); assert.equal(values.photo.filter, 'none');
        assert.ok(values.photo.mask.startsWith('radial-gradient'), 'A single curved envelope owns both edges');
        assert.equal(values.soft.opacity, '.1'.replace(/^\./, '0.')); assert.equal(values.soft.filter, 'blur(14px)');
        assert.equal(values.ambient.opacity, '0.15'); assert.ok(values.ambient.filter.includes('blur(70px)'));
    } else if (values.width < 640) {
        assert.equal(values.placement, 'stacked'); assert.equal(values.pageOverflow, false);
    }
    if (screenshot) await card.screenshot({ path: path.join(output, `${label}-${width}.png`) });
    return { label, viewport: width, layoutDifference, ...values };
}
async function crispPixels(card, values) {
    const original = await card.screenshot();
    await card.$eval('.thumbnail-img', img => { img.style.setProperty('mask-image', 'none', 'important'); });
    const reference = await card.screenshot();
    await card.$eval('.thumbnail-img', img => img.style.removeProperty('mask-image'));
    const [a,b] = await Promise.all([original,reference].map(buffer => sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject:true })));
    const p = values.photo; let delta=0, count=0;
    for (let y=Math.ceil(p.height*.22)+1; y<Math.floor(p.height*.42); y++)
        for (let x=Math.ceil(p.left+p.width*.45)+1; x<Math.min(a.info.width-2,Math.floor(p.left+p.width*.75)); x++)
            for(let c=0;c<3;c++){const i=(y*a.info.width+x)*3+c;delta+=Math.abs(a.data[i]-b.data[i]);count++;}
    const mean=delta/count;
    assert.ok(count > 1000 && mean < 1, `Crisp source pixels differ from the unmasked photo by ${mean}`);
    return mean;
}
try {
    const page = await browser.newPage(), errors = [];
    const report = process.env.PHOTO_REVIEW_RESUME ? JSON.parse(await fs.readFile(path.join(output,'photo-progress.json'),'utf8')) : [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setCookie({ name:'auth', value:'true', url:base });
    await page.evaluateOnNewDocument(() => localStorage.setItem('theme','glass-light'));
    await page.setViewport({ width:1450, height:1100, deviceScaleFactor:1 });
    console.log('Loading the real reader');
    await page.goto(base+'/#smart/news_vietnam', { waitUntil:'domcontentloaded', timeout:60000 });
    await page.waitForFunction(() => window.Alpine?.$data(document.body)?.feeds?.length, { timeout:60000 });
    await page.evaluate(() => {
        const b = a => [...document.querySelectorAll('button')].find(e => e.getAttribute('@click') === a);
        b("setSmartSection('news')").click(); b("setFilter('smart', 'news_vietnam')").click();
    });
    await page.waitForSelector('.article-card[data-image-layout="top"] h2', { timeout:90000 });
    console.log('Reader cards loaded');
    const live = [];
    for (const [label, title] of [['durian','sầu riêng'],['ship','Hải Sâm']]) {
        const cards = await page.$$('.article-card[data-image-layout="top"]');
        let card;
        for (const candidate of cards) if ((await candidate.$eval('h2',el=>el.textContent)).includes(title)) {card=candidate;break;}
        assert.ok(card, `Real ${label} story is available`); live.push({label,card});
        await card.evaluate(el => {el.style.maxWidth='none';el.dataset.photoReview='true';});
        await card.scrollIntoView();
        await page.waitForFunction(el=>el.querySelector('.thumbnail-img').dataset.focusState==='ready', {timeout:60000}, card);
        console.log('Checking real '+label+' card');
        for (const width of [320,375,390,430,640,800,844,1100]) {
            if(report.some(r=>r.label===label && r.viewport===width))continue;
            await page.setViewport({width:width<640?width:1450,height:1100,deviceScaleFactor:1});
            await card.evaluate((el,w)=>el.style.width=w+'px',width<640?width-24:width); await frames(page);
            const values=await verify(page,card,label,width,{screenshot:[390,800].includes(width)});
            if(width===800) values.crispPixelMeanDelta=await crispPixels(card,values);
            report.push(values); await fs.writeFile(path.join(output,'photo-progress.json'),JSON.stringify(report,null,2)); console.log(label+'/'+width+' passed');
        }
    }
    const card=live[0].card;
    await page.setViewport({width:1450,height:1100});await card.evaluate(el=>el.style.width='800px');await card.scrollIntoView();await frames(page);
    const copy=()=>card.$eval('.story-analysis-text',el=>el.textContent.trim());
    const original=await copy();await card.$eval('.story-analysis-next',el=>el.click());assert.notEqual(await copy(),original);
    await card.$eval('.story-analysis-tabs > button:first-child',el=>el.click());assert.equal(await copy(),original);
    await card.$eval('.story-analysis-more-tab',el=>el.click());
    await page.waitForFunction(el=>el.querySelector('.story-more-analysis-rail').getBoundingClientRect().height>0,{timeout:5000},card);
    await card.$eval('.story-coverage-more',el=>el.click());
    await page.waitForFunction(el=>[...el.querySelectorAll('.story-coverage-expanded')].some(node=>node.getBoundingClientRect().height>0),{timeout:5000},card);
    assert.ok(await card.$eval('.story-coverage-orb[href]',el=>/^https?:/.test(el.href)));
    await card.$eval('.story-coverage-more',el=>el.click());await card.$eval('.story-analysis-tabs > button:first-child',el=>el.click());
    const paint=()=>card.$eval('.thumbnail-img',el=>({opacity:getComputedStyle(el).opacity,filter:getComputedStyle(el).filter,src:el.src}));
    const before=await paint();await card.evaluate(el=>el.classList.add('is-read'));assert.deepEqual(await paint(),before);
    console.log('Live interactions passed');
    // The flag and portrait fixtures are captured real reader photographs.
    await page.goto(base+'/public/top-story-card/demo/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.documentElement.dataset.reviewReady==='true');
    await page.addStyleTag({content:'.review-controls { display: none !important; }'});
    for(const width of [320,375,390,430,640,800,844,1100]) {
        await page.setViewport({width:width<640?width+24:2300,height:1100,deviceScaleFactor:1});
        await page.evaluate(w=>{const select=document.querySelector('#width');if(![...select.options].some(o=>o.value===String(w)))select.add(new Option(w,w));select.value=w;window.topStoryReview.update()},width);
        await frames(page);
        console.log('Checking captured reader cards at '+width);
        for(const label of ['S3']) {
            const fixture=await page.$(`[data-fixture="${label}"]`);
            const values=await verify(page,fixture,label,width,{screenshot:label==='S3'&&[390,800].includes(width)});
            if(width===800 && ['S1','S2','S3','S4','S5'].includes(label)) values.crispPixelMeanDelta=await crispPixels(fixture,values);
            report.push(values); await fs.writeFile(path.join(output,'photo-progress.json'),JSON.stringify(report,null,2));
        }
    }
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(output,'photo-measurements.json'),JSON.stringify({report,errors,interactions:['tabs','next analysis','more analysis','coverage expansion','publisher links','read state']},null,2));
    console.log(JSON.stringify({cards:report.length,maxLayoutDifference:Math.max(...report.map(r=>r.layoutDifference)),maxCrispPixelDelta:Math.max(...report.map(r=>r.crispPixelMeanDelta||0)),errors},null,2));
} finally {await browser.close();}
