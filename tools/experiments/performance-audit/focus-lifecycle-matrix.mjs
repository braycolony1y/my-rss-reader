// Controlled real-component timing/ownership replay. No production API writes.
import { chromium, webkit } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startFixtureServer } from '../../../test/helpers/frontend-refactor/server.js';
import { detectImageFocus } from '../../../src/images/focal-detector.js';
const output = process.argv[2], engine = process.argv.includes('--webkit') ? 'webkit' : 'chromium';
await mkdir(output, {recursive:true});
const bytes = await readFile('public/default.jpg');
const metadata = { ...await detectImageFocus(bytes), x: .85, y: .2, type: 'face' };
const source = (await readFile('public/image-focus.js','utf8')).replace('const states = new Map();','const states = new Map(); win.__focusStates = states;');
const server = await startFixtureServer({ transformResponse(value) {
    if (Array.isArray(value?.articles)) for (const article of value.articles) article.image = '/api/og-image?url=lifecycle-A';
    return value;
}});
let browser = await (engine === 'webkit' ? webkit : chromium).launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}:{})});
const rows = [];
try {
 for (const width of engine==='webkit'?[390]:[1440,390]) for (const theme of (process.env.FOCUS_THEME?[process.env.FOCUS_THEME]:['classic','glass-light'])) {
  for (const delay of (process.env.FOCUS_DELAYS?process.env.FOCUS_DELAYS.split(',').map(Number):[100,500,1000,2400,3000,6000,-1])) {
   const context = await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390});
   await context.addCookies([{name:'auth',value:'true',url:server.url}]);
   await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
   await context.route('**/public/image-focus.js*',r=>r.fulfill({contentType:'text/javascript',body:source}));
   await context.route('**/api/og-image*',r=>r.fulfill({contentType:'image/jpeg',body:bytes}));
   await context.route('**/api/image-focus*',async r=>{
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,delay)));
    await r.fulfill(delay<0?{status:503,body:'unavailable'}:{json:metadata}).catch(()=>{});
   });
   const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{
    window.visualFrames=[];
    const tick=()=>{
     const img=document.querySelector('.article-card .thumbnail-img'),card=img?.closest('.article-card'),s=window.__focusStates?.get(img);
     if(s&&window.visualFrames.length<1500){const r=card.getBoundingClientRect();window.visualFrames.push({at:performance.now(),x:s.focus?.x,palette:!!s.palette,tint:!!s.tint,blend:!!s.blend,deferred:!!s.deferred,settled:s.settled,source:s.source,generation:s.generation,visible:r.bottom>0&&r.top<innerHeight,geometry:[r.x,r.y,r.width,r.height],soft:card.dataset.storyBlend});}
     requestAnimationFrame(tick);
    };requestAnimationFrame(tick);
   });
   await page.goto(server.url);
   await page.waitForFunction(()=>window.__focusStates?.size>0);
   try {
    await page.waitForFunction(expected=>{const i=document.querySelector('.article-card .thumbnail-img'),s=window.__focusStates?.get(i);return s?.settled&&s.focus.x===expected;},delay<0?.5:.85,{timeout:25000});
   } catch(error) {
    console.log(JSON.stringify({engine,width,theme,delay,errors,diagnostic:await page.evaluate(()=>({frames:window.visualFrames.slice(-10),images:[...window.__focusStates].slice(0,2).map(([i,s])=>({src:i.src,current:i.currentSrc,complete:i.complete,width:i.naturalWidth,state:s}))}))}));
    throw error;
   }
   await page.waitForTimeout(350);
   await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
   const frames=await page.evaluate(()=>window.visualFrames),last=frames.at(-1);
   assert.equal(last.x,delay<0?.5:.85);assert.equal(last.deferred,false);
   assert.equal(last.visible,true);assert.equal(errors.length,0);
   if(delay>=0)assert.ok(frames.every(f=>!f.palette||f.x===.85),'palette must not lead focus');
   if(delay===3000){await page.screenshot({path:`${output}/${engine}-${width}-${theme}.png`});}
   rows.push({engine,width,theme,delay,errors,last,frames});
   await writeFile(`${output}/${engine}.json`,JSON.stringify(rows));
   console.log(JSON.stringify({engine,width,theme,delay,frames:frames.length,x:last.x,coherent:true}));
   await context.close();
   if(engine==='webkit'){await browser.close();browser=await webkit.launch({headless:true});}
  }
 }
} finally {await browser.close();server.close();}
