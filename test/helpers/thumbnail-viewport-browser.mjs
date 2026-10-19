// Browser regression for the real admission owner in a nested scrollport.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';
const root=fileURLToPath(new URL('../../',import.meta.url));
const bytes=await readFile(path.join(root,'public/default.jpg'));
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/og-image'){
  await new Promise(r=>setTimeout(r,500));
  res.setHeader('Content-Type','image/jpeg');res.end(bytes);return;
 }
 if(url.pathname.startsWith('/public/')){
  const file=path.resolve(root,'.'+url.pathname);
  if(!file.startsWith(path.join(root,'public')+path.sep)){res.writeHead(400).end();return;}
  res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(file));return;
 }
 res.setHeader('Content-Type','text/html');res.end(`<link rel="stylesheet" href="/public/thumbnail-loading.css"><style>body{margin:0}#scroll-container{height:400px;overflow:auto}.article-card{height:200px}img{width:100px;height:100px}.spacer{height:1000px}</style><div id="scroll-container"><div class="spacer"></div>${[0,1,2].map(i=>`<article class="article-card"><div class="article-card-image"><div class="thumbnail-plate"><img class="thumbnail-img" alt="Article headline" data-thumbnail-src="/api/og-image?i=${i}"></div></div></article>`).join('')}</div><script type="module">import {installThumbnailLoading} from '/public/thumbnail-loading.js';window.stopLoading=installThumbnailLoading(window);window.ready=true;</script>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const engine=process.env.READER_BROWSER==='webkit'?webkit:chromium;
const browser=await engine.launch({headless:true,...(engine===chromium?{args:['--no-sandbox']}:process.env.WEBKIT_EXECUTABLE?{executablePath:process.env.WEBKIT_EXECUTABLE}:{})});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.ready&&document.images[0].hasAttribute('src')&&document.images[1].hasAttribute('src'));
 assert.equal(await page.evaluate(()=>document.images[0].getBoundingClientRect().top>document.getElementById('scroll-container').getBoundingClientRect().bottom),true,'preload must start before viewport entry');
 const pending=await page.evaluate(()=>{const img=document.images[2];return {visibility:getComputedStyle(img).visibility,height:img.getBoundingClientRect().height,alt:img.alt};});
 assert.equal(pending.visibility,'hidden','unassigned images must not paint duplicate alt text');
 assert.equal(pending.height,100,'the approved photo box remains reserved');assert.equal(pending.alt,'Article headline');
 const retained=await page.evaluate(async()=>{
  const imgs=[...document.images],sources=imgs.slice(0,2).map(i=>i.getAttribute('src')),sc=document.getElementById('scroll-container');
  sc.scrollTop=1400;
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  return {retained:imgs.slice(0,2).every((i,j)=>i.getAttribute('src')===sources[j]),visibleAdmitted:imgs[2].hasAttribute('src')};
 });
 assert.equal(retained.retained,true,'visible work must not clear ongoing preloads');
 assert.equal(retained.visibleAdmitted,true,'the visible reserve must not wait for old preloads');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.images[2]).visibility),'visible','assigning a source restores visibility without another observer');
 await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth));
 const stability=await page.evaluate(async()=>{
  const imgs=[...document.images],sources=imgs.map(i=>i.getAttribute('src')),sc=document.getElementById('scroll-container');
  for(const top of [0,1400,0,1400]){sc.scrollTop=top;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}
  return imgs.every((img,i)=>img.getAttribute('src')===sources[i]&&img.complete&&img.naturalWidth>0);
 });
 assert.equal(stability,true);assert.deepEqual(errors,[]);
 const responsive=await page.evaluate(async()=>{
  const img=document.createElement('img');img.className='thumbnail-img';img.srcset='/api/og-image?i=responsive 1x';
  document.querySelector('.thumbnail-plate').append(img);await img.decode();
  return !img.hasAttribute('src')&&img.naturalWidth>0&&getComputedStyle(img).visibility==='visible';
 });
 assert.equal(responsive,true,'a valid responsive source must remain visible without src');
 console.log(JSON.stringify({engine:engine===webkit?'webkit':'chromium',preloadBeforeViewport:true,pendingBoxReserved:true,pendingAltHidden:true,responsiveVisible:true,retained:true,visibleReserve:true,reversalStable:true,errors}));
}finally{await browser.close();server.closeAllConnections();server.close();}
