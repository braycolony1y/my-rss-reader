import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
const dir=process.argv[2],layout=process.argv.includes('--layout'),runtime=process.argv.includes('--runtime'),mutations=process.argv.includes('--mutations');
const theme=process.argv.includes('--classic')?'classic':'glass-light';
const focus=process.argv.includes('--focus');
const trace=process.argv.includes('--trace');
const stem=runtime?'runtime':layout?'card-image-layout':'image-focus';
const before=await readFile(dir+'/'+stem+'-before.js','utf8');
const candidate=layout||runtime||mutations||focus?await readFile(dir+'/'+stem+'-candidate.js','utf8'):null;
const label=runtime?'runtime-'+theme:focus?'focus-'+theme:mutations?'mutations-'+theme:layout?'layout-update':'image-update';
const resultPath=dir+'/'+label+(trace?'-trace':'')+'-replay.json';
const photo=await readFile(new URL('../../../public/default.jpg',import.meta.url));
// Reuse the existing frozen fixture; this experiment never exports live data.
const payloads=JSON.parse(await readFile(process.env.READER_REPLAY_PAYLOADS||dir+'/navigation-payloads.json','utf8'));
const server=await startFixtureServer({transformResponse:(value,url)=>url.pathname==='/api/image-focus'?{x:.7,y:.4,type:'saliency'}:url.pathname==='/api/data'?{...payloads[url.searchParams.get('filterType')==='smart'?'top':'feed'],articles:payloads[url.searchParams.get('filterType')==='smart'?'top':'feed'].articles.slice(0,40)}:value});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),rows=[];
try {
 for(const variant of (trace?['before','after']:['before','after','after','before'])) {
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.addCookies([{name:'auth',value:'true',url:server.url}]);
  await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
  await context.route('**/*',route=>route.request().resourceType()==='image'?route.fulfill({contentType:'image/jpeg',body:photo}):route.fallback());
  if(runtime)await context.route('**/public/top-story-card/blend/runtime.js*',r=>r.fulfill({contentType:'text/javascript',body:variant==='before'?before:candidate}));
  else if(layout)await context.route('**/public/card-image-layout.js*',r=>r.fulfill({contentType:'text/javascript',body:variant==='before'?before:candidate}));
  else if(focus)await context.route('**/public/image-focus.js*',r=>r.fulfill({contentType:'text/javascript',body:variant==='before'?before:candidate}));
  else if(mutations){
   await context.route('**/public/image-focus.js*',r=>r.fulfill({contentType:'text/javascript',body:variant==='before'?before:candidate}));
   const body=await readFile(dir+'/mutations-'+(variant==='before'?'before':'candidate')+'.js','utf8');
   await context.route('**/public/image-focus-mutations.js*',r=>r.fulfill({contentType:'text/javascript',body}));
  }
  else if(variant==='before')await context.route('**/public/image-focus.js*',r=>r.fulfill({contentType:'text/javascript',body:before}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).articles.length);
  const cdp=trace?await context.newCDPSession(page):null;
  const finished=cdp&&new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
  if(cdp)await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline',transferMode:'ReturnAsStream'});
  for(let i=0;i<(trace?2:8);i++) {
   const sample=await page.evaluate(async i=>{
    const app=Alpine.$data(document.body),at=performance.now();app.setFilter(i%2?'smart':'feed',i%2?'tech_vietnam':'fixture');
    while(app.isLoadingArticles)await new Promise(r=>setTimeout(r,5));
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return {mode:i%2?'top':'feed',ms:performance.now()-at};
   },i);
   await page.waitForTimeout(300);
   const geometry=await page.evaluate(()=>[...document.querySelectorAll('.article-card')].map(c=>{const r=c.getBoundingClientRect(),img=c.querySelector('.thumbnail-img'),ir=img?.getBoundingClientRect();return [r.x,r.y,r.width,r.height,ir?.x,ir?.y,ir?.width,ir?.height,img&&getComputedStyle(img).objectPosition];}));
   rows.push({variant,...sample,geometry,errors});await writeFile(resultPath,JSON.stringify(rows));console.log(JSON.stringify({variant,...sample}));
  }
  if(cdp){
   await cdp.send('Tracing.end');const {stream}=await finished;let raw='';
   for(;;){const part=await cdp.send('IO.read',{handle:stream});raw+=part.data;if(part.eof)break;}
   await cdp.send('IO.close',{handle:stream});
   const events=JSON.parse(raw).traceEvents,main=events.find(e=>e.name==='thread_name'&&e.args?.name==='CrRendererMain');
   const totals={};
   for(const e of events)if(e.ph==='X'&&e.pid===main?.pid&&e.tid===main?.tid){const row=totals[e.name]||={count:0,ms:0};row.count++;row.ms+=(e.dur||0)/1000;}
   rows.at(-1).trace=totals;
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
  rows.at(-1).settled=settled;await writeFile(resultPath,JSON.stringify(rows));
  rows.at(-1).styles=await page.evaluate(()=>[...document.querySelectorAll('.article-card')].map(card=>{
   const img=card.querySelector('.thumbnail-img'),hero=card.querySelector('.article-card-image');
   return [card,img,hero].map(node=>{if(!node)return null;const s=getComputedStyle(node);return [s.objectFit,s.objectPosition,s.maskImage,s.backgroundColor,s.filter,s.opacity,...['--hero-pos','--mask-h','--mask-v','--fy','--smart-hero-height'].map(k=>s.getPropertyValue(k))];});
  }));
  await writeFile(resultPath,JSON.stringify(rows));
  await page.screenshot({path:dir+'/'+label+'-'+variant+'.png'});
  await context.close();
 }
}finally{await browser.close();server.close();}
