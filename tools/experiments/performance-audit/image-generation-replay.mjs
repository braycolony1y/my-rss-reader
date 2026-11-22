import {chromium,webkit} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
const output=process.argv[2],engine=process.argv.includes('--webkit')?'webkit':'chromium';await mkdir(output,{recursive:true});
const photo=await readFile('public/default.jpg');
const server=await startFixtureServer({transformResponse(value){if(Array.isArray(value?.articles))for(const a of value.articles)a.image='/api/og-image?url=source-A';return value;}});
const source=(await readFile('public/image-focus.js','utf8')).replace('const states = new Map();','const states = new Map(); win.__focusStates=states;');
const browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}:{})}),rows=[];
try{for(const width of engine==='webkit'?[390]:[1440,390])for(const theme of ['classic','glass-light']){
 const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390});
 await context.addCookies([{name:'auth',value:'true',url:server.url}]);await context.addInitScript(t=>localStorage.setItem('theme',t),theme);
 await context.route('**/public/image-focus.js*',r=>r.fulfill({contentType:'text/javascript',body:source}));
 await context.route('**/api/og-image*',r=>r.fulfill(r.request().url().includes('fail-primary')?{status:404,body:'missing'}:{contentType:'image/jpeg',body:photo}));
 let started;const firstRequest=new Promise(r=>started=r);
 await context.route('**/api/image-focus*',async r=>{const a=r.request().url().includes('source-A');if(a)started();await new Promise(resolve=>setTimeout(resolve,a?3200:50));await r.fulfill({json:{x:a?.1:.9,y:.2,palette:{primary:a?[200,50,50]:[50,50,200],secondary:[50,50,200]}}}).catch(()=>{});});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(server.url);await firstRequest;
 await page.evaluate(async()=>{const diagnostics=await import('/public/js/ui/flicker-diagnostics.js');diagnostics.installFlickerDiagnostics();});
 await page.evaluate(()=>{window.generationImage=document.querySelector('.thumbnail-img');Alpine.$data(document.body).articles[0].image='/api/og-image?url=source-B';});
 await page.waitForFunction(()=>window.__focusStates.get(window.generationImage)?.focus.x===.9,null,{timeout:20000});
 await page.waitForTimeout(3500);
 const stale=await page.evaluate(()=>{const s=window.__focusStates.get(window.generationImage);return{x:s.focus.x,palette:s.palette.primary,source:s.source,deferred:!!s.deferred};});
 assert.equal(stale.x,.9);assert.match(stale.source,/source-B/);assert.deepEqual(stale.palette,[50,50,200]);
 await page.evaluate(()=>{const i=window.generationImage;i.srcset='/api/og-image?url=source-C 1x';i.sizes='50vw';});
 await page.waitForFunction(()=>window.__focusStates.get(window.generationImage)?.source.includes('source-C'),null,{timeout:10000});
 const responsive=await page.evaluate(()=>({source:window.__focusStates.get(window.generationImage).source,current:window.generationImage.currentSrc}));
 await page.evaluate(()=>{window.generationImage.removeAttribute('srcset');window.generationImage.removeAttribute('sizes');});
 const fallbacks=[];
 for(const name of ['D','E']){
  await page.evaluate(name=>{const a=Alpine.$data(document.body).articles[0];a.imageCandidates=[`/api/og-image?url=next-${name}`,`/api/og-image?url=third-${name}`];a.image=`/api/og-image?url=fail-primary-${name}`;},name);
  await page.waitForFunction(name=>window.generationImage.currentSrc.includes(`next-${name}`)&&window.generationImage.naturalWidth>0,name,{timeout:10000});
  fallbacks.push(await page.evaluate(()=>window.generationImage.currentSrc));
 }
 await page.setViewportSize({width:width===390?430:1200,height:900});
 await page.evaluate(()=>window.generationImage.remove());
 await page.waitForFunction(()=>!window.__focusStates.has(window.generationImage));
 const diagnosticEvents=await page.evaluate(()=>{const n=window.__readerFlicker.export().events.length;window.__readerFlicker.stop();return n;});
 assert.equal(errors.length,0);rows.push({engine,width,theme,stale,responsive,fallbacks,removed:true,diagnosticEvents,errors});console.log(JSON.stringify(rows.at(-1)));await context.close();
}}finally{await browser.close();server.close();await writeFile(`${output}/generation-${engine}.json`,JSON.stringify(rows,null,2));}
