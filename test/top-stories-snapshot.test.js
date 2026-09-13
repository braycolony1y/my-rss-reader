import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createTopStoriesSnapshots} from '../src/articles/top-stories-snapshot.js';
import {createTopStoriesIndex} from '../src/articles/top-stories.js';
import {createStoryBriefings, ANALYSIS_VERSION} from '../src/articles/story-briefing.js';
const article = id => ({clusterId:id,link:`https://example.com/${id}`,feedUrl:'https://example.com/rss',title:`Critical vulnerability in router ${id}`,content:'A critical vulnerability affects router firmware.',language:'en',pubDate:'2026-09-13T00:00:00Z'});
const ranked = id => ({...article(id),ranking:{score:1},topStory:{feed:'tech_world',rank:1,isTop:true,cutoff:{count:1},material_version:1}});
const published = {policy:1,signature:'old',createdAt:1,articles:[ranked('old')],states:{}};
function fixture(extra={}) {
 const values={topStoriesPublished:structuredClone(published),smartClusters:[article('new')],smartRawArticles:[],smartSources:[{url:'https://example.com/rss',category:'tech',region:'world'}],...extra};
 let calls=0, writes=0, clock=180000;
 const db={get:async key=>values[key],put:async(key,value)=>{writes++;values[key]=JSON.parse(value)}};
 const service=createTopStoriesSnapshots({db,now:()=>clock,report:()=>{},compute:async input=>{calls++;return {articles:[ranked(input.candidates[0].clusterId)],states:{}}}});
 return {service,db,values,get calls(){return calls},get writes(){return writes},advance(){clock+=60000}};
}
test('A/E: cached refresh and feed reuse do no ranking; unchanged revalidation does no work', async()=>{
 const f=fixture(); assert.equal((await f.service.get()).articles[0].clusterId,'old'); assert.equal(f.calls,0);
 await f.service.revalidate(); assert.equal(f.calls,1);
 await f.service.get(); await f.service.revalidate(); assert.equal(f.calls,1);
 f.advance(); await f.service.revalidate(); assert.equal(f.calls,2,'freshness boundary reconciles deterministically');
});
test('B: a provisional cluster publication cannot replace completed ranking',async()=>{
 const f=fixture({smartClusterState:{provisional:true}});
 await f.service.revalidate(); assert.equal(f.calls,0); assert.equal((await f.service.get()).articles[0].clusterId,'old');
 f.values.smartClusterState={provisional:false}; await f.service.revalidate(); assert.equal((await f.service.get()).articles[0].clusterId,'new');
});
test('C/G: in-flight, failed, empty, and persistence-failed replacements retain the last valid view',async()=>{
 for (const failure of ['compute','empty','persist','success']) {
  const f=fixture(); let release; const gate=new Promise(r=>release=r);
  const service=createTopStoriesSnapshots({db:{...f.db,put:async(...args)=>{if(failure==='persist')throw Error('disk');return f.db.put(...args)}},report:()=>{},compute:async()=>{await gate;if(failure==='compute')throw Error('ranking');return {articles:failure==='empty'?[]:[ranked('new')],states:{}}}});
  const work=service.revalidate(); await new Promise(r=>setImmediate(r));
  assert.equal((await service.get()).articles[0].clusterId,'old');
  release(); await work;
  assert.equal((await service.get()).articles[0].clusterId,failure==='success'?'new':'old');
 }
});
test('I: a new service loads durable cards without reading candidates or invoking ranking',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'top-snapshot-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const filename=path.join(dir,'published.json'); await fs.writeFile(filename,JSON.stringify(published));
 const service=createTopStoriesSnapshots({db:{get:async key=>{assert.equal(key,'topStoriesPublished');return JSON.parse(await fs.readFile(filename))}},compute:()=>assert.fail('must not rank')});
 assert.deepEqual((await service.get()).articles,published.articles);
});
test('legacy ranked state is reused only when stored evidence still matches',async()=>{
 const f=fixture({topStoriesPublished:null});
 const index=createTopStoriesIndex({db:f.db});
 await index.rank(f.values.smartClusters,f.values.smartSources);
 const result=await f.service.get(); assert.equal(result.articles[0].clusterId,'new');assert.equal(f.calls,0);
 assert.equal(result.articles[0].topStory.rank,1);
});
test('D/H: previous completed briefing survives material update, partial generation, failure, and restart',async()=>{
 const old={analysisVersion:ANALYSIS_VERSION,briefing_version:1,sections:[{label:'What happened',text:'Previous useful analysis.'}],keyFacts:[]};
 const values={storyBriefings:{[`latest:tech_world:old:analysis:${ANALYSIS_VERSION}`]:old}};
 const db={get:async k=>values[k],put:async(k,v)=>values[k]=JSON.parse(v)};
 let calls=0;
 const generate=async()=>{calls++;throw Error('offline test')};
 const service=createStoryBriefings({db,generate}); const next={...ranked('old'),topStory:{...ranked('old').topStory,material_version:2}};
 const initial=await service.get(next,'tech_world');assert.equal(initial.status,'stale');assert.equal(initial.analysisStatus,'evaluated');assert.equal(initial.sections[0].text,old.sections[0].text);
 await new Promise(r=>setTimeout(r,10));
 const failed=await service.get(next,'tech_world');assert.equal(failed.status,'stale');assert.equal(failed.generationState,'failed');assert.equal(calls,1);
 const restarted=createStoryBriefings({db,generate});assert.equal((await restarted.get(next,'tech_world',{generate:false})).sections[0].text,old.sections[0].text);
 const partial=createStoryBriefings({db,generate:async()=>JSON.stringify({sections:[{label:'What happened',text:'A vulnerability affects routers.',evidence:[{sourceId:1,quote:'A critical vulnerability affects router firmware.'}]}]})});
 await partial.get(next,'tech_world');await new Promise(r=>setTimeout(r,10));
 assert.equal((await partial.get(next,'tech_world')).sections[0].text,old.sections[0].text);
 assert.equal(values.storyBriefings[`latest:tech_world:old:analysis:${ANALYSIS_VERSION}`].briefing_version,1);
 const corrected={...next,topStory:{...next.topStory,timeline:[{correction:true}]}};
 assert.equal((await restarted.get(corrected,'tech_world',{generate:false})).sections.length,0);
});
test('A: current cached analysis never invokes generation',async()=>{
 const a=ranked('cached'), result={analysisVersion:ANALYSIS_VERSION,sections:[{label:'What happened',text:'Cached.'}]};
 const db={get:async()=>({[`tech_world:cached:material:1:analysis:${ANALYSIS_VERSION}`]:result})};
 const service=createStoryBriefings({db,generate:()=>assert.fail('cached refresh must not generate')});
 for(let i=0;i<3;i++)assert.equal((await service.get(a,'tech_world')).status,'ready');
});
test('a current latest briefing remains a cache hit if its historical key was evicted',async()=>{
 const a=ranked('cached');
 const result={analysisVersion:ANALYSIS_VERSION,briefing_version:1,sections:[{label:'What happened',text:'Cached.'}]};
 const service=createStoryBriefings({db:{get:async()=>({[`latest:tech_world:cached:analysis:${ANALYSIS_VERSION}`]:result})},generate:()=>assert.fail('must reuse latest')});
 assert.equal((await service.get(a,'tech_world')).status,'ready');
});
test('A/B/E/F: News → Finance → News serves cached cards during RSS processing without AI',async()=>{
 const {EventEmitter}=await import('node:events');
 const {createArticlePresentation}=await import('../src/articles/presentation.js');
 const cards=[['news','news_vietnam'],['finance','finance_vietnam']].map(([id,feed])=>({...ranked(id),topStory:{...ranked(id).topStory,feed}}));
 const values={topStoriesPublished:{policy:1,articles:cards},smartClusterState:{provisional:true},storyBriefings:{}};
 for(const a of cards)values.storyBriefings[`${a.topStory.feed}:${a.clusterId}:material:1:analysis:${ANALYSIS_VERSION}`]={analysisVersion:ANALYSIS_VERSION,briefing_version:1,sections:[{label:'What happened',text:'Cached factual excerpt.'}]};
 let calls=0;
 const p=createArticlePresentation({env:{RSS_DATA:{get:async k=>values[k]}},generateBriefing:async()=>{calls++;throw Error('unexpected AI')},getLastKnownCachedArticle:async()=>null});
 for(const feed of ['news_vietnam','finance_vietnam','news_vietnam']){
  const res=new EventEmitter();res.setHeader=()=>{};res.json=value=>{res.payload=value;};
  await p.serveSmartData({query:{filterValue:feed,smartMode:'top'}},res);
  assert.equal(res.payload.articles.length,1);assert.equal(res.payload.articles[0].briefing.status,'ready');
  res.emit('finish');await new Promise(r=>setTimeout(r,40));
 }
 assert.equal(calls,0);
});
test('a superseded factual figure falls back to source content while unaffected analysis remains',async()=>{
 const next={...ranked('count'),content:'The hospital now reports 95 suspected cases.',topStory:{...ranked('count').topStory,material_version:2}};
 const previous={analysisVersion:ANALYSIS_VERSION,briefing_version:1,sections:[
  {label:'What happened',text:'There were 133 suspected cases.',citations:[{link:next.link,quote:'The hospital reports 133 suspected cases.'}]},
  {label:'Why it matters',text:'The facility remains closed.',citations:[{link:next.link,quote:'The facility remains closed.'}]}
 ]};
 const service=createStoryBriefings({db:{get:async()=>({[`latest:tech_world:count:analysis:${ANALYSIS_VERSION}`]:previous})}});
 const result=await service.get(next,'tech_world',{generate:false});
 assert.equal(result.status,'stale');assert.equal(result.analysisStatus,'evaluated');assert.equal(result.partiallyInvalidated,true);
 assert.deepEqual(result.sections.map(s=>s.label),['Why it matters']);
});
test('a completed material update refreshes safe card content without changing the reader token or cutoff',async()=>{
 const {EventEmitter}=await import('node:events');
 const {createArticlePresentation}=await import('../src/articles/presentation.js');
 const original={...article('hospital'),title:'Hospital reports 133 suspected cases',content:'Hospital reports 133 suspected cases.'};
 const values={smartClusters:[original],smartRawArticles:[],smartSources:[{url:original.feedUrl,category:'news_world'}],storyBriefings:{}};
 const db={get:async k=>values[k],put:async(k,v)=>{values[k]=JSON.parse(v)}};
 const index=createTopStoriesIndex({db});const initial=await index.rank(values.smartClusters,values.smartSources);
 values.topStoriesPublished={policy:1,articles:initial};
 const item=initial[0], version=item.topStory.material_version;
 const briefing={analysisVersion:ANALYSIS_VERSION,briefing_version:version,sections:[{label:'What happened',text:original.content,citations:[{link:original.link,quote:original.content}]}]};
 values.storyBriefings[`news_world:${item.clusterId}:material:${version}:analysis:${ANALYSIS_VERSION}`]=briefing;
 values.storyBriefings[`latest:news_world:${item.clusterId}:analysis:${ANALYSIS_VERSION}`]=briefing;
 const p=createArticlePresentation({env:{RSS_DATA:db},getLastKnownCachedArticle:async()=>null,generateBriefing:async()=>{throw Error('offline material test')}});
 const request=async token=>{const res=new EventEmitter();res.setHeader=()=>{};res.json=payload=>res.payload=payload;await p.serveSmartData({query:{filterValue:'news_world',smartMode:'top',smartView:token}},res);return res;};
 const first=await request();
 values.smartClusters=[{...original,title:'Hospital now reports 95 suspected cases',content:'Hospital now reports 95 suspected cases.'}];
 first.emit('finish');
 for(let i=0;i<500 && values.topStoriesPublished.articles[0].topStory.material_version===version;i++)await new Promise(r=>setTimeout(r,10));
 assert.ok(values.topStoriesPublished.articles[0].topStory.material_version>version);
 const second=(await request(first.payload.smartViewToken)).payload;
 assert.equal(second.smartViewToken,first.payload.smartViewToken);assert.equal(second.updatesAvailable,true);
 assert.equal(second.articles[0].topStory.rank,first.payload.articles[0].topStory.rank);
 assert.deepEqual(second.articles[0].topStory.cutoff,first.payload.articles[0].topStory.cutoff);
 assert.match(second.articles[0].content,/95/);assert.equal(second.articles[0].briefing.sections.length,0);
});

