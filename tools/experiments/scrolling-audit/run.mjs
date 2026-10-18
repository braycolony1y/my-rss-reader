import { chromium, webkit } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { installScrollProbe, sampleScroll } from './probe.mjs';
import { startScrollFixture } from './fixture.mjs';
const root=process.argv[2],output=process.argv[3],engine=process.env.ENGINE||'chromium';
if(!root||!output)throw Error('Usage: node run.mjs SOURCE_ROOT OUTPUT_DIRECTORY');
const server=await startScrollFixture(root,{count:Number(process.env.CARDS)||40,imageDelay:Number(process.env.IMAGE_DELAY)||50,focusDelay:Number(process.env.FOCUS_DELAY)||20});
await mkdir(output,{recursive:true});
const browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'?{args:['--no-sandbox']}:(process.env.WEBKIT_EXECUTABLE?{executablePath:process.env.WEBKIT_EXECUTABLE}:{}))});
const cases=process.env.CASES?.split(',')||['1440:glass-light:top','390:glass-light:top','1440:glass-light:feed','390:glass-light:feed'];
const rows=[];
try{
 for(const key of cases){
  const requestOffset=server.network.requests.length;server.network.peak=server.network.active;
  const [w,theme,mode]=key.split(':'),width=Number(w),diagnostic=process.env.DIAGNOSTIC==='1',trace=process.env.TRACE==='1';
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<768,hasTouch:width<768,deviceScaleFactor:1});
  await context.addCookies([{name:'auth',value:'true',url:server.url}]);
  await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
  await context.addInitScript(installScrollProbe,{observers:diagnostic});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(30000);
  console.log('starting '+key);
  await page.goto(server.url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).articles.length,{},{timeout:30000});
  await page.evaluate(mode=>Alpine.$data(document.body).setFilter(mode==='feed'?'feed':'smart',mode==='feed'?'https://example.test/feed':'news_vietnam'),mode);
  await page.waitForFunction(()=>!Alpine.$data(document.body).isLoadingArticles);
  if(mode==='classic'){
   await page.evaluate(()=>Alpine.$data(document.body).setSmartTabMode('classic'));
   await page.waitForTimeout(500);
  }
  await page.waitForTimeout(800);
  if(process.env.WARM==='1'){
   // Warm bytes without changing admission state or forcing offscreen img.src.
   await page.evaluate(async()=>{for(const img of document.querySelectorAll('.thumbnail-img')){const source=img.getAttribute('data-thumbnail-src');if(source)await(await fetch(source)).blob();}});
   await page.waitForTimeout(500);
  }
  const name=key.replaceAll(':','-'),cdp=engine==='chromium'?await context.newCDPSession(page):null;
  await page.screenshot({path:`${output}/${name}-before.png`});
  if(cdp)await cdp.send('Performance.enable');
  if(trace)await cdp?.send('Tracing.start',{categories:'devtools.timeline,v8,blink.user_timing,disabled-by-default-devtools.timeline.frame',transferMode:'ReturnAsStream'});
  const before=cdp?await cdp.send('Performance.getMetrics'):null;
  const scrollRequestOffset=server.network.requests.length;
  await page.evaluate(()=>{for(const key of ['callbacks','mutations','events','longTasks','shifts'])window.__scrollProbe[key]=key==='callbacks'?{}:[];});
  const result=await page.evaluate(sampleScroll,{duration:Number(process.env.DURATION)||8000,diagnostic,distance:Number(process.env.DISTANCE)||7000});
  if(cdp){const after=await cdp.send('Performance.getMetrics'),prior=new Map(before.metrics.map(x=>[x.name,x.value]));result.browser=Object.fromEntries(after.metrics.filter(x=>/Duration|HeapUsedSize|Nodes|LayoutCount|RecalcStyleCount/.test(x.name)).map(x=>[x.name,x.value-(prior.get(x.name)||0)]));
   if(trace){const complete=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');const {stream}=await complete;let data='';while(true){const c=await cdp.send('IO.read',{handle:stream});data+=c.data;if(c.eof)break;}await cdp.send('IO.close',{handle:stream});await writeFile(`${output}/${name}-trace.json`,data);}
  }
  await page.screenshot({path:`${output}/${name}-after.png`});
  rows.push({key,engine,version:browser.version(),warmHttpCache:process.env.WARM==='1',diagnostic,trace,errors,network:JSON.parse(JSON.stringify({...server.network,requests:server.network.requests.slice(requestOffset),requestsDuringScroll:server.network.requests.slice(scrollRequestOffset)})),...result});
  await writeFile(`${output}/results.json`,JSON.stringify(rows));
  console.log(JSON.stringify({key,engine,avg:result.avg,p95:result.p95,p99:result.p99,over33:result.over33,disappeared:result.disappeared.length,mutations:result.mutations.length,callbacks:result.callbacks,browser:result.browser,errors}));
  await context.close();
 }
}finally{await browser.close();server.close();}
