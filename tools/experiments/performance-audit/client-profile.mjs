import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 await context.addCookies([{name:'auth',value:'true',url:'http://127.0.0.1:3000'}]);
 await context.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 const page=await context.newPage(), cdp=await context.newCDPSession(page);
 await page.goto('http://127.0.0.1:3000/#category/Forum');
 await page.waitForFunction(()=>window.Alpine && !Alpine.$data(document.body).isLoadingArticles && Alpine.$data(document.body).articles.length);
 await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
 for(const i of [3,4,5]) {
 await page.evaluate(i=>Alpine.$data(document.body).setFilter('feed',Alpine.$data(document.body).feeds[i].url),i);
 await page.waitForFunction(()=>!Alpine.$data(document.body).isLoadingArticles);
 await page.waitForTimeout(500);
 }
 const {profile}=await cdp.send('Profiler.stop');
 await writeFile(process.argv[2]||'/tmp/rss-audit-20261006/client-before.cpuprofile',JSON.stringify(profile));
 const times=new Map(),nodes=new Map(profile.nodes.map(n=>[n.id,n]));
 for(let i=0;i<profile.samples.length;i++) times.set(profile.samples[i],(times.get(profile.samples[i])||0)+profile.timeDeltas[i]);
 console.log(JSON.stringify([...times].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([id,us])=>({ms:us/1000,...nodes.get(id).callFrame})),null,2));
}finally{await browser.close();}
