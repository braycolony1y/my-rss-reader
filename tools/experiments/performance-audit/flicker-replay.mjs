// Controlled production-component replay. All API state and images are fixtures.
import {chromium, webkit, devices} from 'playwright';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
const output=process.argv[2] || '/tmp/rss-flicker-20261014';
await mkdir(output,{recursive:true});
const engine=process.argv.includes('--webkit')?'webkit':'chromium';
const baseline=process.argv.includes('--baseline');
const readBaseline=baseline?await readFile('/tmp/rss-flicker-20261014/before.js','utf8'):null;
const server=await startFixtureServer();
const browser=await (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}:{})});
const rows=[];
try {
 for(const mobile of (engine==='webkit'?[true]:process.argv.includes('--desktop')?[false]:[false,true])) for(const theme of ['classic','glass-light']) {
  const context=await browser.newContext(mobile?{...devices['iPhone 13']}:{viewport:{width:1440,height:900}});
  await context.addCookies([{name:'auth',value:'true',url:server.url}]);
  await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
  if(baseline)await context.route('**/script.js*',r=>r.fulfill({contentType:'text/javascript',body:readBaseline}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.url);
  await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).articles.length);
  await page.waitForTimeout(800);
  for(const mode of ['top','feed']) {
   await page.evaluate(mode=>Alpine.$data(document.body).setFilter(mode==='top'?'smart':'feed',mode==='top'?'news_vietnam':'https://example.test/feed'),mode);
   await page.waitForFunction(()=>!Alpine.$data(document.body).isLoadingArticles);
   await page.waitForTimeout(500);
   const prefix=`${output}/${engine}-${mobile?'mobile':'desktop'}-${theme}-${mode}-${baseline?'before':'after'}`;
   await page.screenshot({path:prefix+'-before.png'});
   const cdp=engine==='chromium'?await context.newCDPSession(page):null;
   const film=[];
   if(cdp){await cdp.send('Performance.enable');if(process.argv.includes('--filmstrip')){cdp.on('Page.screencastFrame',event=>{if(film.length<30)film.push(event);void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});});await cdp.send('Page.startScreencast',{format:'png',maxWidth:1440,maxHeight:900,everyNthFrame:1});}}
   if(cdp&&process.argv.includes('--trace'))await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,blink.user_timing,disabled-by-default-devtools.timeline.frame',transferMode:'ReturnAsStream'});
   const startMetrics=cdp?await cdp.send('Performance.getMetrics'):null;
   const sample=await page.evaluate(async()=>{
    const app=Alpine.$data(document.body),old=[...document.querySelectorAll('.article-card')],frames=[];
    const start=performance.now();let done=false,removed=0,inserted=0;
    const observer=new MutationObserver(records=>{for(const r of records)for(const [nodes,kind] of [[r.removedNodes,'remove'],[r.addedNodes,'add']])for(const n of nodes){const count=(n.matches?.('.article-card')?1:0)+(n.querySelectorAll?.('.article-card').length||0);if(kind==='remove')removed+=count;else inserted+=count;}});
    observer.observe(document.getElementById('scroll-container'),{childList:true,subtree:true});
    function frame(){const cards=[...document.querySelectorAll('.article-card')];frames.push({at:performance.now()-start,count:cards.length,reused:cards.filter(c=>old.includes(c)).length,identities:cards.map(c=>Alpine.$data(c).article?.id),images:cards.map(c=>{const i=c.querySelector('.thumbnail-img');return [i?.getAttribute('src'),i?.complete,i?.dataset.focusState];}),boxes:cards.map(c=>{const r=c.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}),scroll:document.getElementById('scroll-container').scrollTop});if(!done)requestAnimationFrame(frame);}
    requestAnimationFrame(frame);
    await app.fetchData(false,true,true);const methodMs=performance.now()-start;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const stableMs=performance.now()-start;
    await new Promise(r=>setTimeout(r,600));done=true;observer.disconnect();
    return {ms:performance.now()-start,methodMs,stableMs,removed,inserted,frames};
   });
   if(cdp){const end=await cdp.send('Performance.getMetrics'),start=new Map(startMetrics.metrics.map(r=>[r.name,r.value]));sample.browser=Object.fromEntries(end.metrics.filter(r=>['LayoutCount','RecalcStyleCount','LayoutDuration','RecalcStyleDuration','ScriptDuration','TaskDuration'].includes(r.name)).map(r=>[r.name,r.value-start.get(r.name)]));if(process.argv.includes('--filmstrip'))await cdp.send('Page.stopScreencast');if(process.argv.includes('--trace')){const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');const {stream}=await complete;let trace='';while(true){const chunk=await cdp.send('IO.read',{handle:stream});trace+=chunk.data;if(chunk.eof)break;}await cdp.send('IO.close',{handle:stream});await writeFile(prefix+'-trace.json',trace);}await cdp.detach();}
   for(let i=0;i<film.length;i++)await writeFile(prefix+'-frame-'+i+'.png',Buffer.from(film[i].data,'base64'));
   sample.filmstrip=film.map((f,index)=>({index,...f.metadata}));
   await page.screenshot({path:prefix+'-settled.png'});
   if(!baseline&&(sample.removed||sample.inserted||sample.frames.some(f=>f.count!==8||f.reused!==8)||errors.length))throw Error('Card identity regression: '+JSON.stringify({theme,mode,removed:sample.removed,inserted:sample.inserted,errors}));
   rows.push({engine,mobile,theme,mode,baseline,errors,...sample});
   console.log(JSON.stringify({engine,mobile,theme,mode,baseline,removed:sample.removed,inserted:sample.inserted,frames:sample.frames.length,errors}));
  }
  await context.close();
 }
}finally {await browser.close();server.close();await writeFile(`${output}/${engine}-${baseline?'baseline':'candidate'}.json`,JSON.stringify(rows,null,2));}