test('source reconciliation retains the last ranking even before provisional clusters are published',async()=>{
 const f=fixture({smartStatus:{state:'refreshing'}});
 await f.service.revalidate();assert.equal(f.calls,0);assert.equal((await f.service.get()).articles[0].clusterId,'old');
 f.values.smartStatus={state:'ready'};await f.service.revalidate();assert.equal(f.calls,1);
});
test('client boot retains cached Top cards while fetching, then installs the authoritative ordering atomically; Classic keeps its merge behavior',async()=>{
 const vm=await import('node:vm');
 const source=await fs.readFile(new URL('../script.js',import.meta.url),'utf8');
 const method=source.slice(source.indexOf('async fetchData('),source.indexOf('async loadMore()'));
 for(const isTop of [true,false]){
  let release;const gate=new Promise(r=>release=r);
  const latest=[{link:'b',topStory:{rank:1,isTop:true}},{link:'a',topStory:{rank:2,isTop:false}}];
  const {fetchData}=vm.runInNewContext('({'+method+'})',{performance,URLSearchParams,Set,console,window:{},setTimeout:()=>0,setInterval:()=>0,clearInterval:()=>{},requestAnimationFrame:()=>{},fetch:async()=>{await gate;return {ok:true,json:async()=>({articles:latest,smartTabMode:isTop?'top':'classic'})}}});
  const app={usesTopStories:isTop,articleRequestGeneration:0,currentPage:1,isMobile:false,selectedFilterType:'smart',selectedFilterValue:'news_vietnam',smartRegion:'vietnam',hideRead:false,searchQuery:'',smartTabMode:isTop?'top':'classic',articles:[{link:'a'},{link:'b'}],pendingPreferences:{},pendingReadLinks:[],savedStates:[],readStates:new Set(),dedupeStateLinks:a=>a,hideTooltip(){},saveState(){},scheduleBriefingRefresh(){},$nextTick(){}};
  const pending=fetchData.call(app,false,true,true);
  assert.deepEqual(app.articles.map(a=>a.link),['a','b']);
  release();await pending;
  assert.deepEqual(Array.from(app.articles,a=>a.link),isTop?['b','a']:['a','b']);
  if(isTop)assert.deepEqual(app.articles.map(a=>a.topStory.rank),[1,2]);
 }
});
