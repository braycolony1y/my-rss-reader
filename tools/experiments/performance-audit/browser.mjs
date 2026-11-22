import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const base = process.env.READER_URL || 'http://127.0.0.1:3000';
const output = process.argv[2] || '/tmp/rss-audit-20261006/browser.json';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const reports = [];
try {
 for (const mobile of [false,true]) {
  const context = await browser.newContext({ viewport: {width:mobile?390:1440,height:900}, isMobile:mobile, hasTouch:mobile });
  await context.addCookies([{name:'auth',value:'true',url:base}]);
  // Avoid changing the user's read, saved, preference or AI state during measurements.
  await context.route('**/api/**', route => route.request().method() === 'GET' ? route.continue() : route.fulfill({status:200,contentType:'application/json',body:'{}'}));
  await context.addInitScript(() => {
   window.auditLongTasks=[];
   new PerformanceObserver(list=>window.auditLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
  });
  const page=await context.newPage(), errors=[], requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/api/')) requests.push({url:r.url().replace(/requestId=[^&]+/,'requestId=ID'),method:r.method(),at:Date.now()});});
  await page.goto(base+'/#category/Forum',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.Alpine && Alpine.$data(document.body).articles?.length && !Alpine.$data(document.body).isLoadingArticles,{timeout:90000});
  const initial=await page.evaluate(()=>({usefulMs:performance.now(),cards:document.querySelectorAll('.article-card').length,dom:document.querySelectorAll('*').length,heap:performance.memory?.usedJSHeapSize}));
  const actions=[];
  for(let i=0;i<6;i++) {
   actions.push(await page.evaluate(async i=>{
    const app=Alpine.$data(document.body), start=performance.now();
    const feed=app.feeds[i%app.feeds.length];
    app.setFilter('feed',feed.url);
    while(app.isLoadingArticles) await new Promise(r=>setTimeout(r,10));
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return {metric:'FEED_OPEN_MS',ms:performance.now()-start,feed:feed.title,cards:document.querySelectorAll('.article-card').length};
   },i));
  }
  await page.evaluate(()=>Alpine.$data(document.body).setFilter('category','Forum'));
  await page.waitForFunction(()=>!Alpine.$data(document.body).isLoadingArticles && Alpine.$data(document.body).articles.length);
  const candidate=await page.evaluate(()=>Alpine.$data(document.body).articles.find(a=>a.link.includes('voz.vn')) || Alpine.$data(document.body).articles[0]);
  for(let i=0;i<3;i++) {
   actions.push(await page.evaluate(async ({candidate,i})=>{
    const app=Alpine.$data(document.body), start=performance.now();
    await app.openArticleOverlay(candidate);
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return {metric:i?'CACHED_ARTICLE_OPEN_MS':'ARTICLE_OPEN_MS',ms:performance.now()-start,readable:!!app.overlayContent,error:app.overlayError,contentBytes:app.overlayContent?.length};
   },{candidate,i}));
   actions.push(await page.evaluate(async()=>{
    const start=performance.now(); Alpine.$data(document.body).closeArticleOverlay({closeAll:true});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return {metric:'NAVIGATION_BACK_MS',ms:performance.now()-start};
   }));
  }
  actions.push(await page.evaluate(async()=>{
   const app=Alpine.$data(document.body),start=performance.now(); app.setFilter('smart','tech_vietnam');
   while(app.isLoadingArticles) await new Promise(r=>setTimeout(r,10));
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   return {metric:'SMART_TOP_OPEN_MS',ms:performance.now()-start,cards:document.querySelectorAll('.article-card').length};
  }));
  const final=await page.evaluate(()=>({longTasks:window.auditLongTasks,dom:document.querySelectorAll('*').length,heap:performance.memory?.usedJSHeapSize,clientCacheEntries:Alpine.$data(document.body).articleContentCache?.size,resources:performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/')).map(e=>({url:e.name,ttfb:e.responseStart-e.startTime,duration:e.duration,transfer:e.transferSize,bytes:e.decodedBodySize}))}));
  reports.push({mobile,engine:'Chromium (mobile emulation, not WebKit)',initial,actions,final,errors,requests});
  await writeFile(output,JSON.stringify(reports,null,2));
  console.log(JSON.stringify({mobile,initial,actions,errors,longTasks:final.longTasks.length}));
  await context.close();
 }
} finally {await browser.close();}
