import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/js/feeds/requests.js',import.meta.url),'utf8');
function fixture(fetch){
 let timeout;
 const methods=vm.runInNewContext(source+';ReaderFeedRequests',{URLSearchParams,AbortController,performance,console:{error(){}},window:{},setTimeout:fn=>(timeout=fn,1),setInterval:()=>1,clearTimeout(){},clearInterval(){},fetch});
 const app={selectedFilterType:'feed',selectedFilterValue:'fixture',articleRequestGeneration:0,articles:[],topStories:[],currentPage:1,isMobile:true,scheduleBriefingRefresh(){}};
 return {app,run:()=>methods.fetchData.call(app),expire:()=>timeout()};
}
test('mobile list timeout is a failed result with a retry explanation, never stale success',{timeout:2000},async()=>{
 const f=fixture((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})));
 f.app._lastArticlePageResult={ok:true};const pending=f.run();f.expire();
 const result=await pending;assert.equal(result.reason,'timeout');assert.equal(f.app._lastArticlePageResult.failed,true);assert.match(f.app.articleListError,/too long/);assert.equal(f.app.isLoadingArticles,false);
});
test('HTTP and connection failures are distinguished and clear loading',{timeout:2000},async()=>{
 for(const status of [503,0]){
  const f=fixture(async()=>{if(!status)throw Error('offline');return {ok:false,status};});
  const result=await f.run();assert.equal(result.reason,status?'server':'network');assert.ok(f.app.articleListError);assert.equal(f.app.isLoadingArticles,false);
 }
});
test('cancelled old navigation cannot overwrite the new navigation error or result',{timeout:2000},async()=>{
 let reject;const f=fixture(()=>new Promise((resolve,no)=>reject=no));const pending=f.run();
 f.app.articleRequestGeneration++;f.app.articleListError='new state';f.app._lastArticlePageResult={ok:true};
 reject(new DOMException('Aborted','AbortError'));assert.equal((await pending).cancelled,true);assert.equal(f.app.articleListError,'new state');assert.equal(f.app._lastArticlePageResult.ok,true);
});
