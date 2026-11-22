import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'auth',value:'true',url:'http://127.0.0.1:3000'}]);
 await context.addInitScript(theme=>localStorage.setItem('theme',theme),process.argv[2]||'classic');
 await context.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3000/#category/Forum',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.Alpine&&Alpine.$data(document.body).articles?.length&&!Alpine.$data(document.body).isLoadingArticles,null,{timeout:60000});
 await page.waitForTimeout(12000);
 const state=await page.evaluate(()=>({theme:Alpine.$data(document.body).theme,images:[...document.querySelectorAll('.thumbnail-img')].slice(0,8).map(img=>({src:img.getAttribute('src'),desired:img.dataset.thumbnailSrc,complete:img.complete,naturalWidth:img.naturalWidth,focus:img.dataset.focusState,opacity:getComputedStyle(img).opacity,rect:img.getBoundingClientRect().toJSON(),card:img.closest('.article-card').getBoundingClientRect().toJSON()}))}));
 await page.evaluate(()=>document.getElementById('scroll-container').scrollTop=1000);await page.waitForTimeout(6000);
 state.afterScroll=await page.evaluate(()=>[...document.querySelectorAll('.thumbnail-img')].slice(0,8).map(img=>({src:img.getAttribute('src'),naturalWidth:img.naturalWidth,focus:img.dataset.focusState,opacity:getComputedStyle(img).opacity,rect:img.getBoundingClientRect().toJSON()})));
 await page.screenshot({path:'/tmp/rss-audit-followup-20261007/forum-thumbnails.png'});await writeFile('/tmp/rss-audit-followup-20261007/forum-thumbnails.json',JSON.stringify({state,errors},null,2));console.log(JSON.stringify({state,errors}));
}finally{await browser.close();}
