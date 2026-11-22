import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),results=[];
try{
 for(const theme of ['classic','glass-light']){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await context.addCookies([{name:'auth',value:'true',url:'http://127.0.0.1:3000'}]);await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
  await context.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.fulfill({status:200,contentType:'application/json',body:'{}'}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:3000/#category/Forum',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.Alpine&&Alpine.$data(document.body).articles?.length&&!Alpine.$data(document.body).isLoadingArticles,null,{timeout:60000});
  for(const destination of ['news_global','finance_global','tech_global','news_vietnam','finance_vietnam','tech_vietnam']){
   const r=await page.evaluate(async destination=>{const app=Alpine.$data(document.body),start=performance.now();app.setFilter('smart',destination);while(app.isLoadingArticles)await new Promise(r=>setTimeout(r,10));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {ms:performance.now()-start,cards:app.articles.length,result:app._lastArticlePageResult,error:app.articleListError,rendered:document.querySelectorAll('.article-card').length};},destination);
   results.push({theme,destination,...r,errors:[...errors]});await writeFile('/tmp/rss-audit-followup-20261007/six-smart-views.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.at(-1)));
   if(!r.result?.ok||!r.cards||!r.rendered||r.error||errors.length)throw Error('Smart view failed');
  }
  await context.close();
 }
}finally{await browser.close();}
