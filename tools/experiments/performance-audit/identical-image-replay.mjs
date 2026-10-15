import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
const output=process.argv[2],baseline=process.argv[3];
const server=await startFixtureServer({transformResponse(value){if(Array.isArray(value?.articles))for(const a of value.articles)a.image='/public/default.jpg';return value;}});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),rows=[];
try{for(const variant of ['before','after','after','before'])for(const theme of ['classic','glass-light']){
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 await context.addCookies([{name:'auth',value:'true',url:server.url}]);await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
 let source=await readFile(variant==='before'?baseline+'/image-focus.js':'public/image-focus.js','utf8');
 source=source.replace('function apply(img, state) {','function apply(img, state) { win.__imageApplies = (win.__imageApplies || 0) + 1;');
 await context.route('**/public/image-focus.js*',r=>r.fulfill({contentType:'text/javascript',body:source}));
 if(variant==='before')await context.route('**/public/image-focus-mutations.js*',async r=>r.fulfill({contentType:'text/javascript',body:await readFile(baseline+'/image-focus-mutations.js','utf8')}));
 const page=await context.newPage();await page.goto(server.url);
 await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&document.querySelectorAll('.thumbnail-img').length===8);
 await page.waitForTimeout(1800);
 const row=await page.evaluate(async()=>{
  const geometry=()=>[...document.querySelectorAll('.article-card')].map(c=>{const r=c.getBoundingClientRect();return [r.x,r.y,r.width,r.height];});
  const before=geometry();window.__imageApplies=0;const samples=[];
  for(let n=0;n<12;n++){
   const at=performance.now();for(const img of document.querySelectorAll('.thumbnail-img'))img.setAttribute('src',img.getAttribute('src'));
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));samples.push(performance.now()-at);
  }
  return {applies:window.__imageApplies,samples,geometryPreserved:JSON.stringify(before)===JSON.stringify(geometry())};
 });rows.push({variant,theme,...row});console.log(JSON.stringify(rows.at(-1)));await context.close();
}}finally{await browser.close();server.close();await writeFile(output,JSON.stringify(rows,null,2));}
