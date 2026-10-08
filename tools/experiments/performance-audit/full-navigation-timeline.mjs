import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const output=process.argv[2],browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const rows=[];
try {
    for(const theme of ['classic','glass-light']) {
        const context=await browser.newContext({viewport:{width:1440,height:900},extraHTTPHeaders:{'X-Reader-Trace':'1'}});
        await context.addCookies([{name:'auth',value:'true',url:'http://127.0.0.1:3000'}]);
        await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
        await context.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.fulfill({status:200,contentType:'application/json',body:'{}'}));
        const page=await context.newPage(),cdp=await context.newCDPSession(page),network=new Map();
        await cdp.send('Network.enable');
        cdp.on('Network.requestWillBeSent',e=>network.set(e.requestId,{path:new URL(e.request.url).pathname,at:e.wallTime*1000,timestamp:e.timestamp}));
        cdp.on('Network.responseReceived',e=>{const row=network.get(e.requestId);if(row)Object.assign(row,{protocol:e.response.protocol,timing:e.response.timing,serverTiming:e.response.headers['Server-Timing'],receivedAt:e.response.headers['X-Reader-Received-At']});});
        await page.goto('http://127.0.0.1:3000/#category/Forum',{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).feeds.length>6);
        await page.evaluate(()=>{
            const app=Alpine.$data(document.body),raw=Alpine.raw(document.body._x_dataStack[0]),fetchOriginal=window.fetch,parse=JSON.parse;
            window.auditActive=null;
            const setFilter=app.setFilter;app.setFilter=function(...args){if(window.auditActive)window.auditActive.handler=performance.now();return setFilter.apply(this,args);};
            window.fetch=async(...args)=>{
                const sample=window.auditActive,isList=String(args[0]).startsWith('/api/data?');
                if(sample&&isList)sample.requestCreated=performance.now();
                const response=await fetchOriginal(...args);
                if(sample&&isList){
                    sample.fetchHeaders=performance.now();const reader=response.body?.getReader.bind(response.body);
                    if(reader)response.body.getReader=(...args)=>{const result=reader(...args),read=result.read.bind(result);result.read=async(...args)=>{const chunk=await read(...args);if(chunk.done)sample.bodyComplete=performance.now();return chunk;};return result;};
                }
                return response;
            };
            JSON.parse=function(...args){const value=parse(...args);if(window.auditActive&&Array.isArray(value?.articles))window.auditActive.jsonParsed=performance.now();return value;};
            let articles=raw.articles;
            Object.defineProperty(raw,'articles',{configurable:true,enumerable:true,get(){return articles;},set(value){if(window.auditActive&&value?.length)window.auditActive.stateAssigned=performance.now();articles=value;}});
            new MutationObserver(()=>{const sample=window.auditActive;if(sample?.stateAssigned&&!sample.firstDomMutation)sample.firstDomMutation=performance.now();}).observe(document.getElementById('scroll-container'),{childList:true,subtree:true});
        });
        for(const target of [3,'top',4,'top',5,'top',3,'top']) {
            const action=await page.evaluate(async target=>{
                const app=Alpine.$data(document.body),sample={target,wall:Date.now(),action:performance.now()};window.auditActive=sample;
                app.setFilter(target==='top'?'smart':'feed',target==='top'?'tech_vietnam':app.feeds[target].url);
                while(app.isLoadingArticles)await new Promise(r=>setTimeout(r,5));
                sample.loadingEnded=performance.now();
                await new Promise(r=>requestAnimationFrame(r));
                sample.firstVisible=performance.now();sample.cards=[...document.querySelectorAll('.article-card')].filter(c=>c.getBoundingClientRect().height>0).length;
                await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));sample.stable=performance.now();sample.error=app.articleListError;
                sample.resources=performance.getEntriesByType('resource').filter(r=>r.startTime>=sample.action&&r.name.includes('/api/data?')).map(r=>({fetch:r.fetchStart,request:r.requestStart,firstByte:r.responseStart,complete:r.responseEnd,transferBytes:r.transferSize,decodedBytes:r.decodedBodySize,server:r.serverTiming.map(t=>({name:t.name,ms:t.duration}))}));
                window.auditActive=null;return sample;
            },target);
            rows.push({theme,...action,network:[...network.values()].filter(n=>n.at>=action.wall&&n.at<action.wall+action.stable-action.action)});
            await writeFile(output,JSON.stringify(rows,null,2));console.log(JSON.stringify({theme,target,ms:action.stable-action.action,cards:action.cards,error:action.error}));
            if(action.error||!action.cards)throw Error('Navigation failed');
        }
        await context.close();
    }
}finally{await browser.close();}
