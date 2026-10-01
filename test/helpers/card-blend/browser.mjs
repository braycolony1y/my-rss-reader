import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import {measureCard} from './measure.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+name);if(!file.startsWith(root+'public/')){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.json':'application/json'})[path.extname(file)]||'text/html');res.end(await fs.readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/snap/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1400,height:1100,deviceScaleFactor:2});
 await page.goto(`http://127.0.0.1:${server.address().port}/public/tint-demo/index.html`,{waitUntil:'networkidle0'});
 await page.waitForFunction(()=>document.querySelectorAll('article[data-ready]').length===14);
 await page.$$eval('img',async images=>{images.forEach(img=>img.loading='eager');await Promise.all(images.filter(img=>img.src).map(img=>img.decode()));});
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 const report=[];
 for(const width of [360,720,1100]) {
  await page.select('#width',String(width));
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const hidden=await page.addStyleTag({content:'.article-card-heading>* ,.article-entity-chip {visibility:hidden!important}'});
  for(const card of await page.$$('article')) {
   const geometry=await card.evaluate(el=>{
    const base=el.getBoundingClientRect(),rect=node=>{const r=node.getBoundingClientRect();return{x:r.x-base.x,y:r.y-base.y,width:r.width,height:r.height}};
    const plate=rect(el.querySelector('.article-card-image')),entity=rect(el.querySelector('.article-entity-row'));
    const color=css=>{const c=document.createElement('canvas').getContext('2d');c.fillStyle=css;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data].slice(0,3)};
    return {fixture:el.dataset.fixture,card:rect(el),plate,heading:rect(el.querySelector('.article-card-heading')),
     fy:parseFloat(getComputedStyle(el).getPropertyValue('--fy')),bottom:el.dataset.blendBottom==='true',mobile:base.width<640,
     expanded:el.querySelector('.article-card-panel').dataset.expanded==='true',entityBottom:entity.y+entity.height,
     noRuntimeBlur:[...el.querySelectorAll('*')].every(node=>!getComputedStyle(node).filter.includes('blur')),
     backdrops:[el,...el.querySelectorAll('*')].filter(node=>getComputedStyle(node).backdropFilter!=='none').length,
     ink:[el.querySelector('h2'),el.querySelector('.article-card-heading p')].map(node=>color(getComputedStyle(node).color))};
   });
   const shot=await sharp(await card.screenshot()).removeAlpha().raw().toBuffer({resolveWithObject:true});
   const metadata=await card.evaluate(el=>JSON.parse(el.dataset.blend));
   const values=measureCard(shot.data,shot.info,geometry,metadata);report.push(values);
   assert.ok(values.checks.contrastAA,`${width} ${geometry.fixture}: text contrast`);
   assert.ok(values.checks.entitySpan,`${width} ${geometry.fixture}: photo spans entity row`);
   assert.ok(values.checks.noRuntimeBlur&&values.checks.oneBackdrop,'static layers and one backdrop');
  }
  await hidden.evaluate(el=>el.remove());
  const first=await page.$('article');await first.screenshot({path:root+`test/fixtures/generated/ambient-card-${width}.png`});
  console.log(`${width}px: all seven fixtures and both panel states measured at 2x`);
 }
 const result={deviceScaleFactor:2,fixtures:'Seven diagnostic illustrations. Exact referenced photographs waived by user.',priority:'Latest user clarification prioritizes a clear thumbnail and protected text. Horizontal ramps shortened; mobile bottom fade capped at 80px.',cards:report};
 await fs.writeFile(root+'public/tint-demo/measurements.json',JSON.stringify(result,null,2)+'\n');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({cards:report.length,minimumContrast:Math.min(...report.map(c=>c.measurements.minimumContrast)),strictPass:report.filter(c=>c.pass).length,failures:Object.fromEntries(Object.keys(report[0].checks).map(key=>[key,report.filter(c=>!c.checks[key]).length]))}));
} finally {await browser.close();await new Promise(r=>server.close(r));}
