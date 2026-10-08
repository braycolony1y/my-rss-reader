import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {startFixtureServer} from '../../../test/helpers/frontend-refactor/server.js';
const output=process.argv[2],browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const article={title:'Synthetic cached forum article',link:'https://voz.vn/t/audit-fixture.1234567/',feedUrl:'https://example.test/feed',siteName:'VOZ'};
const content=Array.from({length:40},(_,i)=>`<div class="voz-post" data-post-id="${i+1}" data-absolute-post-id="${1000+i}"><header><time data-source-time="2026-10-01T08:00:00Z">Original time</time></header><p>${'Representative synthetic forum text. '.repeat(20)}</p></div>`).join('');
const fixture={article,entries:[[article.link,{url:article.link,title:article.title,content,cached:true,siteName:'VOZ'}]],feeds:[{url:article.feedUrl,title:'Fixture'}],articles:[article],readStates:[article.link],recentReadAt:{},boardStates:[],userPreferences:{}};
const baseline=await readFile(output+'/client-before-source-times.js','utf8');
const server=await startFixtureServer({transformResponse:(value,url)=>url.pathname==='/api/data'?{...value,...fixture,articles:fixture.articles.slice(0,Number(url.searchParams.get('limit'))||40)}:value});
const rows=[];
try {
    for(const width of [1440,390])for(const variant of ['before','after']) {
        const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390});
        await context.addCookies([{name:'auth',value:'true',url:server.url}]);
        if(variant==='before')await context.route('**/script.js*',r=>r.fulfill({contentType:'text/javascript',body:baseline}));
        const page=await context.newPage();await page.goto(server.url);
        await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).articles.length);
        await page.evaluate(fixture=>{
            const app=Alpine.$data(document.body);app.articleContentCache=new Map(fixture.entries);window.auditArticle=fixture.article;
            window.auditStages=[];
            for(const name of ['saveState','formatSourceTimeMarkup','prepareArticleSpeech','checkVozThreadPosition','applyOverlayArticleData']) {
                const original=app[name];app[name]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{window.auditStages.push({name,ms:performance.now()-start});}};
            }
        },fixture);
        const samples=[];
        for(let i=0;i<16;i++) {
            samples.push(await page.evaluate(async()=>{
                const app=Alpine.$data(document.body);window.auditStages=[];const start=performance.now();
                await app.openArticleOverlay(window.auditArticle);const assigned=performance.now();
                await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
                return {ms:performance.now()-start,throughAssignmentMs:assigned-start,renderMs:performance.now()-assigned,bytes:app.overlayContent?.length,readable:!!app.overlayContent,stages:window.auditStages};
            }));
            await page.evaluate(()=>Alpine.$data(document.body).closeArticleOverlay({closeAll:true}));await page.waitForTimeout(200);
        }
        rows.push({width,variant,samples});await writeFile(output+'/cached-replay.json',JSON.stringify(rows,null,2));
        console.log(JSON.stringify({width,variant,samples:samples.map(s=>s.ms)}));await context.close();
    }
}finally{await browser.close();server.close();}
