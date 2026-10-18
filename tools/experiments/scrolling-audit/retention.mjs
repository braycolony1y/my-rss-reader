// Bounded client-retention probe; not a long-session or production OOM test.
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {startScrollFixture} from './fixture.mjs';
const [root,output]=process.argv.slice(2);
if(!root||!output)throw Error('Usage: node retention.mjs SOURCE_ROOT OUTPUT_JSON');
const server=await startScrollFixture(root,{count:12,imageDelay:10,focusDelay:10});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:900},isMobile:true,hasTouch:true});
 await context.addCookies([{name:'auth',value:'true',url:server.url}]);
 await context.addInitScript(()=>localStorage.setItem('theme','glass-light'));
 const page=await context.newPage();page.setDefaultTimeout(20000);
 await page.goto(server.url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&document.querySelector('.article-card'));
 await page.waitForTimeout(1500);
 const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
 const rows=[];
 await page.evaluate(()=>{window.__retentionCards=[...document.querySelectorAll('.article-card')];});
 for(let cycle=0;cycle<=10;cycle++){
  if(cycle)await page.evaluate(async()=>{await Alpine.$data(document.body).fetchData(false,true,true);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  if(![0,5,10].includes(cycle))continue;
  await cdp.send('HeapProfiler.collectGarbage');
  const dom=await cdp.send('Memory.getDOMCounters'),metrics=await cdp.send('Performance.getMetrics');
  const heapUsed=metrics.metrics.find(e=>e.name==='JSHeapUsedSize').value;
  rows.push({cycle,heapUsed,...dom,cards:await page.locator('.article-card').count()});
 }
 const dwell=Number(process.env.DWELL_MS)||0;
 if(dwell){
  const started=Date.now();
  while(Date.now()-started<dwell){await page.waitForTimeout(Math.min(30000,dwell-(Date.now()-started)));console.log('idle '+Math.round((Date.now()-started)/1000)+'s');}
  await cdp.send('HeapProfiler.collectGarbage');
  const dom=await cdp.send('Memory.getDOMCounters'),metrics=await cdp.send('Performance.getMetrics');
  rows.push({idleMs:Date.now()-started,heapUsed:metrics.metrics.find(e=>e.name==='JSHeapUsedSize').value,...dom,cards:await page.locator('.article-card').count(),retained:await page.evaluate(()=>window.__retentionCards.every(card=>card.isConnected))});
 }
 await writeFile(output,JSON.stringify({engine:'chromium',version:browser.version(),forcedGcInDisposableBrowser:true,cycles:10,rows},null,2));
 console.log(JSON.stringify(rows));
}finally{await browser.close();server.close();}
