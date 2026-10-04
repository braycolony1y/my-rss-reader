import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
function fixture(fetch) {
    const context = vm.createContext({ performance, URLSearchParams, AbortController, console,
        setTimeout:()=>0, clearTimeout(){}, setInterval:()=>0, clearInterval(){},
        window:{history:{replaceState(){}}}, document:{getElementById:()=>({scrollTo(){}})},fetch });
    for(const file of ['requests','pagination','list'])vm.runInContext(fs.readFileSync(new URL(`../public/js/feeds/${file}.js`,import.meta.url),'utf8'),context);
    const app=vm.runInContext('ReaderFeedsList.create()',context);
    Object.assign(app,{selectedFilterType:'category',selectedFilterValue:'Forums',usesTopStories:false,isMobile:true,
        hideRead:false,searchQuery:'',articles:[{link:'old'}],pendingReadLinks:[],pendingUnreadLinks:new Set(),pendingRecentReadLinks:new Set(),
        readStates:new Set(),pendingPreferences:{},applyPendingStateMutations:(_,v)=>v,hideTooltip(){},scheduleBriefingRefresh(){},$nextTick:async()=>{},saveState(){}});
    return app;
}
const response = data => ({ok:true,json:async()=>data});
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
    app._autoLoadContext=JSON.stringify(['category','Forums',undefined,false,'']);
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
