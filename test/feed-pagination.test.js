import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
function fixture(fetch) {
    const context = vm.createContext({ performance, URL, URLSearchParams, AbortController, console,
        setTimeout:()=>0, clearTimeout(){}, setInterval:()=>0, clearInterval(){},
        window:{history:{replaceState(){}}}, document:{getElementById:()=>({scrollTo(){}})},fetch });
    vm.runInContext(fs.readFileSync(new URL('../public/js/article/prefetch-lifecycle.js',import.meta.url),'utf8'),context);
    for(const file of ['list-publication','page-session','requests','pagination','list'])vm.runInContext(fs.readFileSync(new URL(`../public/js/feeds/${file}.js`,import.meta.url),'utf8'),context);
    const app=vm.runInContext('ReaderFeedsList.create()',context);
    app.publication = vm.runInContext('ReaderListPublication', context);
    Object.assign(app,{selectedFilterType:'category',selectedFilterValue:'Forums',isMobile:true,
        hideRead:false,searchQuery:'',articles:[{link:'old'}],pendingReadLinks:[],pendingUnreadLinks:new Set(),pendingRecentReadLinks:new Set(),
        readStates:new Set(),pendingPreferences:{},applyPendingStateMutations:(_,v)=>v,hideTooltip(){},$nextTick:async()=>{},saveState(){}});
    return app;
}
const response = data => ({ok:true,json:async()=>data});
test('background refresh retains card identity while updating fields and preserving visible membership',async()=>{
    const app=fixture(async()=>response({articles:[
        {link:'b',title:'Fresh B',image:'/new-b.jpg'},
        {id:'stable-a',link:'canonical-a',title:'Fresh A',briefing:{status:'ready'}},
        {link:'new',title:'Do not insert during revalidation'}
    ]}));
    const a={id:'stable-a',link:'old-a',title:'Old A',localField:'preserved'},b={link:'b'},missing={link:'missing'};
    app.articles=[a,b,missing];
    const keys=app.articles.map((article,index)=>app.articleRowKey(article,index));
    await app.fetchData(false,true,true);
    assert.equal(app.articles[0],a);assert.equal(app.articles[1],b);assert.equal(app.articles[2],missing);
    assert.deepEqual(Array.from(app.articles,(article,index)=>app.articleRowKey(article,index)),keys);
    assert.equal(a.title,'Fresh A');assert.equal(a.link,'canonical-a');assert.equal(a.localField,'preserved');
    assert.equal(a.briefing.status,'ready');assert.equal(b.image,'/new-b.jpg');
    assert.equal(app.articles.length,3);
});
test('background refresh preserves page cursor and membership, so Next requests the next forum page',async()=>{
    const pages=[]; const app=fixture(async url=>{const page=+new URL(url,'http://reader').searchParams.get('page');pages.push(page);return response({articles:[{link:`page-${page}`}],hasMore:true});});
    app.currentPage=3;app.articles=[{link:'page-3'}];
    await app.fetchData(false,false,true);
    assert.equal(app.currentPage,3);assert.deepEqual(Array.from(app.articles,a=>a.link),['page-3']);
    await app.goToPage(4);assert.deepEqual(pages,[3,4]);assert.deepEqual(Array.from(app.articles,a=>a.link),['page-4']);
});
test('background refresh cannot cancel an in-flight explicit page transition',async()=>{
    let resolve; const gate=new Promise(r=>resolve=r);let requests=0;
    const app=fixture(async()=>{requests++;await gate;return response({articles:[{link:'next'}],hasMore:true});});
    const next=app.goToPage(2);await app.fetchData(false,false,true);assert.equal(requests,1);
    resolve();await next;assert.equal(app.currentPage,2);assert.equal(app.articles[0].link,'next');
});
test('duplicate-only append pauses auto-loading; a manual retry can resume progress',async()=>{
    let calls=0;const app=fixture(async()=>response({articles:[{link:++calls===1?'old':'new'}],hasMore:true}));app.isMobile=false;
    await app.loadMore();assert.equal(app._autoLoadPaused,true);assert.equal(app.isLoadingMore,false);
    app._autoLoadContext=JSON.stringify(['category','Forums',false,'']);
    app.handleScroll({target:{scrollTop:1000,scrollHeight:1100,clientHeight:800}});assert.equal(calls,1);
    await app.loadMore();assert.equal(calls,2);assert.equal(app._autoLoadPaused,false);
});
test('HTTP failure rolls back the cursor and restores the mobile page',async()=>{
    const app=fixture(async()=>({ok:false}));await app.goToPage(2);
    assert.equal(app.currentPage,1);assert.equal(app.articles[0].link,'old');assert.equal(app.isLoadingMore,false);
});
test('expired snapshot does not replace the list with page one and restart infinite loading',async()=>{
    const app=fixture(async()=>response({viewReset:true,articles:[{link:'page-one'}],hasMore:true}));
    app.currentPage=7;await app.loadMore();assert.equal(app.currentPage,7);assert.equal(app.articles[0].link,'old');assert.equal(app.hasMore,false);
});

