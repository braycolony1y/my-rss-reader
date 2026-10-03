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
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1440,height:1100});
 await page.goto(`http://127.0.0.1:${server.address().port}/public/top-story-card/demo/index.html`);
 await page.waitForFunction(()=>window.topStoryReview?.entries[0].img.complete);
 await page.addStyleTag({url:'/public/liquid-cards.css'});
 await page.addStyleTag({url:'/public/shared-card-style/card.css'});
 await page.addStyleTag({url:'/public/top-story-card/hero-extent.css'});
 await page.addStyleTag({url:'/public/top-story-card/edge-colors.css'});
 const report=await page.evaluate(async()=>{
  const e=window.topStoryReview.entries[0],c=e.card;
  const tick=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  c.dataset.smartClusterId='fixture';window.topStoryReview.update();await tick();await tick();
  const edge={color:c.style.getPropertyValue('--edge-bottom-color'),start:c.style.getPropertyValue('--edge-color-start'),state:c.dataset.edgeColor};
  c.querySelector('.article-card-panel').style.display='none';c.querySelector('.story-rank').style.display='none';window.topStoryReview.update();await tick();
  const snap=()=>{const im=c.querySelector('.thumbnail-img'),h=c.querySelector('.article-card-heading'),t=c.querySelector('h2'),p=h.querySelector('p');return {headingWidth:h.getBoundingClientRect().width,titleFont:getComputedStyle(t).font,summaryFont:getComputedStyle(p).font,focus:getComputedStyle(im).objectPosition,imageWidth:im.getBoundingClientRect().width,imageLeft:im.getBoundingClientRect().left-c.getBoundingClientRect().left,heroError:c.querySelector('.article-card-image').getBoundingClientRect().bottom-c.getBoundingClientRect().bottom,bottomError:im.getBoundingClientRect().bottom-c.getBoundingClientRect().bottom,mask:getComputedStyle(im).maskImage,fit:getComputedStyle(im).objectFit,height:c.getBoundingClientRect().height};};
  const top=snap();c.dataset.imageLayout='standard';c.classList.add('is-standard-card');window.topStoryReview.update();await tick();await tick();
  const standard=snap();return {edge,top,standard};
 });
 console.log(JSON.stringify(report,null,2));
 assert.equal(report.edge.state,'ready');assert.ok(report.edge.color.startsWith('oklch'));
 for(const key of ['headingWidth','titleFont','summaryFont','focus','imageWidth','imageLeft','mask','fit','height'])assert.equal(report.standard[key],report.top[key],key);
 assert.ok(Math.abs(report.standard.bottomError)<.1);
 assert.ok(Math.abs(report.standard.heroError)<.1);
 await (await page.$('.article-card')).screenshot({path:path.join(out,'matched-standard.png')});
 await page.evaluate(()=>{const c=window.topStoryReview.entries[0].card;c.dataset.imageLayout='top';c.classList.remove('is-standard-card');c.querySelector('.article-card-panel').style.display='';window.topStoryReview.update();});
 await new Promise(r=>setTimeout(r,200));
 await (await page.$('.article-card')).screenshot({path:path.join(out,'bottom-color.png')});
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'matched-measurements.json'),JSON.stringify(report,null,2));console.log('PASS shared card matches Top without analysis; sampled bottom color active');
} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
