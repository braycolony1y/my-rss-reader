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
try {
 const page = await browser.newPage();
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.setViewport({width:1440,height:1100});
 await page.goto(`http://127.0.0.1:${server.address().port}`, {waitUntil:'networkidle2'});
 await page.waitForSelector('.has-story-briefing');
 await page.evaluate(() => {
   const app = Alpine.$data(document.body);
   const originalFetch = window.fetch;
   window.__savedFilters = ['existing keyword'];
   window.fetch = async (url, options = {}) => {
     if (url === '/api/content-filter-settings') {
       await new Promise(resolve => setTimeout(resolve, 300));
       if (options.method === 'POST') window.__savedFilters = JSON.parse(options.body).keywords;
       return {ok:true,json:async()=>({keywords:window.__savedFilters})};
     }
     return originalFetch(url, options);
   };
   app.contentFilterLoaded = false;
   app.blockedKeywords = [];
   app.blockedKeywordsDraft = [];
   app.fetchContentFilterSettings();
   app.openContentFilterSettings();
 });
 await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Edit blocked keyword or phrase"]')].some(input => input.value === 'existing keyword'));
 await page.type('[aria-label="Add blocked keyword or phrase"]', 'new keyword');
 await page.keyboard.press('Enter');
 await page.waitForFunction(() => Alpine.$data(document.body).blockedKeywordsDraft.includes('new keyword'));
 const save = await page.$('button[x-text="savingContentFilter ? \'Saving…\' : \'Save filters\'"]');
 await save.click();
 await page.waitForFunction(() => Alpine.$data(document.body).savingContentFilter);
 assert.equal(await page.evaluate(() => Alpine.$data(document.body).contentFilterSettingsOpen), true);
 await page.waitForFunction(() => !Alpine.$data(document.body).contentFilterSettingsOpen);
 assert.deepEqual(await page.evaluate(() => window.__savedFilters), ['existing keyword','new keyword']);
 // Recreate startup state and immediately open the modal, as on hard reload.
 await page.evaluate(() => {
   const app = Alpine.$data(document.body);
   app.contentFilterLoaded = false; app.blockedKeywords = []; app.blockedKeywordsDraft = [];
   app.fetchContentFilterSettings(); app.openContentFilterSettings();
 });
 await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Edit blocked keyword or phrase"]')].some(input => input.value === 'new keyword'));
 await page.evaluate(() => {
   const app = Alpine.$data(document.body); app.contentFilterSettingsOpen = false;
   app.articles[0].briefing = {analysisStatus:'pending',generationState:'queued',queueAhead:49,sections:[]};
 });
 await page.waitForFunction(() => document.querySelector('.has-story-briefing [role="status"]').textContent.includes('49 ahead'));
 await page.evaluate(() => Alpine.$data(document.body).applyBriefingUpdates([{clusterId:'top',briefing:{analysisStatus:'pending',generationState:'queued',queueAhead:0,sections:[]}}]));
 await page.waitForFunction(() => document.querySelector('.has-story-briefing [role="status"]').textContent.includes('0 ahead'));
 await page.evaluate(() => Alpine.$data(document.body).applyBriefingUpdates([{clusterId:'top',briefing:{status:'ready',analysisStatus:'evaluated',sections:[{label:'What happened',text:'Completed result'}]}}]));
 await page.waitForFunction(() => getComputedStyle(document.querySelector('.has-story-briefing [role="status"]')).display === 'none');
 assert.deepEqual(errors, []);
 console.log('FILTER_BRIEFING_BROWSER_OK: first open, acknowledged save, reload hydration, live queue and completion rendering');
} finally { await browser.close(); server.close(); }
