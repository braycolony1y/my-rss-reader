import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
const server=await startFixtureServer();
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.addCookies([{name:'auth',value:'true',url:server.url}]);
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(server.url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.Alpine && Alpine.$data(document.body).articles?.length===8 && !Alpine.$data(document.body).isLoadingArticles);
 const cdp=await context.newCDPSession(page);
 await cdp.send('Network.enable');
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:187500,uploadThroughput:93750});
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 const result=await page.evaluate(async()=>{
  const app=Alpine.$data(document.body),start=performance.now();
  app.setFilter('feed','https://example.test/old-a');
  app.setFilter('feed','https://example.test/old-b');
  app.setFilter('feed','https://example.test/feed');
  while(app.isLoadingArticles)await new Promise(r=>setTimeout(r,20));
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const feed={ms:performance.now()-start,selected:app.selectedFilterValue,cards:document.querySelectorAll('.article-card').length};
  const article=app.articles[0],at=performance.now();await app.openArticleOverlay(article);
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const open={ms:performance.now()-at,readable:!!app.overlayContent,error:app.overlayError};
  app.closeArticleOverlay({closeAll:true});
  return {feed,open};
 });
 await page.route('**/api/article-content?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary upstream failure'})}));
 result.failure=await page.evaluate(async()=>{const app=Alpine.$data(document.body);await app.openArticleOverlay({...app.articles[0],link:'https://example.test/failing-article'});return {loading:app.isLoadingOverlay,error:app.overlayError,open:app.articleOverlayOpen};});
 result.errors=errors;result.scope='Chromium mobile emulation, 4x CPU slowdown, 150ms latency and 1.5Mbps download; local fixture, not physical iPhone';
 if(result.feed.selected!=='https://example.test/feed'||result.feed.cards!==8||!result.open.readable||result.failure.loading||!result.failure.error||errors.length)throw Error(JSON.stringify(result));
 await writeFile('/tmp/rss-audit-20261006/mobile-resilience.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();server.close();}
