// Uses the existing production fixture renderer; no live content is captured.
import {chromium,webkit,devices} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
import {createReaderAssetRenderer} from '../../../src/ui/reader-assets.js';
const output=process.argv[2];
const metrics=process.argv.includes('--metrics');
const visual=process.argv.includes('--visual');
const expression='return refreshed ? { ...existing, ...refreshed } : existing;';
const before=(await createReaderAssetRenderer().script()).replace('return refreshed ? Object.assign(existing, refreshed) : existing;',expression);
if(!before.includes(expression))throw Error('Revalidation baseline not found');
const after=before.replace(expression,'return refreshed ? Object.assign(existing, refreshed) : existing;');
const changes=process.argv.includes('--changes');let revision=0;
const server=await startFixtureServer({imageDelayMs:10,transformResponse:(value,url)=>changes&&url.pathname==='/api/data'
 ? {...value,articles:value.articles.map(a=>({...a,title:a.title+' revision '+revision,image:'/public/default.jpg?revision='+revision}))}:value});
const mobile=process.argv.includes('--webkit');
const browser=await (mobile?webkit:chromium).launch({headless:true,...(mobile?{}:{args:['--no-sandbox']})}),rows=[];
try {
 for(const theme of ['classic','glass-light'])for(const variant of (visual?['before','after']:['before','after','after','before'])) {
  revision=0;
  const context=await browser.newContext(mobile?{...devices['iPhone 13']}:{viewport:{width:1440,height:900}});
  await context.addCookies([{name:'auth',value:'true',url:server.url}]);
  await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
  await context.route('**/script.js*',r=>r.fulfill({contentType:'text/javascript',body:variant==='before'?before:after}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cdp=metrics?await context.newCDPSession(page):null;
  if(cdp)await cdp.send('Performance.enable');
  await page.goto(server.url);
  await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).articles.length);
  await page.evaluate(()=>Alpine.$data(document.body).setFilter('feed','https://example.test/feed'));
  await page.waitForFunction(()=>!Alpine.$data(document.body).isLoadingArticles);
  await page.waitForTimeout(500);
  for(let i=0;i<(visual?1:4);i++) {
   revision++;
   const startMetrics=cdp?await cdp.send('Performance.getMetrics'):null;
   const sample=await page.evaluate(async()=>{
    const app=Alpine.$data(document.body),cards=[...document.querySelectorAll('.article-card')];
    const start=performance.now();await app.fetchData(false,true,true);const method=performance.now()-start;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const current=[...document.querySelectorAll('.article-card')];
    return {ms:performance.now()-start,method,cards:current.length,reused:current.filter(c=>cards.includes(c)).length,
     geometry:current.map(c=>{const r=c.getBoundingClientRect();return [r.x,r.y,r.width,r.height,c.querySelector('h2')?.textContent];}),
     images:current.map(c=>c.querySelector('.thumbnail-img')?.getAttribute('data-thumbnail-src')),
     styles:current.map(c=>[c,c.querySelector('.thumbnail-img'),c.querySelector('.article-card-image')].map(node=>{
      const s=getComputedStyle(node);return [s.objectFit,s.objectPosition,s.maskImage,s.backgroundColor,s.opacity,s.filter,s.getPropertyValue('--hero-pos')];
     }))};
   });
   if(!sample.cards||errors.length)throw Error('Invalid revalidation: '+errors.join('; '));
   if(changes&&(!sample.geometry.every(c=>c[4].includes('revision '+revision))||!sample.images.every(src=>src.includes('revision='+revision))))throw Error('Stale refreshed title or image');
   if(cdp){const end=await cdp.send('Performance.getMetrics'),start=new Map(startMetrics.metrics.map(r=>[r.name,r.value]));sample.browser=Object.fromEntries(end.metrics.filter(r=>['LayoutCount','RecalcStyleCount','LayoutDuration','RecalcStyleDuration','ScriptDuration','TaskDuration'].includes(r.name)).map(r=>[r.name,r.value-start.get(r.name)]));}
   rows.push({theme,variant,...sample});await writeFile(output,JSON.stringify(rows,null,2));
   console.log(JSON.stringify({theme,variant,ms:sample.ms,reused:sample.reused,cards:sample.cards}));
   await page.waitForTimeout(200);
  }
  if(visual){
   await page.waitForFunction(()=>[...document.querySelectorAll('.article-card')].filter(c=>{const r=c.getBoundingClientRect();return r.bottom>130&&r.top<innerHeight;}).every(c=>{const img=c.querySelector('.thumbnail-img');return img.complete&&img.naturalWidth>0&&img.dataset.focusState==='ready';}));
   await page.waitForTimeout(500);
  }
  await page.screenshot({path:output+'-'+theme+'-'+variant+'.png'});
  await context.close();
 }
}finally{await browser.close();server.close();}
