// Diagnose engine crashes against saved pre-change assets; not a latency test.
import {webkit} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
import {detectImageFocus} from '../../../src/images/focal-detector.js';
const output=process.argv[2],baseline=process.argv[3],photo=await readFile('public/default.jpg'),metadata={...await detectImageFocus(photo),x:.85,y:.2};
const server=await startFixtureServer({transformResponse(value){if(Array.isArray(value?.articles))for(const a of value.articles)a.image='/api/og-image?url=webkit-load';return value;}}),rows=[];
try{for(const variant of ['before','after','after','before']){
 const browser=await webkit.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:900},isMobile:true,hasTouch:true});await context.addCookies([{name:'auth',value:'true',url:server.url}]);await context.addInitScript(()=>localStorage.setItem('theme','glass-light'));
  await context.route('**/api/og-image*',r=>r.fulfill({contentType:'image/jpeg',body:photo}));await context.route('**/api/image-focus*',r=>r.fulfill({json:metadata}));
  if(variant==='before')for(const [pattern,file]of [['**/public/image-focus.js*','image-focus.js'],['**/public/image-focus-mutations.js*','image-focus-mutations.js'],['**/public/top-story-card/blend/runtime.js*','blend-runtime.js']])await context.route(pattern,async r=>r.fulfill({contentType:'text/javascript',body:await readFile(baseline+'/'+file,'utf8')}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let outcome='loaded',failure=null;
  try{await page.goto(server.url,{timeout:30000});await page.waitForFunction(()=>document.querySelector('.thumbnail-img')?.dataset.focusState==='ready',null,{timeout:20000});await page.waitForTimeout(1000);}catch(e){outcome='failed';failure=e.message;}
  rows.push({variant,outcome,failure,errors});console.log(JSON.stringify(rows.at(-1)));
 }finally{await browser.close();}
}}finally{server.close();await writeFile(output,JSON.stringify(rows,null,2));}
