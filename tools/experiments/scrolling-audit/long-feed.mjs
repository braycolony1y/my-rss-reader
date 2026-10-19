// Functional long-feed/reversal probe. Run timing benchmarks separately.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {startScrollFixture} from './fixture.mjs';
const [root,output]=process.argv.slice(2);
if(!root||!output)throw Error('Usage: node long-feed.mjs SOURCE_ROOT OUTPUT_DIRECTORY');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const rows=[];
try{
 for(const width of [390,1440])for(const theme of ['classic','glass','glass-light']){
  const pageSize=width===390?15:40,count=width===390?60:80;
  const server=await startScrollFixture(root,{count,pageSize,imageDelay:50,focusDelay:20});
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390});
  try{
   await context.addCookies([{name:'auth',value:'true',url:server.url}]);
   await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
   await page.goto(server.url,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles);
   await page.evaluate(()=>Alpine.$data(document.body).setFilter('feed','https://example.test/feed'));
   await page.waitForFunction(expected=>!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).articles.length===expected,pageSize);
   await page.evaluate(()=>{window.__firstFeedCards=[...document.querySelectorAll('.article-card')];});
   // Desktop appends on scroll; mobile intentionally uses its page controls.
   for(let pageNumber=2;pageNumber<=count/pageSize;pageNumber++){
    if(width===390){
     await page.evaluate(number=>Alpine.$data(document.body).goToPage(number),pageNumber);
     await page.waitForFunction(number=>!Alpine.$data(document.body).isLoadingMore&&Alpine.$data(document.body).currentPage===number,pageNumber);
    }else{
     await page.evaluate(()=>{const sc=document.getElementById('scroll-container');sc.scrollTop=sc.scrollHeight;});
     await page.waitForFunction(expected=>Alpine.$data(document.body).articles.length===expected,pageNumber*pageSize);
    }
   }
   const retainedFromFirstPage=await page.evaluate(()=>window.__firstFeedCards.filter(c=>c.isConnected).length);
   assert.equal(retainedFromFirstPage,width===390?0:pageSize);
   await page.evaluate(()=>{window.__currentFeedCards=[...document.querySelectorAll('.article-card')];window.__primaryClears=0;window.__sourceObserver=new MutationObserver(records=>{for(const r of records)if(r.target.isConnected&&r.target.matches?.('.thumbnail-img')&&!r.target.getAttribute('src'))window.__primaryClears++;});window.__sourceObserver.observe(document.getElementById('scroll-container'),{subtree:true,attributes:true,attributeFilter:['src']});});
   for(const speed of [350,750,2400])await page.evaluate(async speed=>{
    const sc=document.getElementById('scroll-container'),start=performance.now(),duration=1600;
    sc.scrollTop=0;
    await new Promise(resolve=>requestAnimationFrame(function step(at){const fraction=Math.min(1,(at-start)/duration);sc.scrollTop=(fraction<.5?fraction:1-fraction)*duration/1000*speed;if(fraction<1)requestAnimationFrame(step);else resolve();}));
   },speed);
   const result=await page.evaluate(()=>{window.__sourceObserver.disconnect();return {cards:document.querySelectorAll('.article-card').length,retainedAfterReversals:window.__currentFeedCards.filter(c=>c.isConnected).length,primarySourceClears:window.__primaryClears,hasMore:Alpine.$data(document.body).hasMore};});
   assert.equal(result.cards,width===390?pageSize:count);assert.equal(result.retainedAfterReversals,result.cards);assert.equal(result.primarySourceClears,0);assert.equal(result.hasMore,false);assert.deepEqual(errors,[]);
   rows.push({width,theme,visitedArticles:count,pagination:width===390?'explicit mobile pages':'desktop infinite scroll',retainedFromFirstPage,nominalScrollPxPerSecond:[350,750,2400],...result,errors});
   await writeFile(output+'/results.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows.at(-1)));
  }finally{await context.close();server.close();}
 }
}finally{await browser.close();}
