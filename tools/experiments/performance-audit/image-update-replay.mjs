import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
const dir=process.argv[2],before=await readFile(dir+'/image-focus-before.js','utf8');
const photo=await readFile(new URL('../../../public/default.jpg',import.meta.url));
// Reuse the existing frozen fixture; this experiment never exports live data.
const payloads=JSON.parse(await readFile(dir+'/navigation-payloads.json','utf8'));
const server=await startFixtureServer({transformResponse:(value,url)=>url.pathname==='/api/image-focus'?{x:.7,y:.4,type:'saliency'}:url.pathname==='/api/data'?{...payloads[url.searchParams.get('filterType')==='smart'?'top':'feed'],articles:payloads[url.searchParams.get('filterType')==='smart'?'top':'feed'].articles.slice(0,40)}:value});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),rows=[];
try {
 for(const variant of ['before','after','after','before']) {
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.addCookies([{name:'auth',value:'true',url:server.url}]);
  await context.addInitScript(()=>localStorage.setItem('theme','glass-light'));
  await context.route('**/*',route=>route.request().resourceType()==='image'?route.fulfill({contentType:'image/jpeg',body:photo}):route.fallback());
  if(variant==='before')await context.route('**/public/image-focus.js*',r=>r.fulfill({contentType:'text/javascript',body:before}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).articles.length);
  for(let i=0;i<8;i++) {
   const sample=await page.evaluate(async i=>{
    const app=Alpine.$data(document.body),at=performance.now();app.setFilter(i%2?'smart':'feed',i%2?'tech_vietnam':'fixture');
    while(app.isLoadingArticles)await new Promise(r=>setTimeout(r,5));
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return {mode:i%2?'top':'feed',ms:performance.now()-at};
   },i);
   await page.waitForTimeout(300);
   const geometry=await page.evaluate(()=>[...document.querySelectorAll('.article-card')].map(c=>{const r=c.getBoundingClientRect(),img=c.querySelector('.thumbnail-img'),ir=img?.getBoundingClientRect();return [r.x,r.y,r.width,r.height,ir?.x,ir?.y,ir?.width,ir?.height,img&&getComputedStyle(img).objectPosition];}));
   rows.push({variant,...sample,geometry,errors});await writeFile(dir+'/image-update-replay.json',JSON.stringify(rows));console.log(JSON.stringify({variant,...sample}));
  }
  // Visit every row before checking final geometry: offscreen photo work is
  // intentionally deferred, but scroll layout and the visible result must match.
  await page.evaluate(async()=>{
   const sc=document.getElementById('scroll-container');
   for(let y=0;y<sc.scrollHeight;y+=500){sc.scrollTo(0,y);await new Promise(r=>setTimeout(r,80));}
   sc.scrollTo(0,0);
  });
  await page.waitForTimeout(3000);
  const settled=await page.evaluate(()=>[...document.querySelectorAll('.article-card')].map(c=>{const r=c.getBoundingClientRect(),i=c.querySelector('.thumbnail-img'),q=i?.getBoundingClientRect();return [r.x,r.y,r.width,r.height,q?.x,q?.y,q?.width,q?.height,i&&getComputedStyle(i).objectPosition];}));
  rows.at(-1).settled=settled;await writeFile(dir+'/image-update-replay.json',JSON.stringify(rows));
  await page.screenshot({path:dir+'/visibility-'+variant+'.png'});
  await context.close();
 }
}finally{await browser.close();server.close();}
