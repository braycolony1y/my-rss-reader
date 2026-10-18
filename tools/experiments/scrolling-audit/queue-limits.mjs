import http from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const root=process.argv[2], output=process.argv[3];
if (!root || !output) throw Error('Usage: node queue-limits.mjs PUBLIC_DIRECTORY OUTPUT_JSON');
const bytes=await readFile(root+'/default.jpg');
const loader=await readFile(root+'/thumbnail-loading.js','utf8');
const rows=[];
for(const limit of [2,3,4]){
 let active=0,peak=0;const admitted=[];
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/loader.js'){res.setHeader('Content-Type','text/javascript');res.end(loader);return;}
  if(url.pathname==='/thumbnail-admission.js'){res.setHeader('Content-Type','text/javascript');res.end((await readFile(root+'/thumbnail-admission.js','utf8')).replace('visible: 3',`visible: ${limit}`));return;}
  if(url.pathname==='/api/data'){res.setHeader('Content-Type','application/json');res.end('{}');return;}
  if(url.pathname.startsWith('/hold-focus/')){await new Promise(r=>setTimeout(r,2500));res.end('{}');return;}
  if(url.pathname==='/api/og-image'){
   active++;peak=Math.max(peak,active);admitted.push({id:url.searchParams.get('i'),at:performance.now()});
   res.once('close',()=>active--);await new Promise(r=>setTimeout(r,900));res.setHeader('Content-Type','image/jpeg');res.setHeader('Cache-Control','private,max-age=86400');res.end(bytes);return;
  }
  res.setHeader('Content-Type','text/html');
  res.end('<style>body{margin:0}#scroll-container{height:400px;overflow:auto}.article-card{height:200px}img{width:100px;height:100px}.spacer{height:900px}</style><div id="scroll-container">'+[0,1].map(i=>`<div class="article-card"><img data-thumbnail-src="/api/og-image?i=${i}"></div>`).join('')+'<div class="spacer"></div>'+[2,3].map(i=>`<div class="article-card"><img data-thumbnail-src="/api/og-image?i=${i}"></div>`).join('')+'</div><script type="module">import {installThumbnailLoading} from "/loader.js";installThumbnailLoading(window);window.ready=true;</script>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.ready);
  await page.evaluate(()=>{void fetch('/hold-focus/0');void fetch('/hold-focus/1');});
  await page.waitForTimeout(100);
  const result=await page.evaluate(async()=>{
   const images=[...document.images],original=images.slice(0,2).map(i=>i.getAttribute('src')),sc=document.getElementById('scroll-container');
   const started=performance.now();sc.scrollTop=1300;
   const loads=[];images.slice(2).forEach((img,j)=>img.addEventListener('load',()=>loads.push({id:j+2,ms:performance.now()-started}),{once:true}));
   await new Promise(r=>setTimeout(r,150));const start=performance.now();await(await fetch('/api/data')).json();const navigationMs=performance.now()-start;
   await new Promise(r=>setTimeout(r,2100));
   const requests=performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/og-image')).map(e=>({id:new URL(e.name).searchParams.get('i'),start:e.startTime-started,queue:e.requestStart-e.startTime,ttfb:e.responseStart-e.requestStart,transfer:e.responseEnd-e.responseStart,bytes:e.transferSize}));
   return {loads,requests,navigationMs,retained:images.slice(0,2).every((i,j)=>i.getAttribute('src')===original[j])};
  });
  rows.push({limit,peak,...result});console.log(JSON.stringify(rows.at(-1)));
 }finally{await browser.close();server.closeAllConnections();server.close();}
}
await writeFile(output,JSON.stringify(rows,null,2));
