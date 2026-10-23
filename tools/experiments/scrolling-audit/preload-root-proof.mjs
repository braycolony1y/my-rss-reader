import {chromium,webkit} from 'playwright';
import {writeFile} from 'node:fs/promises';
const rows=[];
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 let browser;
 try{
  browser=await engine.launch({headless:true,...(name==='chromium'?{args:['--no-sandbox']}:(process.env.WEBKIT_EXECUTABLE?{executablePath:process.env.WEBKIT_EXECUTABLE}:{}))});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.setContent('<style>body{margin:0}#scroll-container{height:700px;overflow:auto}.spacer{height:1400px}.card{height:200px}</style><div id="scroll-container"><div class="spacer"></div><div class="card">next thumbnail</div></div>');
  const proof=await page.evaluate(async()=>{
   const target=document.querySelector('.card'),root=document.getElementById('scroll-container');
   return Promise.all([null,root].map(root=>new Promise(resolve=>{
    const observer=new IntersectionObserver(entries=>{const e=entries[0];observer.disconnect();resolve({root:root?'scroll-container':'viewport',isIntersecting:e.isIntersecting,bounds:e.boundingClientRect.toJSON(),intersection:e.intersectionRect.toJSON(),rootBounds:e.rootBounds.toJSON()});},{root,rootMargin:'1200px 0px'});observer.observe(target);
   })));
  });
  rows.push({engine:name,proof});console.log(JSON.stringify(rows.at(-1)));
 }catch(error){rows.push({engine:name,error:error.message});console.log(name+': '+error.message.slice(0,400));}
 finally{await browser?.close();}
}
if (!process.argv[2]) throw Error('Usage: node preload-root-proof.mjs OUTPUT_JSON');
await writeFile(process.argv[2],JSON.stringify(rows,null,2));
