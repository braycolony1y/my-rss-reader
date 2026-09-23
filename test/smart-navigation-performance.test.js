import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { smartDestination } from '../src/utils/smart-destinations.js';
import { indexStoriesById } from '../src/articles/story-index.js';
import { createBrowserFetchQueue } from '../src/browser/fetch-queue.js';
import { createArticleFetchPolicy } from '../src/articles/fetch-policy.js';
import { getSmartDestinationPartition, normalizeArticle } from '../smart-news.js';
const deferred = () => { let resolve, reject; const promise = new Promise((r,j) => { resolve=r; reject=j; }); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function reader(t) {
    const dom = new JSDOM('<body></body>', {url:'https://reader.test/#smart/news_global',runScripts:'outside-only',pretendToBeVisual:true});
    dom.window.fetch = async () => ({ok:true,json:async()=>({})});
    dom.window.eval(readFileSync(new URL('../script.js', import.meta.url),'utf8'));
    t.after(()=>dom.window.close());
    const app=dom.window.rssApp(); app.fetchData=async()=>{}; app.syncUserPreferenceDebounced=()=>{};
    return {app,window:dom.window};
}

test('Tech regions have independent URLs, restore on navigation, and retain region across sections', async t => {
    const {app,window}=reader(t);
    app.setFilter('smart','news_global'); app.setSmartSection('tech');
    assert.equal(window.location.hash,'#smart/tech_global');
    await app.setSmartRegion('vietnam');
    assert.equal(window.location.hash,'#smart/tech_vietnam');
    app.setSmartSection('finance');
    assert.equal(window.location.hash,'#smart/finance_vietnam');
    app.setSmartSection('tech');
    assert.equal(window.location.hash,'#smart/tech_vietnam');
    window.location.hash='#smart/tech_global';
    await app.handleHashChange();
    assert.equal(app.selectedFilterValue,'tech_global');
    app.setFilter('smart','news_world');
    assert.equal(window.location.hash,'#smart/news_global');
    assert.equal(app.headerTitle,'Smart News · Global');
    window.location.hash='#smart/tech_world?article='+encodeURIComponent('https://example.org/thread');
    const route=app.getFilterFromHash();
    assert.equal(route.value,'tech_global'); assert.equal(route.articleUrl,'https://example.org/thread');
});

test('legacy destination aliases normalize to Global without losing the Tech region', () => {
    for(const section of ['news','finance','tech']) {
        assert.equal(smartDestination(section+'_world'),section+'_global');
        assert.equal(smartDestination(section+'_foreign'),section+'_global');
        assert.equal(smartDestination(section,'vietnam'),section+'_vietnam');
        assert.equal(getSmartDestinationPartition({smartCategory:section+'_global'}),section+'_global');
        assert.equal(getSmartDestinationPartition({smartCategory:section+'_world'}),section+'_global');
    }
    assert.equal(smartDestination('tech_vietnam','global'),'tech_vietnam');
    assert.equal(normalizeArticle({link:'https://example.com/news',title:'An election report'}, {category:'news_world'}).smartCategory,'news_global');
});

test('scroll viewport indexes reuse the snapshot and invalidate on a replacement', () => {
    let reads=0;
    const articles=Array.from({length:10000},(_,i)=>({get clusterId(){reads++;return String(i);}}));
    const first=indexStoriesById(articles); const initialReads=reads;
    for(let i=0;i<20;i++) assert.strictEqual(indexStoriesById(articles),first);
    assert.equal(reads,initialReads);
    const next=[{clusterId:'0',title:'Updated'}];
    assert.equal(indexStoriesById(next).get('0').title,'Updated');
    assert.notStrictEqual(indexStoriesById(next),first);
});

test('warm browser reserves capacity for the reader, prioritizes queued reads and shares duplicate fetches', async () => {
    const queue=createBrowserFetchQueue({canFetchConcurrently:()=>true});
    const a=deferred(), b=deferred(), c=deferred(); const started=[];
    const background=queue.run('background',()=>{started.push('background');return a.promise;},3);
    const later=queue.run('later',()=>{started.push('later');return b.promise;},3);
    await tick(); assert.deepEqual(started,['background']);
    const foreground=queue.run('reader',()=>{started.push('reader');return c.promise;},0);
    const duplicate=queue.run('reader',()=>assert.fail('duplicate fetch'),0);
    assert.strictEqual(foreground,duplicate);
    await tick(); assert.deepEqual(started,['background','reader']);
    c.resolve('article'); assert.equal(await foreground,'article');
    a.resolve(); await background; await tick(); assert.deepEqual(started,['background','reader','later']);
    b.resolve(); await later;
});

test('cold and navigating browser requests stay serial, and failures do not poison the queue', async () => {
    const queue=createBrowserFetchQueue(); const gate=deferred(); const started=[];
    const first=queue.run('first',()=>gate.promise,3); const rejected=assert.rejects(first,/offline/);
    const background=queue.run('background',()=>started.push('background'),3);
    const foreground=queue.run('foreground',()=>started.push('foreground'),0);
    await tick(); assert.deepEqual(started,[]);
    gate.reject(new Error('offline')); await rejected; await foreground; await background;
    assert.deepEqual(started,['foreground','background']);
});

test('warm Voz transport goes first only when the configured allowlist permits it', async () => {
    const feed={url:'https://voz.vn/f/news.1/index.rss',fetchMethods:['cloudflare','opencli-fetch']};
    const policy=createArticleFetchPolicy({env:{RSS_DATA:{get:async()=>[feed]}},isBrowserWarm:()=>true});
    assert.deepEqual((await policy.getArticleFetchPolicy('https://voz.vn/t/a.123',feed.url)).strategyOrder,['opencli-fetch','cloudflare']);
    assert.deepEqual(feed.fetchMethods,['cloudflare','opencli-fetch']);
    feed.fetchMethods=['cloudflare'];
    assert.deepEqual((await policy.getArticleFetchPolicy('https://voz.vn/t/a.123',feed.url)).strategyOrder,['cloudflare']);
});

test('opening an article checks upcoming cache metadata without preparing other thread bodies', async () => {
    const {createArticlePrefetch}=await import('../src/feeds/prefetch.js');
    const service=createArticlePrefetch({
        env:{RSS_DATA:{get:async()=>[]}},
        getCachedArticle:async()=>assert.fail('Must not render speculative thread bodies'),
        getCachedArticleMetadata:async url=>({fresh:url.endsWith('/cached')})
    });
    assert.deepEqual(await service.triggerNextFiveArticlesPrefetch('https://example.com/current',true,
        ['https://example.com/cached','https://example.com/stale']),[
        {url:'https://example.com/cached',isCached:true},{url:'https://example.com/stale',isCached:false}
    ]);
});

test('Tech destination URLs select the correct region in both Classic and Top APIs', async () => {
    const {createArticlePresentation}=await import('../src/articles/presentation.js');
    const articles=['vietnam','global'].map(region=>({
        link:`https://example.com/${region}`,clusterId:region,isCluster:true,title:`New software release ${region}`,
        pubDate:new Date().toISOString(),smartCategory:'tech',region:region==='global'?'foreign':region,
        language:region==='vietnam'?'vi':'en',image:'https://example.com/image.jpg',
        ranking:{score:1},topStory:{feed:`tech_${region}`,rank:1,isTop:true,cutoff:{count:1}}
    }));
    const state={smartClusters:articles,smartRawArticles:[],smartClusterVersion:'v1',
        topStoriesPublished:{policy:2,articles,createdAt:Date.now(),signature:'fixture',clusterVersion:'v1'},
        userPreferences:{smartTabModes:{__all:'classic'}}};
    const presentation=createArticlePresentation({env:{RSS_DATA:{get:async key=>state[key]}}});
    for(const mode of ['classic','top']) for(const region of ['vietnam','global']) {
        let result;
        await presentation.serveSmartData({query:{filterValue:`tech_${region}`,smartMode:mode}},
            {setHeader(){},json(data){result=data;}});
        assert.equal(result.articles.length,1,`${mode} ${region}`);
        assert.equal(result.articles[0].link,`https://example.com/${region}`);
    }
});
