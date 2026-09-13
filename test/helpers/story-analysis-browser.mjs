import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const script=await fs.readFile(path.join(root,'script.js'),'utf8');
let html=(await fs.readFile(path.join(root,'index.html'),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const labels=['Why it matters','What changed','Timeline','What to watch','Market impact','Who is affected','What to do','Background / Context','Upgrade compatibility'];
const base={link:'https://example.invalid/story',title:'Synthetic example: vendor fixes router vulnerability',feedTitle:'Synthetic source',image:'/public/default.jpg',feedIcon:'/public/default.jpg',content:'Source excerpt.',pubDate:new Date().toISOString(),isCluster:true,sourceCount:1,relatedArticles:[],clusterId:'top',topStory:{rank:1,isTop:true,feed:'tech_world',timeline:[{id:'one',date:'2026-09-12T10:00:00Z',text:'Initial report',sources:[]},{id:'two',date:'2026-09-13T10:00:00Z',text:'Patch released',sources:[]}]},briefing:{status:'ready',analysisStatus:'evaluated',analysisVersion:2,analysisReview:labels.map(label=>({label,useful:true,reason:'Useful fixture section'})),sections:[{label:'What happened',text:'A fictional vendor fixed a router vulnerability. Users should install the update.'},...labels.map(label=>({label,text:`${label}: supported fixture analysis.`,citations:[]}))]}};
const fixtureScript=`const originalApp=rssApp;rssApp=()=>{const app=originalApp();Object.assign(app,{theme:'glass-light',isLoggedIn:true,selectedFilterType:'smart',selectedFilterValue:'tech',smartTabMode:'top',isLoadingArticles:false,articles:${JSON.stringify([base,{...base,clusterId:'more',link:'https://example.invalid/more',topStory:{...base.topStory,rank:2,isTop:false}}])}});app.initApp=function(){};app.fetchData=async function(){};return app;};`;
html=html.replace('</body>',()=>`<script src="/fixture-app.js"></script><script>${fixtureScript}</script><script src="https://cdn.jsdelivr.net/npm/@alpinejs/collapse@3.x.x/dist/cdn.min.js"></script><script src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script></body>`);
const server=http.createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);}else if(req.url==='/fixture-app.js'){res.setHeader('Content-Type','text/javascript');res.end(script);}else if(req.url.startsWith('/public/')){res.setHeader('Content-Type',req.url.includes('.css')?'text/css':'image/jpeg');res.end(await fs.readFile(root+req.url.split('?')[0]));}else{res.setHeader('Content-Type','application/json');res.end('{}');}}catch{res.statusCode=404;res.end();}}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH || '/snap/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1440,height:1100});await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle2'});await page.waitForSelector('.has-story-briefing');
 const panels=()=>page.$$eval('.has-story-briefing .top-story-section',els=>els.filter(e=>getComputedStyle(e).display!=='none').length);
 for(const [name,width] of [['desktop',1440],['mobile',390]]){
  await page.setViewport({width,height:1100});await page.evaluate(width=>{const app=Alpine.$data(document.body);app.isMobile=width<768;app.storyAnalysisOpen={};},width);await new Promise(r=>setTimeout(r,350));
  assert.equal(await panels(),0);
  const rails=await page.$$eval('.has-story-briefing .story-tab-rail',els=>els.map(e=>({count:e.querySelectorAll('button').length,wrap:getComputedStyle(e).flexWrap,overflow:getComputedStyle(e).overflowX,width:e.clientWidth,scrollWidth:e.scrollWidth})));
  assert.equal(rails.length,2);assert.ok(rails.every(r=>r.count===9&&r.wrap==='nowrap'&&r.overflow==='auto'));if(width===390)assert.ok(rails.every(r=>r.scrollWidth>r.width));
  await fs.mkdir(path.join(root,'test/fixtures/generated'),{recursive:true});await page.screenshot({path:path.join(root,`test/fixtures/generated/analysis-tabs-${name}.png`)});
  const buttons=await page.$$('.has-story-briefing .story-tab-rail button');
  const waitForSection = async (cardIndex,label) => page.waitForFunction((index,label)=>{
    const card=document.querySelectorAll('.has-story-briefing')[index];
    const visible=[...card.querySelectorAll('.top-story-section')].filter(e=>getComputedStyle(e).display!=='none');
    return label ? visible.length===1 && visible[0].textContent.includes(label) : visible.length===0;
  },{timeout:5000},cardIndex,label);
  await buttons[0].asLocator().click();await waitForSection(0,'Why it matters');assert.equal(await panels(),1);
  await buttons[1].asLocator().click();await waitForSection(0,'What changed');assert.equal(await panels(),1);
  await buttons[1].asLocator().click();await waitForSection(0,null);assert.equal(await panels(),0);
  await buttons[17].asLocator().click();await waitForSection(1,'Upgrade compatibility');assert.equal(await panels(),1);
  await page.evaluate(()=>{const app=Alpine.$data(document.body);app.smartTabMode='classic';});
  assert.equal(await page.$$eval('.has-story-briefing',els=>els.length),0);
  await page.evaluate(()=>{Alpine.$data(document.body).smartTabMode='top';});
 }
 await page.evaluate(()=>{
   const app=Alpine.$data(document.body);app.storyAnalysisOpen={};
   window.__readyBriefing=JSON.parse(JSON.stringify(app.articles[0].briefing));
   app.articles[0].briefing={analysisStatus:'pending',generationState:'queued',queueAhead:2,sections:[]};
 });
 await page.waitForFunction(()=>document.querySelector('.has-story-briefing [role="status"]').textContent.includes('2 ahead'));
 await page.waitForFunction(()=>[...document.querySelectorAll('.has-story-briefing .top-story-section')].every(e=>getComputedStyle(e).display==='none'));
 assert.equal(await panels(),0);
 await page.evaluate(()=>{const app=Alpine.$data(document.body);app.articles[0].briefing=window.__readyBriefing;});
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.has-story-briefing [role="status"]')).display==='none');
 assert.equal(await panels(),0);
 const grouped=await page.evaluate(()=>{const app=Alpine.$data(document.body);return app.storyCoverage({link:'https://publisher.test/one',feedTitle:'Publisher',relatedArticles:[{link:'https://publisher.test/two',feedTitle:'Publisher'},{link:'https://other.test/one',feedTitle:'Other'}]}).map(g=>g.articles.length);});
 assert.deepEqual(grouped,[2,1]);
 await page.evaluate(()=>{
    window.__analysisPollPages=[];
    window.fetch=async url=>{window.__analysisPollPages.push(new URL(url,location.origin).searchParams.get('page'));return {ok:true,json:async()=>({articles:[],rankingPending:false,updatesAvailable:false})};};
    const app=Alpine.$data(document.body);app.isMobile=true;app.currentPage=3;app.smartViewToken='fixture';
    app.scheduleBriefingRefresh(0,0);
 });
 await page.waitForFunction(()=>window.__analysisPollPages.length===1);
 await page.evaluate(()=>Alpine.$data(document.body).scheduleBriefingRefresh(1,0));
 await page.waitForFunction(()=>window.__analysisPollPages.length===2);
 await page.evaluate(()=>Alpine.$data(document.body).scheduleBriefingRefresh(2,0));
 await page.waitForFunction(()=>window.__analysisPollPages.length===3);
 assert.deepEqual(await page.evaluate(()=>window.__analysisPollPages),['1','2','3']);
 await page.evaluate(()=>clearTimeout(Alpine.$data(document.body).briefingRefreshTimer));
 assert.deepEqual(errors,[]);console.log('ANALYSIS_BROWSER_OK: desktop/mobile, Top/More, 9 tabs, collapsed, switching, horizontal scrolling, Classic isolation');
}finally{await browser.close();server.close();}
