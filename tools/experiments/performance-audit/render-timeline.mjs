// Local read-only navigation trace. No screenshots, response bodies or article
// contents are captured; API mutations are blocked inside the benchmark page.
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {protectBrowserApiWrites} from './read-only-browser.mjs';
const output=process.argv[2],browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
    const context=await browser.newContext({viewport:{width:1440,height:900}});
    await context.addCookies([{name:'auth',value:'true',url:'http://127.0.0.1:3000'}]);
    await context.addInitScript(()=>localStorage.setItem('theme','glass-light'));
    await protectBrowserApiWrites(context);
    const page=await context.newPage(),cdp=await context.newCDPSession(page);
    await page.goto('http://127.0.0.1:3000/#category/Forum',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).feeds.length>3);
    const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
    await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline',transferMode:'ReturnAsStream'});
    const actions=[];
    for(const target of [3,'top',3,'top']) actions.push(await page.evaluate(async target=>{
        const app=Alpine.$data(document.body),start=performance.now();performance.mark('reader-start-'+target);
        app.setFilter(target==='top'?'smart':'feed',target==='top'?'tech_vietnam':app.feeds[target].url);
        while(app.isLoadingArticles)await new Promise(resolve=>setTimeout(resolve,5));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        performance.mark('reader-end-'+target);
        return {target,ms:performance.now()-start,cards:app.articles.length,error:app.articleListError};
    },target));
    await cdp.send('Tracing.end');const {stream}=await complete;let raw='';
    for(;;){const part=await cdp.send('IO.read',{handle:stream});raw+=part.data;if(part.eof)break;}
    await cdp.send('IO.close',{handle:stream});
    await writeFile(output,raw);
    const events=JSON.parse(raw).traceEvents;
    const main=events.find(event=>event.name==='thread_name'&&event.args?.name==='CrRendererMain');
    const rows=events.filter(event=>event.ph==='X'&&event.pid===main?.pid&&event.tid===main?.tid);
    const totals=new Map();for(const event of rows)totals.set(event.name,(totals.get(event.name)||0)+(event.dur||0));
    const summary={actions,mainThread:main&&{pid:main.pid,tid:main.tid},inclusiveMs:[...totals].sort((a,b)=>b[1]-a[1]).map(([name,us])=>({name,ms:us/1000})),longTasks:rows.filter(event=>event.name==='RunTask'&&event.dur>=50000).map(event=>event.dur/1000)};
    await writeFile(output+'.summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
    if(actions.some(action=>action.error||!action.cards))throw Error('Navigation failed');
}finally{await browser.close();}
