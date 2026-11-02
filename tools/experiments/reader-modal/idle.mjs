const {chromium}=await import(process.env.READER_PLAYWRIGHT_MODULE||'playwright');
import fs from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
import {articleFixture} from './fixtures.mjs';
const out=process.argv[2],duration=Number(process.env.IDLE_MS)||180000;
const server=await startFixtureServer({transformResponse:(v,u)=>u.pathname==='/api/article-content'?{...v,content:articleFixture('plain')}:v});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 await context.addCookies([{name:'auth',value:'true',url:server.url}]);
 const page=await context.newPage();
 await page.goto(server.url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).articles.length);
 await page.evaluate(()=>Alpine.$data(document.body).openArticleOverlay(Alpine.$data(document.body).articles[0]));
 await page.waitForSelector('.article-rendered-content p');
 await page.waitForTimeout(800);
 const session=await context.newCDPSession(page);
 await session.send('Performance.enable');
 await session.send('HeapProfiler.collectGarbage');
 const before=await session.send('Performance.getMetrics');
 await page.evaluate(()=>{
  const root=document.querySelector('.article-rendered-content');
  window.__idleNodes=[...root.querySelectorAll('*')];
  window.__idleMutations=0;
  window.__idleObserver=new MutationObserver(records=>window.__idleMutations+=records.length);
  window.__idleObserver.observe(root,{subtree:true,attributes:true,childList:true});
  document.getElementById('overlay-scroll-container').scrollTop=1800;
 });
 const at=Date.now();
 while(Date.now()-at<duration)await page.waitForTimeout(Math.min(30000,duration-(Date.now()-at)));
 await session.send('HeapProfiler.collectGarbage');
 const after=await session.send('Performance.getMetrics');
 const result=await page.evaluate(()=>{
  window.__idleObserver.disconnect();
  const root=document.querySelector('.article-rendered-content');
  return {retained:window.__idleNodes.filter(n=>n.isConnected).length,original:window.__idleNodes.length,
   current:root.querySelectorAll('*').length,mutations:window.__idleMutations,
   top:document.getElementById('overlay-scroll-container').scrollTop};
 });
 const prior=new Map(before.metrics.map(x=>[x.name,x.value]));
 result.durationMs=Date.now()-at;
 result.delta=Object.fromEntries(after.metrics.filter(x=>/JSHeapUsedSize|Nodes|JSEventListeners/.test(x.name)).map(x=>[x.name,x.value-(prior.get(x.name)||0)]));
 result.environment='Isolated browser; functional idle/retention probe, not a production memory soak.';
 if(result.retained!==result.original||result.current!==result.original||result.top!==1800)throw Error(JSON.stringify(result));
 await fs.writeFile(out,JSON.stringify(result,null,2));
 console.log(result);
}finally{await browser.close();server.close()}
