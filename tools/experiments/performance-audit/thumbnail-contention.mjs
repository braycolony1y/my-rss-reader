import http from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const module=await readFile(new URL('../../../public/thumbnail-loading.js',import.meta.url),'utf8');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6L8AAAAASUVORK5CYII=','base64');
let active=0,peak=0;
const server=http.createServer((req,res)=>{
 if(req.url.startsWith('/api/og-image')){
  active++;peak=Math.max(peak,active);let closed=false;
  res.on('close',()=>{if(!closed){closed=true;active--;}});
  setTimeout(()=>{res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});res.end(pixel);},1200);return;
 }
 if(req.url==='/module.js'){res.setHeader('Content-Type','text/javascript');res.end(module);return;}
 if(req.url==='/api/data'){res.setHeader('Content-Type','application/json');res.end('{"articles":[1]}');return;}
 const after=req.url.includes('after');
 res.setHeader('Content-Type','text/html');res.end(`<body>${Array.from({length:8},(_,i)=>`<img width="40" height="40" ${after?'data-thumbnail-src':'src'}="/api/og-image?i=${i}">`).join('')}<script type="module">${after?"import {installThumbnailLoading} from '/module.js';installThumbnailLoading(window);":''}window.ready=true;</script></body>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,args:['--no-sandbox']}),results=[];
try{
 for(const variant of ['before','after'])for(let run=0;run<3;run++){
  const context=await browser.newContext(),page=await context.newPage();active=0;peak=0;
  await page.goto(`${base}/${variant}`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.ready);
  await page.waitForTimeout(100);
  const navigation=await page.evaluate(async()=>{const start=performance.now();const response=await fetch('/api/data');await response.json();return performance.now()-start;});
  await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0),null,{timeout:15000});
  results.push({variant,run,navigationMs:navigation,peakThumbnailRequests:peak,images:await page.locator('img').count()});
  await context.close();
 }
 const after=results.filter(r=>r.variant==='after');if(after.some(r=>r.peakThumbnailRequests>2||r.images!==8))throw Error('Image admission regression');
 await writeFile('/tmp/rss-audit-followup-20261007/thumbnail-contention.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();server.closeAllConnections();server.close();}
