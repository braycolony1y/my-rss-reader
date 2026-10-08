import {webkit,devices} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
const output=process.argv[2],server=await startFixtureServer();
const browser=await webkit.launch({headless:true});
const results=[];
try {
    for(const theme of ['classic','glass-light']) {
        const context=await browser.newContext({...devices['iPhone 13']});
        await context.addCookies([{name:'auth',value:'true',url:server.url}]);
        await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
        const page=await context.newPage(),errors=[],failures=[];
        page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failures.push({url:r.url(),failure:r.failure()}));
        const initial=Date.now();await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).articles.length);
        const row={theme,initialMs:Date.now()-initial,actions:[],errors,failures};
        for(const filter of ['feed','smart','feed'])row.actions.push(await page.evaluate(async filter=>{
            const app=Alpine.$data(document.body),at=performance.now();app.setFilter(filter,filter==='smart'?'tech_vietnam':'https://example.test/feed');
            while(app.isLoadingArticles)await new Promise(r=>setTimeout(r,10));
            await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
            return {action:filter,ms:performance.now()-at,cards:app.articles.length,error:app.articleListError};
        },filter));
        for(let i=0;i<10;i++)row.actions.push(await page.evaluate(async i=>{
            const app=Alpine.$data(document.body),at=performance.now();await app.openArticleOverlay(app.articles[0]);
            await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
            const result={action:i?'cached-open':'first-open',ms:performance.now()-at,readable:!!app.overlayContent,dom:document.querySelectorAll('*').length};
            const sc=document.getElementById('overlay-scroll-container');sc.scrollTop=sc.scrollHeight;result.scrollTop=sc.scrollTop;
            app.closeArticleOverlay({closeAll:true});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return result;
        },i));
        // Latency injection works in WebKit without Chromium-only CDP methods.
        await page.route('**/api/data?*',async route=>{await new Promise(r=>setTimeout(r,300));await route.continue();});
        await page.evaluate(()=>Alpine.$data(document.body).setFilter('smart','tech_vietnam'));
        await page.waitForFunction(()=>!Alpine.$data(document.body).isLoadingArticles);
        await context.setOffline(true);
        await page.evaluate(()=>Alpine.$data(document.body).setFilter('feed','https://example.test/offline'));
        await page.waitForFunction(()=>!Alpine.$data(document.body).isLoadingArticles);
        row.offline=await page.evaluate(()=>Alpine.$data(document.body).articleListError);
        await context.setOffline(false);await page.unroute('**/api/data?*');
        await page.evaluate(()=>Alpine.$data(document.body).fetchData());
        await page.waitForFunction(()=>!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).articles.length);
        row.recovered=await page.evaluate(()=>!Alpine.$data(document.body).articleListError);
        await page.screenshot({path:output+`-${theme}.png`});
        results.push(row);await writeFile(output,JSON.stringify({scope:'Actual Linux WebKit engine with iPhone viewport and UA; not physical iPhone or Safari. No OS background/resume or device-memory proof.',results},null,2));
        console.log(JSON.stringify(row));
        if(errors.length||!row.offline||!row.recovered||row.actions.some(a=>a.readable===false||a.cards===0||a.error))throw Error('WebKit acceptance failure');
        await context.close();
    }
}finally{await browser.close();server.close();}
