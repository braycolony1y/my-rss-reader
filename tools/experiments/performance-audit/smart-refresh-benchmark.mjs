// Ordinary timings: no mutation probes, per-frame geometry reads or screenshots.
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
import {createReaderAssetRenderer} from '../../../src/ui/reader-assets.js';
const diagnosticMode=process.argv.includes('--diagnostic-overhead');
const after=await createReaderAssetRenderer().script(),before=diagnosticMode?after:await readFile('/tmp/rss-flicker-20261014/before.js','utf8');
const server=await startFixtureServer(),browser=await chromium.launch({headless:true,args:['--no-sandbox']}),rows=[];
try{for(const theme of ['classic','glass-light'])for(const variant of ['before','after','after','before']){
 const context=await browser.newContext({viewport:{width:1440,height:900}});await context.addCookies([{name:'auth',value:'true',url:server.url}]);await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
 await context.route('**/script.js*',r=>r.fulfill({contentType:'text/javascript',body:variant==='before'?before:after}));
 const page=await context.newPage();await page.goto(server.url);await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).articles.length);await page.waitForTimeout(700);
 if(diagnosticMode&&variant==='after')await page.evaluate(async()=>{const m=await import('/public/js/ui/flicker-diagnostics.js');m.installFlickerDiagnostics();});
 for(let i=0;i<4;i++){
  const result=await page.evaluate(async(refreshOnly)=>{const app=Alpine.$data(document.body),frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   let at=performance.now();await app.fetchData(false,true,true);await frame();const refresh=performance.now()-at;
   if(refreshOnly)return {refresh};
   at=performance.now();app.setFilter('feed','https://example.test/feed');while(app.isLoadingArticles)await new Promise(r=>setTimeout(r,5));await frame();const feed=performance.now()-at;
   at=performance.now();app.setFilter('smart','news_vietnam');while(app.isLoadingArticles)await new Promise(r=>setTimeout(r,5));await frame();const top=performance.now()-at;
   await app.openArticleOverlay(app.articles[0]);app.closeArticleOverlay({closeAll:true});await frame();
   at=performance.now();await app.openArticleOverlay(app.articles[0]);await frame();const cached=performance.now()-at,readable=!!app.overlayContent;
   app.closeArticleOverlay({closeAll:true});await frame();return {refresh,feed,top,cached,readable};},process.argv.includes('--refresh-only'));
  rows.push({theme,variant,...result});await writeFile(process.argv[2],JSON.stringify(rows,null,2));await page.waitForTimeout(300);
 }
 console.log(JSON.stringify({theme,variant,samples:4}));await context.close();
}}finally{await browser.close();server.close();}