test('cached tab paints immediately and revalidation applies authoritative order with existing row identity', async () => {
    let finish;
    const app = fixture(async () => { await new Promise(resolve => { finish = resolve; }); return response({ articles: [{ link: 'b', title: 'Fresh B' }, { link: 'a', title: 'Fresh A' }], hasMore: false }); });
    const a = { link: 'a', title: 'Old A' }, b = { link: 'b', title: 'Old B' };
    app.articles = [a, b]; app.currentPage = 1; app.hasMore = true;
    app.publication.commit(app);
    app.articles = [];
    assert.equal(app.publication.restore(app), true);
    assert.equal(app.articles[0], a);
    const pending = app.fetchData();
    assert.equal(app.articles[0], a, 'cached row remains visible during the request');
    finish(); await pending;
    assert.deepEqual(Array.from(app.articles, article => article.link), ['b', 'a']);
    assert.equal(app.articles[0].title, 'Fresh B');
    assert.equal(app.articles[0], b, 'the accepted response reuses the cached row');
});

test('tab cache rejects changed read, hidden, keyword and feed state and stores only first pages', () => {
    let now = 100;
    const publication = vm.runInNewContext(fs.readFileSync(new URL('../public/js/feeds/list-publication.js', import.meta.url), 'utf8') + ';ReaderListPublication', { Date: { now: () => now } });
    const app = { selectedFilterType: 'smart', selectedFilterValue: 'news_global', smartRegion: 'global',
        currentPage: 1, articles: [{ link: 'a' }], readStates: new Set(), hiddenStates: [], blockedKeywords: [], feeds: [] };
    const restore = () => { app.articles = []; return publication.restore(app); };
    publication.commit(app);
    assert.equal(restore(), true);
    app.readStates.add('a'); assert.equal(restore(), false);
    app.readStates.clear(); assert.equal(restore(), true);
    app.hiddenStates.push('a'); assert.equal(restore(), false);
    app.hiddenStates = []; app.blockedKeywords = ['a']; assert.equal(restore(), false);
    app.blockedKeywords = []; app.feeds = [{ url: 'new-feed' }]; assert.equal(restore(), false);
    app.feeds = []; app.isMobile = true; assert.equal(restore(), false);
    app.isMobile = false; now += 60001; assert.equal(restore(), false);
    app.articles = [{ link: 'page-two' }]; app.currentPage = 2; publication.commit(app);
    assert.equal(restore(), false, 'page two is never restored as page one');
});

test('lean Stories requests preserve held metadata and reconcile authoritative state', async () => {
    let params;
    const app = fixture(async url => { params = new URL(url, 'http://reader').searchParams;
        return response({ articles: [{ link: 'new' }], readStates: ['server-read'], savedStates: [], boardStates: [], hiddenStates: [] }); });
    Object.assign(app, { selectedFilterType: 'smart', selectedFilterValue: 'news_global', smartRegion: 'global',
        normalizeSmartDestination: value => value, getFilterFromHash: () => ({}), _fullStateLoaded: true,
        feeds: [{ url: 'feed' }], categoryOrder: ['news'], userPreferences: { held: true }, hiddenStates: ['stale-hidden'] });
    await app.fetchData();
    assert.equal(params.get('lean'), '1');
    assert.equal(app.feeds[0].url, 'feed');
    assert.equal(app.categoryOrder[0], 'news');
    assert.equal(app.userPreferences.held, true);
    assert.deepEqual([...app.readStates], ['server-read']);
    assert.equal(app.hiddenStates.length, 0);
});
