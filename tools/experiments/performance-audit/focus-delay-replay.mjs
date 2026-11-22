// Controlled focus response timing against the existing production card markup.
import {chromium} from 'playwright';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
const output = process.argv[2];
await mkdir(output, {recursive:true});
const image = await readFile('public/default.jpg');
const server = await startFixtureServer({transformResponse(value) {
    if (Array.isArray(value?.articles)) for (const a of value.articles) a.image = '/api/og-image?url=focus-fixture';
    return value;
}});
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
const rows=[];
try {
    for (const theme of ['classic','glass-light']) for (const delay of [100,500,1000,2400,3000]) {
        const context=await browser.newContext({viewport:{width:1440,height:900}});
        await context.addCookies([{name:'auth',value:'true',url:server.url}]);
        await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
        await context.route('**/api/og-image*',r=>r.fulfill({contentType:'image/jpeg',body:image}));
        await context.route('**/api/image-focus*',async r=>{
            await new Promise(resolve=>setTimeout(resolve,delay));
            await r.fulfill({json:{x:.85,y:.2,type:'face',palette:{primary:[180,90,40],secondary:[50,90,140]}}}).catch(()=>{});
        });
        const source=(await readFile('public/image-focus.js','utf8')).replace('const states = new Map();','const states = new Map(); win.__focusStates = states;');
        await context.route('**/public/image-focus.js*',r=>r.fulfill({contentType:'text/javascript',body:source}));
        const page=await context.newPage(), errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(()=>{
            window.focusFrames=[];
            const frame=()=>{
                const img=document.querySelector('.article-card .thumbnail-img'),card=img?.closest('.article-card');
                const state=window.__focusStates?.get(img);
                if (state && window.focusFrames.length<700) window.focusFrames.push({at:performance.now(),decoded:img.complete&&img.naturalWidth>0,focus:state.focus,deferred:state.deferred,shown:state.shown,settled:state.settled,palette:state.palette,
                    css:Object.fromEntries(['--image-focus-x','--image-focus-y','--hero-pos','--panel-tint','--blobs'].map(k=>[k,getComputedStyle(k.startsWith('--image-focus')?img:card).getPropertyValue(k)]))});
                requestAnimationFrame(frame);
            };requestAnimationFrame(frame);
        });
        const cdp=await context.newCDPSession(page), film=[];
        cdp.on('Page.screencastFrame',event=>{if(film.length<30)film.push(event);void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});});
        await cdp.send('Page.startScreencast',{format:'png',maxWidth:1440,maxHeight:900,everyNthFrame:1});
        await page.goto(server.url);
        await page.waitForTimeout(delay+1800);
        await cdp.send('Page.stopScreencast');
        for(let i=0;i<film.length;i++)await writeFile(`${output}/${theme}-${delay}-frame-${i}.png`,Buffer.from(film[i].data,'base64'));
        await cdp.detach();
        const frames=await page.evaluate(()=>window.focusFrames);
        rows.push({theme,delay,errors,frames,film:film.map((f,index)=>({index,...f.metadata}))});
        await page.screenshot({path:`${output}/${theme}-${delay}-settled.png`});
        await context.close();
        console.log(JSON.stringify({theme,delay,frames:frames.length,errors}));
    }
} finally {await browser.close();server.close();await writeFile(`${output}/frames.json`,JSON.stringify(rows,null,2));}
