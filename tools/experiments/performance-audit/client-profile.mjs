import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {protectBrowserApiWrites} from './read-only-browser.mjs';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const samples=[],runs=Math.max(1,Math.min(32,Number(process.argv.find(value=>value.startsWith('--runs='))?.split('=')[1])||4));
const profiling=!process.argv.includes('--no-profile');
try {
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 if(process.argv.includes('--glass'))await context.addInitScript(()=>localStorage.setItem('theme','glass-light'));
 await context.addCookies([{name:'auth',value:'true',url:'http://127.0.0.1:3000'}]);
 await protectBrowserApiWrites(context);
 const page=await context.newPage(), cdp=await context.newCDPSession(page);
 const requests=[];page.on('request',request=>requests.push({at:Date.now(),path:new URL(request.url()).pathname,method:request.method()}));
 await page.goto('http://127.0.0.1:3000/#category/Forum');
 await page.waitForFunction(()=>window.Alpine && !Alpine.$data(document.body).isLoadingArticles && Alpine.$data(document.body).articles.length);
 const articleMode=process.argv.includes('--article');
 if(articleMode){
  await page.evaluate(async()=>{const app=Alpine.$data(document.body);window.auditArticle=app.articles.find(a=>a.link.includes('voz.vn'))||app.articles[0];await app.openArticleOverlay(window.auditArticle);if(!app.overlayContent)throw Error(app.overlayError||'No readable content');app.closeArticleOverlay({closeAll:true});});
  await page.waitForTimeout(400);
  await page.evaluate(()=>{
   const original=window.fetch;window.auditArticleRequests=[];
   window.fetch=(input,init)=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href),app=Alpine.$data(document.body);
    if(url.origin===location.origin&&url.pathname.startsWith('/api/'))window.auditArticleRequests.push({path:url.pathname,openedArticle:url.searchParams.get('url')===app.articleReaderUrl(window.auditArticle),prefetch:url.searchParams.get('prefetch'),live:url.searchParams.get('live'),caller:new Error().stack?.split('\n').slice(2,6)});
    return original(input,init);
   };
  });
  if(process.argv.includes('--stages'))await page.evaluate(()=>{
   const app=Alpine.$data(document.body);window.auditStages=[];
   for(const name of ['formatSourceTimeMarkup','prepareArticleSpeech','applyOverlayArticleData','recordRecentlyRead','saveState','updateArticleRoute','checkVozThreadPosition','hydrateTwitterEmbeds']){
    const original=app[name];if(typeof original!=='function')continue;
    app[name]=function(...args){const at=performance.now();try{return original.apply(this,args);}finally{window.auditStages.push({name,ms:performance.now()-at});}};
   }
  });
 }
 if(profiling){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
 if(articleMode){
  for(let i=0;i<runs;i++){
   const started=Date.now();
   const sample=await page.evaluate(async()=>{const app=Alpine.$data(document.body),at=performance.now(),cacheBefore=app.articleContentCache?.has(app.articleReaderUrl(window.auditArticle));window.auditArticleRequests=[];window.auditStages=[];const cards=[...document.querySelectorAll('.article-card')];await app.openArticleOverlay(window.auditArticle);const assigned=performance.now();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {ms:performance.now()-at,openMethodMs:assigned-at,cacheBefore,articleRequests:window.auditArticleRequests,readable:!!app.overlayContent,bytes:app.overlayContent?.length,stages:window.auditStages,reusedCards:[...document.querySelectorAll('.article-card')].filter(c=>cards.includes(c)).length,priorCards:cards.length};});
   sample.requests=requests.filter(request=>request.at>=started);samples.push(sample);console.log(JSON.stringify(sample));
   await page.evaluate(()=>Alpine.$data(document.body).closeArticleOverlay({closeAll:true}));await page.waitForTimeout(300);
  }
 }else{
 for(const i of [3,4,5]) {
 await page.evaluate(i=>Alpine.$data(document.body).setFilter('feed',Alpine.$data(document.body).feeds[i].url),i);
 await page.waitForFunction(()=>!Alpine.$data(document.body).isLoadingArticles);
 await page.waitForTimeout(500);
 }
 }
 const {profile}=profiling?await cdp.send('Profiler.stop'):{};
 if(profile)await writeFile(process.argv[2]||'/tmp/rss-audit-20261006/client-before.cpuprofile',JSON.stringify(profile));
 if(samples.length)await writeFile((process.argv[2]||'/tmp/rss-audit-20261006/client-before.cpuprofile')+'.samples.json',JSON.stringify(samples,null,2));
 if(profile){
 const times=new Map(),nodes=new Map(profile.nodes.map(n=>[n.id,n]));
 for(let i=0;i<profile.samples.length;i++) times.set(profile.samples[i],(times.get(profile.samples[i])||0)+profile.timeDeltas[i]);
 console.log(JSON.stringify([...times].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([id,us])=>({ms:us/1000,...nodes.get(id).callFrame})),null,2));
 }
}finally{await browser.close();}
