// Compare the clear ship region with the same thumbnail rendered without blend layers.
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.READER_URL || 'http://127.0.0.1:3000';
const out=process.env.CARD_OUTPUT || '/tmp/story-card-editorial-review';
await fs.mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:process.env.CHROMIUM_PATH || '/snap/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
const page=await browser.newPage();await page.setViewport({width:1450,height:1200});
await page.setCookie({name:'auth',value:'true',url:base});await page.evaluateOnNewDocument(()=>localStorage.setItem('theme','glass-light'));
await page.goto(base+'/#smart/news_vietnam',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.Alpine?.$data(document.body)?.feeds?.length);
await page.evaluate(()=>{const buttons=[...document.querySelectorAll('button')];buttons.find(e=>e.getAttribute('@click')==="setSmartSection('news')").click();buttons.find(e=>e.getAttribute('@click')==="setFilter('smart', 'news_vietnam')").click();});
await page.waitForFunction(()=>[...document.querySelectorAll('.article-card h2')].some(e=>e.textContent.includes('Hải Sâm')));
const card=await page.$('::-p-xpath(//h2[contains(., "Hải Sâm")]/ancestor::div[contains(@class,"article-card ")])');await card.evaluate(e=>{e.dataset.photoQa='true';e.style.width='1000px';e.style.maxWidth='none';});await card.scrollIntoView();
await page.waitForFunction(()=>document.querySelector('[data-photo-qa]').dataset.storyBlend==='ready');
const region=await card.evaluate(e=>{const r=e.getBoundingClientRect(),p=e.querySelector('.thumbnail-img').getBoundingClientRect();return{left:Math.round(p.x-r.x+p.width*.65),top:Math.round(p.y-r.y+p.height*.32),width:Math.floor(p.width*.26),height:Math.floor(p.height*.28)}});
const actual=await card.screenshot();
await page.addStyleTag({content:'[data-photo-qa] .thumbnail-img { mask-image:none !important; -webkit-mask-image:none !important; } [data-photo-qa] .thumbnail-soft, [data-photo-qa]::after { visibility:hidden !important; }'});
const original=await card.screenshot();
const a=await sharp(actual).extract(region).removeAlpha().raw().toBuffer(),b=await sharp(original).extract(region).removeAlpha().raw().toBuffer();
let sum=0,max=0;const diffs=[];for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);sum+=d;max=Math.max(max,d);diffs.push(d)}diffs.sort((a,b)=>a-b);
const report={region,meanChannelDifference:sum/a.length,p95ChannelDifference:diffs[Math.floor(diffs.length*.95)],maxChannelDifference:max,channels:a.length};
await fs.writeFile(out+'/ship-photo-comparison.json',JSON.stringify(report,null,2));
await sharp(actual).extract(region).png().toFile(out+'/ship-rendered.png');await sharp(original).extract(region).png().toFile(out+'/ship-original.png');assert.ok(report.meanChannelDifference < 2, 'The clear ship region retains the original photo');console.log(report);
}finally{await browser.close();}
