import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
import {createReaderAssetRenderer} from '../../../src/ui/reader-assets.js';
import {createFixtureApi} from '../../../test/helpers/frontend-refactor/fixtures.js';
const root='/tmp/rss-audit-followup-20261007/',states=JSON.parse(await readFile(root+'user-states-fixture.json','utf8'));
const before=await readFile(root+'persistence-before.js','utf8'),after=await readFile(new URL('../../../public/js/app/persistence.js',import.meta.url),'utf8');
const script=await createReaderAssetRenderer().script(),server=await startFixtureServer(),browser=await chromium.launch({headless:true,args:['--no-sandbox']}),results=[];
const paired=process.argv.includes('--paired');
try{
 for(const width of [1440,390])for(const variant of (paired?['paired']:['before','after'])){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390});await context.addCookies([{name:'auth',value:'true',url:server.url}]);
  const api=createFixtureApi();await context.route('**/api/**',r=>{const url=new URL(r.request().url());const value=api(url,{});return r.fulfill({contentType:'application/json',body:JSON.stringify(['/api/data','/api/user-states'].includes(url.pathname)?{...value,...states}:value)});});
  if(variant==='before')await context.route('**/script.js*',r=>r.fulfill({contentType:'text/javascript',body:script.replace(after,before)}));
  const page=await context.newPage();await page.goto(server.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.Alpine&&Alpine.$data(document.body).articles?.length===8&&!Alpine.$data(document.body).isLoadingArticles);
  if(paired){
   const rows=await page.evaluate(async({before,after})=>{
    const app=Alpine.$data(document.body),methods={before:new Function(before+';return ReaderAppPersistence.create().saveState')(),after:new Function(after+';return ReaderAppPersistence.create().saveState')()},rows=[];
    await app.openArticleOverlay(app.articles[0]);app.closeArticleOverlay({closeAll:true});await new Promise(r=>setTimeout(r,500));
    for(let i=0;i<10;i++)for(const variant of (i%2?['after','before']:['before','after'])){
     app.saveState=methods[variant];const at=performance.now();app.saveState();const saveMs=performance.now()-at;
     const snapshot=JSON.parse(localStorage.getItem('rssAppState'));delete snapshot.savedAt;delete snapshot.recentReadAt;
     const start=performance.now();await app.openArticleOverlay(app.articles[0]);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
     rows.push({variant,saveMs,articleMs:performance.now()-start,readable:!!app.overlayContent,snapshot:JSON.stringify(snapshot)});app.closeArticleOverlay({closeAll:true});await new Promise(r=>setTimeout(r,200));
    }
    return rows;
   },{before,after});
   if(rows.some(r=>!r.readable)||rows.slice(2).some(r=>r.snapshot!==rows[2].snapshot))throw Error('Paired content mismatch');
   results.push({width,rows:rows.map(({snapshot,...row})=>row)});console.log(JSON.stringify(results.at(-1)));await context.close();continue;
  }
  const measurements=await page.evaluate(async()=>{
   const app=Alpine.$data(document.body),samples=[],snapshots=[];
   for(let i=0;i<9;i++){
    const start=performance.now();app.saveState();samples.push(performance.now()-start);
    const s=JSON.parse(localStorage.getItem('rssAppState'));delete s.savedAt;snapshots.push(JSON.stringify(s));
   }
   await app.openArticleOverlay(app.articles[0]);app.closeArticleOverlay({closeAll:true});await new Promise(r=>setTimeout(r,300));
   const article=[];
   for(let i=0;i<5;i++){
    const start=performance.now();await app.openArticleOverlay(app.articles[0]);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));article.push({ms:performance.now()-start,readable:!!app.overlayContent});app.closeArticleOverlay({closeAll:true});await new Promise(r=>setTimeout(r,300));
   }
   return {samples,article,snapshot:snapshots[0],stable:snapshots.every(s=>s===snapshots[0])};
  });
  results.push({width,variant,...measurements});console.log(JSON.stringify({width,variant,samples:measurements.samples,article:measurements.article,stable:measurements.stable}));await context.close();
 }
 if(!paired)for(const width of [1440,390]){const [a,b]=results.filter(r=>r.width===width);if(a.snapshot!==b.snapshot)throw Error('Persistence content changed');}
 await writeFile(root+(paired?'persistence-paired.json':'persistence-client.json'),JSON.stringify(results,null,2));
}finally{await browser.close();server.close();}
