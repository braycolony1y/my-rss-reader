import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
const output = process.argv[2];
if (!output) throw Error('Output directory required');
const before = await readFile(output+'/client-before.js','utf8');
let payloads;
try { payloads=JSON.parse(await readFile(output+'/navigation-payloads.json','utf8')); }
catch {
    const capture=JSON.parse(await readFile(output+'/navigation-baseline.json','utf8'));
    payloads={};
    for (const mode of ['feed','top']) {
        const url=capture.find(run=>!run.mobile).resources.find(row=>row.url.includes(mode==='feed'?'filterType=feed':'filterType=smart')).url;
        payloads[mode]=await (await fetch(url,{headers:{Cookie:'auth=true'}})).json();
    }
    await writeFile(output+'/navigation-payloads.json',JSON.stringify(payloads));
}
const server=await startFixtureServer({transformResponse:(value,url)=>{
    if(url.pathname!=='/api/data')return value;
    const data=payloads[url.searchParams.get('filterType')==='smart'?'top':'feed'];
    return {...data,articles:data.articles.slice(0,Number(url.searchParams.get('limit'))||40)};
}});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const rows=[];
try {
    for(const width of [1440,390])for(const theme of ['classic','glass-light'])for(const mode of ['feed','top'])for(const variant of ['before','after']) {
        const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390});
        await context.addCookies([{name:'auth',value:'true',url:server.url}]);
        await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
        if(variant==='before')await context.route('**/script.js*',r=>r.fulfill({contentType:'text/javascript',body:before}));
        const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).articles.length);
        await page.evaluate(mode=>Alpine.$data(document.body).setFilter(mode==='top'?'smart':'feed',mode==='top'?'tech_vietnam':'fixture'),mode);
        await page.waitForFunction(()=>!Alpine.$data(document.body).isLoadingArticles);
        const samples=[];
        for(let i=0;i<12;i++) {
            samples.push(await page.evaluate(async()=>{
                const app=Alpine.$data(document.body),at=performance.now();
                await app.fetchData();const assigned=performance.now();
                await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
                return {ms:performance.now()-at,requestParseAssign:assigned-at,render:performance.now()-assigned};
            }));
            await page.waitForTimeout(150);
        }
        const geometry=await page.evaluate(()=>[...document.querySelectorAll('.article-card')].filter(c=>c.getBoundingClientRect().height).map(c=>{const r=c.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,title:c.querySelector('h2')?.textContent};}));
        const row={width,theme,mode,variant,samples,geometry,errors};rows.push(row);
        await writeFile(output+'/matched-navigation.json',JSON.stringify(rows,null,2));
        console.log(JSON.stringify({...row,geometry:geometry.length,samples:samples.map(s=>Math.round(s.ms))}));
        await context.close();
    }
} finally {await browser.close();server.close();}
