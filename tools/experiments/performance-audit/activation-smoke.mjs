// Read-only live activation smoke; counts and flags only, no article contents.
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {protectBrowserApiWrites} from './read-only-browser.mjs';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}), rows=[];
try {
    for(const theme of ['classic','glass-light']) {
        const context=await browser.newContext({viewport:{width:1440,height:900}});
        await context.addCookies([{name:'auth',value:'true',url:'http://127.0.0.1:3000'}]);
        await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
        await protectBrowserApiWrites(context);
        const page=await context.newPage(),errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto('http://127.0.0.1:3000/#category/Forum',{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>window.Alpine&&!Alpine.$data(document.body).isLoadingArticles&&Alpine.$data(document.body).articles.length,null,{timeout:90000});
        const row={theme,errors,actions:[]};
        for(const mode of (process.argv.includes('--cached-only')?[]:['feed','top'])) {
            await page.evaluate(mode=>{const a=Alpine.$data(document.body);return a.setFilter(mode==='top'?'smart':'feed',mode==='top'?'tech_vietnam':a.feeds[0].url);},mode);
            await page.waitForFunction(()=>!Alpine.$data(document.body).isLoadingArticles,null,{timeout:90000});
            row.actions.push(await page.evaluate(mode=>{const a=Alpine.$data(document.body);return {mode,count:a.articles.length,error:a.articleListError,focusActive:document.documentElement.dataset.imageFocus};},mode));
        }
        await page.evaluate(()=>{const a=Alpine.$data(document.body);return a.setFilter('category','Forum');});
        await page.waitForFunction(()=>!Alpine.$data(document.body).isLoadingArticles,null,{timeout:90000});
        await page.waitForFunction(()=>{const a=Alpine.$data(document.body);return a.articles.some(x=>a.articleContentCache?.has(a.articleReaderUrl(x)));},null,{timeout:30000}).catch(()=>{});
        const opened=await page.evaluate(async()=>{
            const a=Alpine.$data(document.body),article=a.articles.find(x=>a.articleContentCache?.has(a.articleReaderUrl(x)));
            if(!article)return {tested:false,reason:'No cached card in this view'};
            await a.openArticleOverlay(article);
            await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
            const result={tested:true,readable:!!a.overlayContent,cached:a.overlayFetchedFromCache,error:a.overlayError};
            a.closeArticleOverlay({closeAll:true});return result;
        });
        row.cachedOpen=opened;rows.push(row);
        await context.close();
    }
} finally {await browser.close();await writeFile(process.argv[2],JSON.stringify(rows,null,2));}
console.log(JSON.stringify(rows));
if(rows.some(r=>r.errors.length||r.actions.some(a=>a.error||!a.count)))throw Error('Live activation smoke failed');
