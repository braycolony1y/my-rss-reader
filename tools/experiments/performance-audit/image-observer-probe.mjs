// Diagnostic only: reuse the production fixture server and record scalar work.
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { startFixtureServer } from '../../../test/helpers/frontend-refactor/server.js';
import { createReaderAssetRenderer } from '../../../src/ui/reader-assets.js';

const output = process.argv[2];
const server = await startFixtureServer({imageDelayMs: 10});
const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
try {
 const context = await browser.newContext({viewport: {width:1440,height:900}});
 await context.addCookies([{name:'auth',value:'true',url:server.url}]);
 if(process.env.READER_REVALIDATION_BASELINE==='1') {
  const body=(await createReaderAssetRenderer().script()).replace('return refreshed ? Object.assign(existing, refreshed) : existing;','return refreshed ? { ...existing, ...refreshed } : existing;');
  await context.route('**/script.js*',route=>route.fulfill({contentType:'text/javascript',body}));
 }
 if(process.argv[3]&&!process.argv[3].startsWith('--')) await context.route('**/public/top-story-card/blend/runtime.js*', async route => route.fulfill({contentType:'text/javascript',body:await readFile(process.argv[3],'utf8')}));
 if(process.env.READER_MUTATION_CANDIDATE) {
  const dir=process.env.READER_MUTATION_CANDIDATE;
  await context.route('**/public/image-focus.js*',async route=>route.fulfill({contentType:'text/javascript',body:await readFile(dir+'/image-focus-candidate.js','utf8')}));
  await context.route('**/public/image-focus-mutations.js*',async route=>route.fulfill({contentType:'text/javascript',body:await readFile(dir+'/mutations-candidate.js','utf8')}));
 }
 await context.addInitScript(() => {
  localStorage.setItem('theme','glass-light');
  window.probe = {callbacks:[], reads:{}, writes:{}};
  let owner = 'other';
  for (const kind of ['MutationObserver','ResizeObserver','IntersectionObserver']) {
   const Native = window[kind];
   window[kind] = class extends Native {
    constructor(callback, options) {
     const origin = new Error().stack.split('\n').slice(2,4).join(' ');
     super((entries, observer) => {
      const previous=owner; owner=kind+' '+origin;
      const row={kind,origin,n:entries.length,attributes:{},unchanged:{},reads:0,writes:0,ms:0};
      if(kind==='MutationObserver')for(const r of entries){const key=r.type+':'+r.attributeName+':'+r.target.nodeName;row.attributes[key]=(row.attributes[key]||0)+1;if(r.type==='attributes'&&r.oldValue===r.target.getAttribute(r.attributeName))row.unchanged[key]=(row.unchanged[key]||0)+1;}
      window.probe.current=row; const start=performance.now();
      try{return callback(entries,observer);}finally{row.ms=performance.now()-start;window.probe.callbacks.push(row);window.probe.current=null;owner=previous;}
     },options);
    }
    observe(target,options){return super.observe(target,kind==='MutationObserver'&&options.attributes?{...options,attributeOldValue:true}:options);}
   };
  }
  const rect=Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect=function(...args){window.probe.reads[owner]=(window.probe.reads[owner]||0)+1;if(window.probe.current)window.probe.current.reads++;return rect.apply(this,args);};
  for(const method of ['setProperty','removeProperty']){
   const original=CSSStyleDeclaration.prototype[method];
   CSSStyleDeclaration.prototype[method]=function(key,value,...args){
    const changed=method==='removeProperty'?!!this.getPropertyValue(key):this.getPropertyValue(key)!==String(value);
    const id=owner+':'+method+':'+key+':'+changed;
    window.probe.writes[id]=(window.probe.writes[id]||0)+1;if(window.probe.current)window.probe.current.writes++;
    return original.call(this,key,value,...args);
   };
  }
 });
 const page=await context.newPage();await page.goto(server.url);
 await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).articles.length);
 if(process.argv.includes('--revalidate')){
  await page.evaluate(()=>Alpine.$data(document.body).setFilter('feed','https://example.test/feed'));
  await page.waitForFunction(()=>!Alpine.$data(document.body).isLoadingArticles);
 }
 await page.waitForTimeout(1500);
 await page.evaluate(revalidate=>{window.probe.callbacks=[];window.probe.reads={};window.probe.writes={};window.probeCards=[...document.querySelectorAll('.article-card')];const app=Alpine.$data(document.body);window.probe.context={filter:app.selectedFilterType,usesTopStories:app.usesTopStories};return revalidate?app.fetchData(false,true,true):app.setFilter('smart','tech_vietnam');},process.argv.includes('--revalidate'));
 await page.waitForTimeout(2500);
 await writeFile(output,JSON.stringify(await page.evaluate(()=>({...window.probe,reused:[...document.querySelectorAll('.article-card')].filter(c=>window.probeCards.includes(c)).length})),null,2));
} finally {await browser.close();server.close();}
