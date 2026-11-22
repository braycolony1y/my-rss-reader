import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
const before=await readFile('/tmp/rss-audit-followup-20261007/client-before.html','utf8');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),results=[];
try{
 for(const variant of ['before','after']){
  const server=await startFixtureServer({imageDelayMs:35000,transformResponse:(value,url)=>url.pathname==='/api/data'?{...value,articles:value.articles.map((a,i)=>({...a,image:`/api/og-image?url=https%3A%2F%2Fexample.test%2Fphoto-${i}`}))}:value});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await context.addCookies([{name:'auth',value:'true',url:server.url}]);
  if(variant==='before')await context.route(server.url+'/',r=>r.fulfill({contentType:'text/html',body:before}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(server.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.Alpine&&Alpine.$data(document.body).articles?.length===8&&!Alpine.$data(document.body).isLoadingArticles);
   await page.waitForTimeout(1000);
   const state=await page.evaluate(async()=>{
    const app=Alpine.$data(document.body),start=performance.now();app.setFilter('smart','tech_vietnam');
    while(app.isLoadingArticles)await new Promise(r=>setTimeout(r,10));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return {ms:performance.now()-start,cards:app.articles.length,result:app._lastArticlePageResult,error:app.articleListError};
   });
   results.push({variant,...state,errors});console.log(JSON.stringify(results.at(-1)));
   if(variant==='after'&&(!state.result?.ok||state.cards!==8||errors.length))throw Error('Mobile Smart Top failed');
  }finally{await context.close();server.close();}
 }
 await writeFile('/tmp/rss-audit-followup-20261007/smart-connection-recovery.json',JSON.stringify(results,null,2));
}finally{await browser.close();}
