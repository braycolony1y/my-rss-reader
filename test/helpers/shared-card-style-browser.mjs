import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const out='/tmp/shared-card-review';await fs.mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'/snap/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1440,height:1100});
 await page.setCookie({name:'auth',value:'true',url:'http://127.0.0.1:3000'});
 await page.evaluateOnNewDocument(()=>localStorage.setItem('theme','glass-light'));
 await page.goto('http://127.0.0.1:3000/#smart/news_vietnam',{waitUntil:'domcontentloaded'});
 console.log(await page.evaluate(()=>({url:location.href,text:document.body.innerText.slice(0,500)})));
 await page.waitForSelector('.article-card',{timeout:90000});
 const report=[];
 for (const mode of ['classic','normal','voz']) {
  await page.evaluate(async mode=>{const a=window.Alpine.$data(document.body);if(mode==='classic'){a.setFilter('smart','news_vietnam');a.smartTabMode='classic';a.fetchData();}else a.setFilter(mode==='voz'?'hot_today':'today',null);},mode);
  await page.waitForSelector('[data-shared-card-style] img[data-focus-state="ready"]',{timeout:60000});
  await new Promise(r=>setTimeout(r,1500));
  const values=await page.evaluate(()=>[...document.querySelectorAll('[data-shared-card-style]')].slice(0,5).map(c=>{
   const im=c.querySelector('.thumbnail-img'),h=c.querySelector('.article-card-image'),s=getComputedStyle(im);
   return {visible:im.getBoundingClientRect().width>0,bottomError:im.getBoundingClientRect().bottom-c.getBoundingClientRect().bottom,heroError:h.getBoundingClientRect().bottom-c.getBoundingClientRect().bottom,mask:s.maskImage,heroMask:getComputedStyle(h).maskImage,focus:s.objectPosition,background:getComputedStyle(c).backgroundColor,analysisVisible:[...c.querySelectorAll('.story-analysis-shell')].some(n=>n.getBoundingClientRect().height>0)};
  }));
  assert.ok(values.length);for(const v of values){if(!v.visible)continue;assert.ok(Math.abs(v.bottomError)<.1,JSON.stringify(v));assert.ok(Math.abs(v.heroError)<.1,JSON.stringify(v));assert.equal(v.heroMask,'none');assert.ok(v.mask.includes('radial-gradient'));assert.equal(v.analysisVisible,false);}
  const preview=await page.evaluateHandle(()=>[...document.querySelectorAll('[data-shared-card-style]')].find(c=>c.querySelector('.thumbnail-img').getBoundingClientRect().width>0)||document.querySelector('[data-shared-card-style]'));
  await preview.asElement().screenshot({path:`${out}/${mode}.png`});
  report.push({mode,values});console.log(`${mode} checked`);
 }
 for(const width of [320,375,390,430,767,844,1440]){
  await page.setViewport({width,height:1100});await new Promise(r=>setTimeout(r,200));
  const result=await page.evaluate(()=>{
   const c=document.querySelector('.article-card'),im=c.querySelector('.thumbnail-img');
   const snap=()=>{const r=im.getBoundingClientRect(),s=getComputedStyle(im);return [r.x,r.y,r.width,r.height,s.maskImage,s.objectPosition,getComputedStyle(c).backgroundColor]};
   const before=snap(),sheet=[...document.styleSheets].find(s=>s.href?.includes('shared-card-style/card.css'));
   sheet.disabled=true;const after=snap();sheet.disabled=false;
   return {active:!!c.dataset.sharedCardStyle,unchanged:JSON.stringify(before)===JSON.stringify(after),width:c.clientWidth};
  });
  if(width<768 || result.width<640){assert.equal(result.active,false);assert.ok(result.unchanged);}else assert.ok(result.active);
 }
 assert.deepEqual(errors,[]);await fs.writeFile(`${out}/measurements.json`,JSON.stringify(report,null,2));console.log('PASS shared desktop styles and mobile isolation');
}finally{await browser.close();}
