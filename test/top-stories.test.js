import test from 'node:test';
import assert from 'node:assert/strict';
import { createTopStoriesIndex, allowedDestinations, evidencePaths } from '../src/articles/top-stories.js';
const now=Date.parse('2026-09-13T12:00:00Z');
const article=(id, extra={})=>({link:`https://${id}.com/event`,feedUrl:`https://${id}.com/rss`,feedTitle:id,language:'en',smartCategory:'tech',title:'Critical vulnerability in OpenWrt confirmed',content:'A critical vulnerability allows remote code execution on routers.',pubDate:new Date(now-86400000).toISOString(),sourceWeight:1.4,...extra});
const sourcesFor = clusters => clusters.flatMap(c=>[c,...(c.relatedArticles || [])]).map(a=>({url:a.feedUrl,category:a.smartCategory,region:a.region}));
function harness(config={}) { const store={}; const engine=createTopStoriesIndex({config,db:{get:async k=>store[k],put:async(k,v)=>{store[k]=JSON.parse(v)}}}); return {store,index:{rank:(clusters,sources,now)=>engine.rank(clusters,sources.length?sources:sourcesFor(clusters),now)}}; }
test('source memberships prohibit unauthorized language destinations',()=>{
 const a=article('vn',{language:'en',smartCategory:'news_vietnam'});
 const sources=[{url:a.feedUrl,category:'news_vietnam'}];
 assert.deepEqual(allowedDestinations(a,sources),[]);
 assert.deepEqual(allowedDestinations(a,[]),[]);
 sources.push({url:a.feedUrl,category:'news_world'});
 assert.deepEqual(allowedDestinations(a,sources),['news_world']);
 assert.deepEqual(allowedDestinations({...a,language:'vi'},sources),['news_vietnam']);
 assert.deepEqual(allowedDestinations({...a,feedUrl:'https://unknown.com/rss'},sources),[]);
});
test('wire rewrites and opinion do not become independent confirmations',()=>{
 const original=article('reuters',{wireSource:'reuters'});
 const copies=Array.from({length:20},(_,i)=>article(`copy${i}`,{title:`Different rewrite ${i}`,wireSource:'reuters'}));
 const independent=article('ap',{title:'AP independently confirms router vulnerability',wireSource:'ap'});
 assert.equal(evidencePaths([original,...copies,independent,article('opinion',{opinion:true})]).independentSources,2);
 assert.equal(evidencePaths([article('reuters'), article('copy',{title:'A differently titled report',content:'According to Reuters, a router vulnerability was discovered.'})]).independentSources,1);
});
test('new duplicates retain material time and briefing version across restart',async()=>{
 const {index,store}=harness();
 const one=article('one');
 const first=(await index.rank([one],[],now))[0];
 const copy=article('copy',{pubDate:new Date(now).toISOString()});
 const second=(await index.rank([{...one,relatedArticles:[copy]}],[],now+60000))[0];
 assert.equal(second.topStory.material_version,first.topStory.material_version);
 assert.equal(second.topStory.latest_material_update,first.topStory.latest_material_update);
 assert.notEqual(second.topStory.evidence_version,first.topStory.evidence_version);
 assert.equal(second.topStory.evidence.independentSources,1);
 assert.equal(second.topStory.timeline.length,1);
 const restarted=createTopStoriesIndex({db:{get:async k=>store[k],put:async()=>{}}});
 assert.equal((await restarted.rank([{...one,relatedArticles:[copy]}],sourcesFor([one,copy]),now+120000))[0].clusterId,first.clusterId);
});
test('material correction increments version and retains timeline history',async()=>{
 const {index}=harness();const one=article('one');
 const first=(await index.rank([one],[],now))[0];
 const correction=article('authority',{title:'Correction: only older router versions are affected',content:'Correction: the vulnerability affects only retired firmware.',pubDate:new Date(now).toISOString()});
 const updated=(await index.rank([{...one,relatedArticles:[correction]}],[],now+1000))[0];
 assert.equal(updated.topStory.material_version,first.topStory.material_version+1);
 assert.equal(updated.topStory.timeline.length,2);
 assert.equal(updated.topStory.timeline[1].correction,true);
 assert.equal(updated.title,correction.title);
});
test('all scores precede enrichment; dynamic prefix can exceed ten or be empty',async()=>{
 const {index}=harness();
 const stories=Array.from({length:15},(_,i)=>article(`source${i}`,{title:`Critical vulnerability in product ${i} confirmed`}));
 const ranked=await index.rank(stories,[],now);
 assert.equal(ranked.length,15);
 assert.equal(ranked.filter(a=>a.topStory.isTop).length,15);
 assert.ok(ranked.every(a=>Number.isFinite(a.ranking.score) && a.topStory.rank>0));
 assert.equal((await index.rank([article('minor',{title:'Purple keyboard review',content:'A new keyboard color.'})],[],now)).filter(a=>a.topStory.isTop).length,0);
});
test('same event has one primary feed and conflicting figures remain observable',async()=>{
 const {index}=harness();
 const one=article('one',{title:'Earthquake: 12 killed',content:'Officials report 12 killed.',smartCategory:'news_world'});
 const two=article('two',{title:'Authorities confirm 8 deaths',content:'Authorities confirm 8 deaths.',smartCategory:'news_world'});
 const result=await index.rank([{...one,relatedArticles:[two]},{...one,smartCategory:'finance_global'}],[],now);
 assert.equal(result.length,1);
 assert.ok(result[0].topStory.conflicts.length);
 assert.ok(result[0].ranking.signals.confidence<1);
});

test('Vietnamese US inflation stays out of Vietnam Top and cannot move without membership', async()=>{
 const {index}=harness();
 const a=article('vtv',{language:'vi',title:'Lạm phát Mỹ tăng nhanh trong tháng 8',content:'Lạm phát Mỹ tăng.',smartCategory:'news_vietnam'});
 const ranked=await index.rank([a],[{url:a.feedUrl,category:'news_vietnam'}],now);
 assert.equal(ranked[0].topStory.feed,'news_vietnam');
 assert.equal(ranked[0].topStory.isTop,false);
 assert.equal(ranked[0].ranking.signals.relevance,0);
});
test('domestic finance and domestic news receive relevance only in their subject feed',async()=>{
 const {index}=harness();
 const a=article('sbv',{language:'vi',title:'Ngân hàng Nhà nước Việt Nam điều chỉnh lãi suất',smartCategory:'news_vietnam'});
 const result=await index.rank([a],[{url:a.feedUrl,category:'news_vietnam'},{url:a.feedUrl,category:'finance_vietnam'}],now);
 assert.equal(result[0].topStory.feed,'finance_vietnam');
 assert.equal(result[0].ranking.signals.relevance,1);
});
test('suspected case differences include source dates and survive as conflicts',async()=>{
 const {index}=harness();
 const a=article('hospital',{language:'vi',smartCategory:'news_vietnam',title:'Huế: 133 ca nghi ngộ độc',content:'Ghi nhận 133 ca nghi ngộ độc.'});
 const b=article('ministry',{language:'vi',smartCategory:'news_vietnam',title:'Bộ Y tế điều tra 95 ca nghi ngộ độc tại Huế',content:'Điều tra 95 ca nghi ngộ độc.',pubDate:new Date(now).toISOString()});
 const [result]=await index.rank([{...a,relatedArticles:[b]}],[],now);
 assert.ok(result.topStory.conflicts.some(c=>c.claims?.some(x=>x.value==='133') && c.claims.some(x=>x.value==='95' && x.date===b.pubDate)));
});
