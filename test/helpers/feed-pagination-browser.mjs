import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:3000';
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/snap/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const context=await browser.createBrowserContext();
 await context.setCookie({name:'auth',value:'true',url:base});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:390,height:1000});
 // This is a read-only UI check: prevent preference/read-state writes from its temporary session.
 await page.setRequestInterception(true);
 page.on('request',r=>r.method()==='GET'?r.continue():r.abort());
 await page.goto(base+'/#category/Forum',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.Alpine && Alpine.$data(document.body).isLoggedIn && !Alpine.$data(document.body).isLoadingArticles && Alpine.$data(document.body).articles.length>0,{timeout:60000});
 const first=await page.evaluate(()=>{const app=Alpine.$data(document.body);return {type:app.selectedFilterType,value:app.selectedFilterValue,page:app.currentPage,links:app.articles.map(a=>a.link)};});
 assert.equal(first.type,'category');assert.equal(first.value,'Forum');assert.equal(first.page,1);
 const second=await page.evaluate(async()=>{const app=Alpine.$data(document.body);await app.goToPage(2);return {page:app.currentPage,links:app.articles.map(a=>a.link)};});
 assert.equal(second.page,2);assert.ok(second.links.length>0);assert.ok(second.links.some(l=>!first.links.includes(l)));
 await page.evaluate(async()=>{const app=Alpine.$data(document.body);await app.fetchData(false,false,true);});
 assert.equal(await page.evaluate(()=>Alpine.$data(document.body).currentPage),2);
 const third=await page.evaluate(async()=>{const app=Alpine.$data(document.body);await app.goToPage(3);return {page:app.currentPage,links:app.articles.map(a=>a.link)};});
 assert.equal(third.page,3);assert.ok(third.links.some(l=>!second.links.includes(l)));
 // Exercise the actual Alpine count directive in both responsive modes.
 for(const width of [390,1440]){
  await page.setViewport({width,height:1000});
  await page.evaluate(()=>{const app=Alpine.$data(document.body);app.articles[0].isCluster=true;app.articles[0].sourceCount=1;});
  await page.waitForFunction(()=>{const n=document.querySelector('.article-card [x-text="article.sourceCount"]');return n && getComputedStyle(n.parentElement).display==='none';});
  await page.evaluate(()=>Alpine.$data(document.body).articles[0].sourceCount=2);
  await page.waitForFunction(()=>{const n=document.querySelector('.article-card [x-text="article.sourceCount"]');return n && getComputedStyle(n.parentElement).display!=='none';});
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'LIVE_FORUM_PAGINATION_OK',pages:[first.page,second.page,third.page],counts:[first.links.length,second.links.length,third.links.length],sourceCount:'single hidden, multiple visible at 390 and 1440px'}));
}finally{await browser.close();}
