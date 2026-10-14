import {chromium,webkit,devices} from 'playwright';
import {writeFile,readFile} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
const output=process.argv[2],isWebkit=process.argv.includes('--webkit');
const server=await startFixtureServer(),browser=await (isWebkit?webkit:chromium).launch({headless:true,...(isWebkit?{}:{args:['--no-sandbox']})});const rows=[];
try{for(const theme of ['classic','glass-light']){
 const context=await browser.newContext(isWebkit?{...devices['iPhone 13']}:{viewport:{width:1440,height:900}});
 await context.addCookies([{name:'auth',value:'true',url:server.url}]);await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
 await context.addInitScript(()=>{window.__transitionRejections=[];addEventListener('unhandledrejection',event=>window.__transitionRejections.push({cancelled:event.reason?.isFromCancelledTransition===true}));});
 if(process.argv.includes('--baseline')){const body=await readFile('/tmp/rss-flicker-20261014/before.js','utf8');await context.route('**/script.js*',r=>r.fulfill({contentType:'text/javascript',body}));}
 let stage='startup';const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push({stage,message:e.message,stack:e.stack}));await page.goto(server.url);
 await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).articles.length);
 await page.evaluate(async()=>{const m=await import('/public/js/ui/flicker-diagnostics.js');m.installFlickerDiagnostics();});
 stage='race';const race=await page.evaluate(async()=>{
  const app=Alpine.$data(document.body),original=window.fetch,fixture=JSON.parse(JSON.stringify(app.articles)),pending=new Map();
  window.fetch=(url,...rest)=>String(url).startsWith('/api/data?')?new Promise(resolve=>pending.set(new URL(url,location.href).searchParams.get('filterValue'),resolve)):original(url,...rest);
  try{
   app.setFilter('feed','old');app.setFilter('feed','current');
   pending.get('current')(new Response(JSON.stringify({articles:fixture.map(a=>({...a,title:'CURRENT '+a.title})),hasMore:false})));
   while(app.isLoadingArticles)await new Promise(r=>setTimeout(r,10));await new Promise(r=>requestAnimationFrame(r));
   const before=[...document.querySelectorAll('.article-card')];
   pending.get('old')(new Response(JSON.stringify({articles:fixture.map(a=>({...a,title:'OBSOLETE '+a.title})),hasMore:false})));
   await new Promise(r=>setTimeout(r,200));
   const cards=[...document.querySelectorAll('.article-card')];
   return {destination:app.selectedFilterValue,correct:app.articles.every(a=>a.title.startsWith('CURRENT')),reused:cards.filter(c=>before.includes(c)).length,cards:cards.length};
  }finally{window.fetch=original;}
 });
 if(!race.correct||race.destination!=='current'||race.reused!==8)throw Error('Stale feed response applied');
 await page.evaluate(()=>Alpine.$data(document.body).setFilter('smart','news_vietnam'));await page.waitForFunction(()=>!Alpine.$data(document.body).isLoadingArticles);
 stage='idle';const idle=await page.evaluate(async(short)=>{
  const app=Alpine.$data(document.body),cards=[...document.querySelectorAll('.article-card')],before=document.querySelectorAll('*').length;
  let replacements=0;
  // Controlled automatic updates with no pointer/keyboard input, over one minute.
  for(let i=0;i<12;i++){await new Promise(r=>setTimeout(r,short?100:5000));await app.fetchData(false,true,true);await new Promise(r=>requestAnimationFrame(r));replacements+=[...document.querySelectorAll('.article-card')].filter(c=>!cards.includes(c)).length;}
  return {seconds:short?1.2:60,replacements,domBefore:before,domAfter:document.querySelectorAll('*').length};
 },process.argv.includes('--short'));
 stage='article-loop';const lifecycle=await page.evaluate(async(sameTask)=>{
  const app=Alpine.$data(document.body),cards=[...document.querySelectorAll('.article-card')],sc=document.getElementById('scroll-container');
  for(let i=0;i<5;i++){sc.scrollTop=sc.scrollHeight;await app.fetchData(false,true,true);sc.scrollTop=0;await app.openArticleOverlay(app.articles[0]);if(!sameTask)await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));app.closeArticleOverlay({closeAll:true});if(!sameTask)await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  return {reused:[...document.querySelectorAll('.article-card')].filter(c=>cards.includes(c)).length,overlayClosed:!app.articleOverlayOpen,rejections:window.__transitionRejections};
 },process.argv.includes('--same-task'));
 stage='resize';await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);
 const diagnostic=await page.evaluate(()=>{const d=window.__readerFlicker;d.mark();const evidence=d.export();d.stop();return {events:evidence.events,capacity:evidence.capacity,stopped:!window.__readerFlicker};});
 await writeFile(output+'.last.json',JSON.stringify({theme,race,idle,lifecycle,diagnostic,errors},null,2));
 if((!process.argv.includes('--baseline')&&(idle.replacements||lifecycle.reused!==8))||!lifecycle.overlayClosed||errors.length)throw Error(JSON.stringify({idle,lifecycle,errors}));
 rows.push({theme,engine:isWebkit?'Linux WebKit':'Chromium',race,idle,lifecycle,diagnostic,errors});await writeFile(output,JSON.stringify(rows,null,2));console.log(JSON.stringify({theme,race,idle,lifecycle,events:diagnostic.events.length,errors}));await context.close();
}}finally{await browser.close();server.close();}
