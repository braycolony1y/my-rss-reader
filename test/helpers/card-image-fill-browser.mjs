import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const output='/tmp/card-fill-review';
await fs.mkdir(output,{recursive:true});
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH||'/snap/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3000/public/top-story-card/demo/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.topStoryReview);
 const html=await fs.readFile(new URL('../../index.html',import.meta.url),'utf8');
 const hrefs=[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m=>m[1]);
 await page.evaluate(async hrefs=>{
  document.querySelectorAll('link[rel="stylesheet"]').forEach(n=>n.remove());
  await Promise.all(hrefs.map(href=>new Promise((resolve,reject)=>{const l=document.createElement('link');l.rel='stylesheet';l.href=href;l.onload=resolve;l.onerror=reject;document.head.append(l);})));
 },hrefs);
 await page.addStyleTag({content:'.review-controls,.review-caption {display:none} body{height:auto!important;overflow:auto!important} #scroll-container{display:block!important;padding:12px!important;height:auto!important;overflow:visible!important}'});
 const report=[];
 for(const width of [320,390,440,1440])for(const mode of ['top','classic','normal'])for(const fallback of [false,true]){
  await page.setViewport({width,height:1100});
  await page.evaluate(async({width,mode,fallback})=>{
   const entry=window.topStoryReview.entries[0],card=entry.card;
   const select=document.querySelector('#width'),size=width<768?width-24:740;
   if(![...select.options].some(o=>+o.value===size))select.add(new Option(size,size));select.value=size;
   card.dataset.imageLayout=mode==='top'?'top':'standard';card.classList.toggle('is-smart-classic-card',mode==='classic');card.classList.toggle('is-standard-card',mode==='normal');
   card.querySelector('.story-rank').style.display=mode==='top'?'':'none';
   const img=entry.img;img.src=fallback?'/public/default.jpg':entry.state.blend.story.assets.heroImage;await img.decode();
   window.topStoryReview.update();
   const {applyTopStoryImage}=await import('/public/top-story-card/blend/runtime.js?v=20261004_fill_1');
   applyTopStoryImage(img,entry.state,{ready:true,isDefault:fallback});
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  },{width,mode,fallback});
  await page.waitForFunction(width=>width>=768?!document.querySelector('.article-card').dataset.mobileClean:document.querySelector('.article-card').dataset.mobileClean==='1',{},width);
  const result=await page.$eval('.article-card',c=>{
   const r=n=>{const b=n.getBoundingClientRect();return {left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height};};
   const hero=c.querySelector('.article-card-image'),img=c.querySelector('.thumbnail-img'),heading=c.querySelector('.article-card-heading');
   const f=window.topStoryReview.entries[0].state.blend.story.focal;
   const b=r(img),rail=r(c.querySelector('.article-metadata'));
   return {card:r(c),hero:r(hero),image:b,rail,face:{top:b.top+(f.y-f.h/2)*b.height,bottom:b.top+(f.y+f.h/2)*b.height},imageDisplay:getComputedStyle(hero).display,imageOpacity:getComputedStyle(hero).opacity,missing:c.dataset.storyImageMissing,margin:getComputedStyle(heading).marginTop,padding:getComputedStyle(heading).paddingTop};
  });
  assert.equal(result.missing,'false');assert.notEqual(result.imageDisplay,'none');assert.equal(result.imageOpacity,'1');
  if(width<768){
   assert.ok(result.image.left<=result.hero.left+.1,'image fills left');
   assert.ok(result.image.top<=result.hero.top+.1,'image fills top');
   assert.ok(result.image.right>=result.hero.right-.1,'image fills right');
   assert.ok(result.image.bottom>=result.hero.bottom-.1,'image fills height');
   assert.equal(result.margin,'-20px');assert.equal(result.padding,'14px');
   assert.ok(Math.abs(result.rail.top-result.hero.top-20)<.1,'metadata stays at fixed top');
   if(!fallback)assert.ok(result.face.top>=result.rail.bottom+7,'face remains clear of metadata');
  }
  report.push({width,mode,fallback,...result});
  if(width===390||width===1440)await(await page.$('.article-card')).screenshot({path:`${output}/${mode}-${fallback?'default':'photo'}-${width}.png`});
 }
 assert.deepEqual(errors,[]);await fs.writeFile(output+'/fill-measurements.json',JSON.stringify(report,null,2));
 console.log('CARD_IMAGE_FILL_OK: 24 default/photo cases; Top, Classic, Normal; mobile edges, fixed metadata, default visibility and spacing verified');
}finally{await browser.close();}
