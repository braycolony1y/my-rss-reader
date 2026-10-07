import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
import {createReaderAssetRenderer} from '../../../src/ui/reader-assets.js';
const server=await startFixtureServer(),renderer=createReaderAssetRenderer();
const followup=process.argv.includes('--followup'),out=followup?'/tmp/rss-audit-followup-20261007':'/tmp/rss-audit-20261006';
const beforeHtml=await readFile(followup?out+'/client-before.html':'/tmp/rss-audit-20261006/rendered-before-panel.html','utf8');
const afterScript=await renderer.script();
const beforeScript=followup?await readFile(out+'/client-before.js','utf8'):afterScript.replace(/^const readerVietnamDateFormatter = .*\n/m,'').replace("return Number.isNaN(date.getTime()) ? 'Time unavailable' : readerVietnamDateFormatter.format(date);", "return Number.isNaN(date.getTime()) ? 'Time unavailable' : new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);");
const focus=await readFile(new URL('../../../public/image-focus.js',import.meta.url),'utf8');
const originalObserver=`        const affected = new Set();
        for (const record of records) {
            if (record.type === 'attributes' && record.target.matches(selector)) {
                if (record.attributeName === 'src' || record.attributeName === 'srcset') {
                    const state = states.get(record.target);
                    if (state) state.source = null;
                    watch(record.target);
                    affected.add(record.target);
                }
            } else if (!record.target.matches?.('.article-card-image')) {
                const img = record.target.closest?.('.article-card')?.querySelector(selector);
                if (img) affected.add(img);
            }
            record.addedNodes.forEach(scan);
        }
        affected.forEach(update);
`;
const from=focus.indexOf('        const { images, added, removed }'),to=focus.indexOf('        for (const [img, state] of states)',from);
const beforeFocus=followup?focus.replace('state.requested || !state.near','state.requested'):(focus.slice(0,from)+originalObserver+focus.slice(to)).replace(/^import \{ collectImageFocusMutations \}.*\n/m,'');
const hero=await readFile(new URL('../../../public/top-story-card/hero-extent.js',import.meta.url),'utf8');
const beforeHero=followup?hero:hero.replace('card.isConnected && win.innerWidth >= 768','card.isConnected && win.innerWidth >= 768 && card.clientWidth >= 640').replace(" === 'editorial'\n        && card.clientWidth >= 640;", " === 'editorial';");
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const report=[];
try {
 for(const width of [1440,390])for(const theme of ['classic','glass-light'])for(const mode of ['feed','top'])for(const variant of ['before','after']) {
  const context=await browser.newContext({viewport:{width,height:1000},isMobile:width===390,hasTouch:width===390});await context.addCookies([{name:'auth',value:'true',url:server.url}]);
  await context.addInitScript(theme=>{localStorage.setItem('theme',theme);window.tasks=[];new PerformanceObserver(list=>window.tasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});},theme);
  if(variant==='before') {
   await context.route(server.url+'/',route=>route.fulfill({contentType:'text/html',body:beforeHtml}));
   await context.route('**/script.js*',route=>route.fulfill({contentType:'text/javascript',body:beforeScript}));
   await context.route('**/public/image-focus.js*',route=>route.fulfill({contentType:'text/javascript',body:beforeFocus}));
   await context.route('**/public/top-story-card/hero-extent.js*',route=>route.fulfill({contentType:'text/javascript',body:beforeHero}));
  }
  const page=await context.newPage();await page.goto(server.url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.Alpine && Alpine.$data(document.body).articles?.length===8 && !Alpine.$data(document.body).isLoadingArticles);
  await page.evaluate(mode=>{const app=Alpine.$data(document.body);app.setFilter(mode==='feed'?'feed':'smart',mode==='feed'?'https://example.test/feed':'tech_vietnam');},mode);
  await page.waitForFunction(()=>!Alpine.$data(document.body).isLoadingArticles);
  await page.waitForTimeout(600);
  const samples=[];
  for(let i=0;i<5;i++)samples.push(await page.evaluate(async()=>{const app=Alpine.$data(document.body),at=performance.now();await app.fetchData();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-at;}));
  await page.waitForTimeout(400);
  const state=await page.evaluate(()=>({cards:[...document.querySelectorAll('.article-card')].map(c=>{const r=c.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,title:c.querySelector('h2')?.textContent};}),dom:document.querySelectorAll('*').length,tasks:window.tasks,heap:performance.memory?.usedJSHeapSize}));
  report.push({width,theme,mode,variant,samples,...state});console.log(JSON.stringify({width,theme,mode,variant,medianMs:[...samples].sort((a,b)=>a-b)[2],dom:state.dom,tasks:state.tasks.length}));
  await page.screenshot({path:`${out}/${width}-${theme}-${mode}-${variant}.png`});await context.close();
 }
 await writeFile(out+'/render-comparison.json',JSON.stringify(report,null,2));
}finally{await browser.close();server.close();}
