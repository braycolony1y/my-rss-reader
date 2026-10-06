import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { createArticleRequestFlight } from '../src/articles/request-flight.js';
import { beginArticleRequest } from '../src/articles/request-priority.js';
import { createNextArticlesPrefetch } from '../src/feeds/next-articles-prefetch.js';
import { withArticleFetchLane } from '../src/articles/fetch-lanes.js';
import { createMembershipReconciler } from '../src/board/membership.js';
import { listJsonCompression } from '../src/middleware/json-compression.js';
const response = () => ({ statusCode:200, status(code){this.statusCode=code;return this;},json(payload){this.payload=payload;return this;} });
test('equivalent article requests share extraction; errors release flights; page and refresh requests remain distinct', async () => {
 let calls=0,release;const gate=new Promise(r=>release=r);
 const wrap=createArticleRequestFlight();
 const handler=wrap(async(req,res)=>{calls++;await gate;res.json({content:'readable',page:req.query.resumePage});});
 const responses=Array.from({length:8},response);
 const requests=responses.map((res,i)=>handler({query:{url:'https://example.test/a',requestId:String(i)}},res));
 assert.equal(calls,1);release();await Promise.all(requests);
 assert.ok(responses.every(res=>res.payload.content==='readable'));
 await handler({query:{url:'https://example.test/a'}},response());assert.equal(calls,2);
 await Promise.all(['2','3'].map(resumePage=>handler({query:{url:'https://example.test/a',resumePage}},response())));assert.equal(calls,4);
 await Promise.all([1,2].map(()=>handler({query:{url:'https://example.test/a',bypassCache:'1'}},response())));assert.equal(calls,6);
 let fail=true;const failing=wrap(async(req,res)=>{if(fail)throw Error('extract failed');res.json({ok:true});});
 await assert.rejects(failing({query:{url:'b'}},response()),/extract failed/);fail=false;
 const retried=response();await failing({query:{url:'b'}},retried);assert.equal(retried.payload.ok,true);
});
test('speculation neither claims foreground priority nor expands prefetch recursively',async()=>{
 const progress={activeForegroundRequests:0};
 const background=beginArticleRequest({query:{prefetch:'1'}},progress);assert.equal(progress.activeForegroundRequests,0);
 const foreground=beginArticleRequest({query:{}},progress);assert.equal(progress.activeForegroundRequests,1);background();foreground();foreground();assert.equal(progress.activeForegroundRequests,0);
 const trigger=createNextArticlesPrefetch({env:{RSS_DATA:{get(){throw Error('speculation must not scan corpus');}}}});
 for(const lane of ['p1','p2','p3','p4'])assert.deepEqual(await withArticleFetchLane(lane,()=>trigger('https://example.test/a')),[]);
});
test('unchanged board membership never clones article corpora; new members own isolated metadata',async()=>{
 const state={userPreferences:{boardFolderMappings:{a:'cache'}},boardStates:['a'],cacheMembers:{a:{in_cache:true,url:'a'}},cacheIdentityLedger:{articles:{},dismissals:{}}};
 let corpusReads=0;const original={link:'b',title:'B',nested:{value:1}};
 const db={get:async(key,opts)=>{if(['articles','smartRawArticles'].includes(key)){corpusReads++;assert.equal(opts.shared,true);return [original];}return state[key];},putMany:async()=>{}};
 const reconcile=createMembershipReconciler({locked:fn=>fn(),get:async(key,fallback)=>structuredClone(state[key]??fallback),db,now:()=>1,identity:v=>typeof v==='string'?v:v.link,isCache:v=>v==='cache',canonicalUrl:v=>v,retentionMs:100,protectedIds:async()=>new Set(),updateRetention:()=>{}});
 await reconcile();assert.equal(corpusReads,0);
 state.boardStates.push('b');state.userPreferences.boardFolderMappings.b='cache';const members=await reconcile();assert.equal(corpusReads,2);members.b.article.nested.value=2;assert.equal(original.nested.value,1);
});
test('list compression negotiates gzip and preserves both normal and pre-serialized Smart responses',async()=>{
 const app=express(),payload={articles:[{content:'News '.repeat(10000)}]};app.use(listJsonCompression);app.get('/json',(req,res)=>res.json(payload));app.get('/smart',(req,res)=>res.type('json').send(JSON.stringify(payload)));
 const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 try {
  for(const route of ['/json','/smart'])for(const encoding of ['gzip','identity','gzip;q=0, identity']) {
   const result=await new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port:server.address().port,path:route,headers:{'Accept-Encoding':encoding}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({headers:res.headers,body:Buffer.concat(chunks)}));}).on('error',reject));
   const compressed=result.headers['content-encoding']==='gzip';assert.equal(compressed,encoding==='gzip');assert.match(result.headers.vary,/Accept-Encoding/);
   assert.deepEqual(JSON.parse((compressed?gunzipSync(result.body):result.body).toString()),payload);
  }
 } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('clustering worker exits and postMessage failures settle and release all listeners',async()=>{
 const {EventEmitter}=await import('node:events');
 const {requestClusterWorker}=await import('../src/smart/clustering/worker-request.js');
 for(const terminal of ['exit','error','result','throw']) {
  const worker=new EventEmitter();worker.postMessage=()=>{if(terminal==='throw')throw Error('post failed');};
  const pending=requestClusterWorker(worker,{},()=>{});
  if(terminal==='exit')worker.emit('exit',0);
  if(terminal==='error')worker.emit('error',Error('worker died'));
  if(terminal==='result')worker.emit('message',{type:'result',result:{clusters:[]}});
  if(terminal==='result')assert.deepEqual(await pending,{clusters:[]});else await assert.rejects(pending);
  for(const event of ['message','error','exit'])assert.equal(worker.listenerCount(event),0);
 }
});

test('OpenCLI ingestion actually invokes the configured extractor in background lane',async()=>{
 const {createArticlePrefetch}=await import('../src/feeds/prefetch.js');
 const {getCurrentArticleFetchLaneContext}=await import('../src/articles/fetch-lanes.js');
 let calls=0;
 const prefetch=createArticlePrefetch({getCachedArticle:async()=>null,getArticleFetchPolicy:async()=>({hasStrictConfiguredMethods:true,strategyOrder:['opencli-fetch']}),hasOnlyOpenCliFetchMethod:()=>true,fetchParsedArticleByStrategy:async()=>{calls++;assert.equal(getCurrentArticleFetchLaneContext().lane,'p3');return {content:'A readable story',image:'https://example.test/photo.jpg'};},cacheArticleResult:async()=>true,getBestImage:async()=>null});
 assert.deepEqual(await prefetch.prefetchOpenCliOnlyArticles([{link:'https://example.test/a',image:'https://example.test/photo.jpg'}]),[true]);assert.equal(calls,1);
});
