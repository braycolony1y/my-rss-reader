import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const output = process.env.CARD_OUTPUT || '/tmp/mobile-top-review';
await fs.mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
 const page = await browser.newPage(), errors = [];
 page.on('pageerror', e => errors.push(e.message));
 await page.setViewport({ width: 1440, height: 1000 });
 await page.goto('http://127.0.0.1:3000/public/top-story-card/demo/');
 await page.waitForFunction(() => document.documentElement.dataset.reviewReady === 'true');
 await page.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))));
 const snapshot = () => page.$eval('.article-card', c => [c,...c.querySelectorAll('*')].map(n => { const s = getComputedStyle(n); return [n.tagName,n.className,...['width','height','position','background','maskImage','fontSize','padding','margin'].map(k => s[k])]; }));
 const baseline = await fs.readFile(output + '/baseline.json').then(JSON.parse).catch(() => null);
 if (!baseline) {
  const enabled = await snapshot();
  await page.$eval('link[href*="mobile-top-layout.css"]', n => { n.disabled = true; });
  assert.deepEqual(await snapshot(), enabled, 'mobile stylesheet has no desktop effects');
  await page.$eval('link[href*="mobile-top-layout.css"]', n => { n.disabled = false; });
 }
 if (baseline) assert.deepEqual(await snapshot(), baseline, 'desktop computed styles unchanged');
 await page.screenshot({ path: output + '/desktop-after.png' });
 // Use every production stylesheet, including legacy specificity rules.
 const html = await fs.readFile(new URL('../../index.html', import.meta.url), 'utf8');
 const hrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
 await page.evaluate(async hrefs => {
  document.querySelectorAll('link[rel="stylesheet"]').forEach(n => n.remove());
  await Promise.all(hrefs.map(href => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Stylesheet timed out: ${href}`)), 15000); const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = () => { clearTimeout(timer); resolve(); }; l.onerror = () => reject(new Error(`Stylesheet failed: ${href}`)); document.head.append(l); })));
 }, hrefs);
 await page.addStyleTag({ content: '.review-controls,.review-caption {display:none} body {height:auto!important;overflow:auto!important} #scroll-container {display:block!important;padding:12px!important;height:auto!important;overflow:visible!important} .review-sample{margin-bottom:20px}' });
 console.log('production styles loaded');
 const report = [];
 for (const width of [320,375,390,414,430,440,767]) {
  await page.setViewport({ width, height: 1100 });
  await page.evaluate(width => {
   const s = document.querySelector('#width'); if (![...s.options].some(o => +o.value === width - 24)) s.add(new Option(width - 24,width - 24));
   s.value = width - 24; window.topStoryReview.update();
  }, width);
  await page.waitForFunction(() => [...document.querySelectorAll('.article-card')].every(c => c.dataset.mobileClean === '1'));
  await new Promise(r => setTimeout(r, 250));
  const measurements = await page.$$eval('.article-card', cards => cards.map(c => {
   const b = n => {const r = n.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
   const hero = c.querySelector('.article-card-image'), img = c.querySelector('.thumbnail-img'), heading = c.querySelector('.article-card-heading'), meta = c.querySelector('.article-metadata'), rank=c.querySelector('.story-rank'), orbs=c.querySelector('.story-coverage-orbs');
   const items=[...meta.querySelectorAll('[data-mobile-meta-role="source"],[data-mobile-meta-role="item"]')].filter(n=>n.getClientRects().length);
   return {id:c.dataset.fixture,card:b(c),hero:b(hero),heading:b(heading),meta:b(meta),rank:b(rank),orbs:b(orbs),items:items.map(n=>({text:n.textContent.trim(),...b(n),surface:getComputedStyle(n).backgroundColor})),mask:getComputedStyle(img).maskImage,fit:getComputedStyle(img).objectFit,headingPosition:getComputedStyle(heading).position,lift:getComputedStyle(heading).marginTop,padding:getComputedStyle(heading).paddingTop,background:getComputedStyle(c).backgroundColor,base:getComputedStyle(c).getPropertyValue('--scrim-bottom'),overflow:c.scrollWidth>c.clientWidth,soft:getComputedStyle(c.querySelector('.thumbnail-soft')).display};
  }));
  for (const m of measurements) {
   assert.equal(m.headingPosition,'static'); assert.equal(m.fit,'cover'); assert.equal(m.soft,'none'); assert.ok(m.mask.includes('data:image/svg+xml'));
   assert.ok(Math.abs(m.hero.width/m.hero.height-16/9)<.01); assert.ok(Math.abs(m.hero.x-m.card.x-1)<1);
   assert.equal(m.lift,'-34px'); assert.equal(m.padding,'14px'); assert.equal(m.overflow,false);
   assert.ok(Math.abs(m.rank.y+m.rank.height/2-m.meta.y-m.meta.height/2)<.1);
   for (const i of m.items) { assert.ok(Math.abs(i.y+i.height/2-m.meta.y-m.meta.height/2)<1,`${width} ${i.text} center`); assert.equal(i.surface,'rgb(241, 245, 249)'); assert.ok(i.right <= m.meta.right + 1, `${width}: metadata item clipped`); }
   assert.ok(m.orbs.right<=m.card.right, 'coverage inside card');
  }
  report.push({width,measurements});
  await (await page.$('.article-card')).screenshot({path:`${output}/mobile-${width}.png`});
 }
 // Rerender classification, long names, and scope cleanup on a live node.
 await page.setViewport({width:390,height:1100});
 await page.evaluate(()=>{const row=document.querySelector('.article-metadata');row.querySelector('span span').textContent='VIETNAMPLUS INTERNATIONAL';const item=document.createElement('span');item.textContent='•';row.append(item);});
 await page.waitForFunction(() => getComputedStyle(document.querySelector('.article-metadata > span:last-child')).display === 'none');
 for(const cls of ['is-smart-classic-card','is-standard-card']) {
  await page.$eval('.article-card',(c,cls)=>c.classList.add(cls),cls);
  await page.waitForFunction(()=>!document.querySelector('.article-card').hasAttribute('data-mobile-clean'));
  assert.equal(await page.$eval('.article-card',c=>c.style.getPropertyValue('--direct-image-mask')),'');
  await page.$eval('.article-card',(c,cls)=>c.classList.remove(cls),cls);
  await page.waitForFunction(()=>document.querySelector('.article-card').dataset.mobileClean==='1');
 }
 await page.setViewport({width:844,height:1100});
 await page.waitForFunction(()=>!document.querySelector('[data-mobile-clean]'));
 assert.deepEqual(errors,[]);
 await fs.writeFile(output+'/measurements.json',JSON.stringify(report,null,2));
 console.log(`MOBILE_TOP_OK: ${report.length * 6} responsive cards, desktop styles unchanged, scope/resize/rerender passed`);
} finally { await browser.close(); }
