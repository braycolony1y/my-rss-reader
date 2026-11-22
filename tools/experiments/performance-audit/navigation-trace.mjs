import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const base=process.env.READER_URL||'http://127.0.0.1:3000',output=process.argv[2]||'/tmp/rss-audit-followup-20261007/navigation-before.json';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const results=[];
try{for(const mobile of [true,false]){
 const context=await browser.newContext({viewport:{width:mobile?390:1440,height:900},isMobile:mobile,hasTouch:mobile});await context.addCookies([{name:'auth',value:'true',url:base}]);
 await context.route('**/api/**',r=>r.request().method()==='GET'||new URL(r.request().url()).pathname==='/api/article-reader-session/close'?r.continue():r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 const page=await context.newPage(),cdp=await context.newCDPSession(page),network=new Map(),errors=[];
 await cdp.send('Network.enable');
 cdp.on('Network.requestWillBeSent',e=>{if(e.request.url.includes('/api/'))network.set(e.requestId,{url:e.request.url,dispatch:e.timestamp,wall:e.wallTime,type:e.type});});
 cdp.on('Network.responseReceived',e=>{const row=network.get(e.requestId);if(row)Object.assign(row,{headersAt:e.timestamp,status:e.response.status,protocol:e.response.protocol,timing:e.response.timing,headers:e.response.headers});});
 cdp.on('Network.loadingFinished',e=>{const row=network.get(e.requestId);if(row)Object.assign(row,{finished:e.timestamp,wireBytes:e.encodedDataLength});});
 cdp.on('Network.loadingFailed',e=>{const row=network.get(e.requestId);if(row)Object.assign(row,{failed:e.timestamp,error:e.errorText,cancelled:e.canceled});});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/#category/Forum',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.Alpine&&Alpine.$data(document.body).feeds?.length>6&&!Alpine.$data(document.body).isLoadingArticles,null,{timeout:60000});
 const actions=[];
 for(const target of [3,4,5,'top',3,'top']){
  actions.push(await page.evaluate(async target=>{
   const app=Alpine.$data(document.body),at=performance.now(),date=Date.now();
   if(target==='top')app.setFilter('smart','tech_vietnam');else app.setFilter('feed',app.feeds[target].url);
   while(app.isLoadingArticles)await new Promise(r=>setTimeout(r,10));
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   return {target,at,date,ms:performance.now()-at,cards:app.articles.length,renderedCards:[...document.querySelectorAll('.article-card')].filter(c=>c.getBoundingClientRect().height>0).length,result:app._lastArticlePageResult,error:app.articleListError,loadingStatus:app.loadingArticleStatus};
  },target));
  console.log(JSON.stringify({mobile,...actions.at(-1)}));
 }
 const resources=await page.evaluate(()=>performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/')).map(e=>({url:e.name,start:e.startTime,fetch:e.fetchStart,request:e.requestStart,headers:e.responseStart,end:e.responseEnd,transfer:e.transferSize,decoded:e.decodedBodySize,serverTiming:e.serverTiming.map(t=>({name:t.name,duration:t.duration,description:t.description}))})));
 results.push({mobile,actions,network:[...network.values()],resources,errors});await writeFile(output,JSON.stringify(results,null,2));await context.close();
 if(errors.length||actions.some(a=>a.result?.failed||(a.target==='top'&&(!a.cards||!a.renderedCards))))throw Error('Navigation failed; zero-card Smart timeout is not a successful measurement');
}}finally{await browser.close();}
