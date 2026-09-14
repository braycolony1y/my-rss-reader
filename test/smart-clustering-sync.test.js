import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSmartNewsEngine } from '../smart-news.js';

test('A/B/P/Q/R/S refresh, failure retention, browser read and explicit rebuild', async () => {
  const oldFetch = global.fetch, oldEnabled = process.env.ANTIGRAVITY_ENABLED, oldKey = process.env.GEMINI_API_KEY;
  process.env.ANTIGRAVITY_ENABLED = 'false'; delete process.env.GEMINI_API_KEY;
  const values = {}; let failPersistence = false, workerCalls = 0, aiCalls = 0, ambiguity = false;
  let articles = [{link:'https://fixture.test/one', title:'NASA launches Artemis rocket from Kennedy Space Center', content:'NASA launched Artemis from Kennedy Space Center.',pubDate:new Date().toISOString()}];
  const commits = [], stages = [];
  const db = {
    get: async (key, options) => values[key] === undefined ? null : options?.type === 'json' ? JSON.parse(values[key]) : values[key],
    put: async (key, value) => {values[key]=value;},
    putMany: async changes => { if (failPersistence && changes.smartClusters) throw new Error('fixture persistence failure'); commits.push(changes); Object.assign(values,changes); }
  };
  const worker = new EventEmitter();
  worker.postMessage = message => {
    workerCalls++;
    queueMicrotask(()=>worker.emit('message',{type:'result',result:{
      autoMergedClusters:message.articles.map((article,index)=>({id:String(index),articles:[article],established:article._status==='UNCHANGED'})),
      ambiguousGroups:ambiguity ? [{articles:message.articles}] : [],
      metrics:{embeddingsGenerated:message.articles.filter(a=>a._status!=='UNCHANGED').length}
    }}));
  };
  global.fetch = async (url, options) => {
    if (String(url).endsWith('/api/chat')) {aiCalls++; return {ok:true,json:async()=>({message:{content:'broken'}})};}
    return {ok:true,text:async()=>'<rss><item /></rss>'};
  };
  const engine=createSmartNewsEngine({db,helpers:{fastParseRSS:()=>({items:articles})},clusterWorkerFactory:()=>worker});
  try {
    const sources=await engine.getSourceSettings();
    values.smartSources=JSON.stringify(sources.map((source,index)=>({...source,enabled:index===0})));
    const category=sources[0].category;
    const progress=p=>stages.push(p.stage);
    let result=await engine.sync(progress,category);
    assert.equal(result.ok,true,result.error); assert.equal(commits.length,1);
    const firstSnapshot=values.smartClusters, firstVersion=values.smartClusterVersion;
    stages.length=0;
    result=await engine.sync(progress,category);
    assert.equal(result.skipped,true,JSON.stringify(result)); assert.equal(workerCalls,1);assert.equal(aiCalls,0);
    assert.equal(result.metrics.embeddingsGenerated,0);assert.equal(values.smartClusters,firstSnapshot);
    assert.ok(!stages.includes('smart-ai'));assert.ok(!stages.includes('smart-embeddings'));
    await engine.getStatus(); assert.equal(workerCalls,1);assert.equal(aiCalls,0);
    console.log('UNCHANGED_REFRESH_COUNTS',JSON.stringify({aiCalls,embeddingsGenerated:result.metrics.embeddingsGenerated,workerCallsDuringRefresh:0}));
    result=await engine.sync(progress,category,{forceRebuild:true});
    assert.equal(result.ok,true,result.error);assert.equal(result.metrics.rebuildReason,'explicit_force_rebuild');assert.equal(workerCalls,2);
    values.smartClusteringAlgorithmVersion='incompatible-old-policy';
    result=await engine.sync(progress,category);
    assert.equal(result.ok,true,result.error);assert.equal(result.metrics.rebuildReason,'clustering_policy_version_changed');assert.equal(workerCalls,3);
    const validSnapshot=values.smartClusters, validVersion=values.smartClusterVersion, validCommits=commits.length;
    articles.push({...articles[0],link:'https://fixture.test/two',title:'NASA plans next Artemis rocket launch'});ambiguity=true;
    result=await engine.sync(progress,category);
    assert.equal(result.ok,true,result.error);assert.equal(aiCalls,2);assert.equal(commits.length,validCommits+1);
    assert.notEqual(values.smartClusters,validSnapshot);assert.notEqual(values.smartClusterVersion,validVersion);
    assert.ok(stages.includes('smart-ai-repair'));assert.equal(result.metrics.repairAttempts,1);assert.equal(result.metrics.repairFailures,1);
    assert.equal(result.metrics.deferredAmbiguousGroups,1);assert.equal(result.metrics.unresolvedAmbiguousGroups,0);
    const deferredState=JSON.parse(values.smartDeferredReviewGroups);
    assert.equal(deferredState.groups.length,1);assert.equal(deferredState.groups[0].components.length,2);
    const deferredSnapshot=values.smartClusters, deferredVersion=values.smartClusterVersion, deferredWorkerCalls=workerCalls;
    result=await engine.sync(progress,category);
    assert.equal(result.ok,true,result.error);assert.equal(result.skipped,true,JSON.stringify(result));
    assert.equal(workerCalls,deferredWorkerCalls);assert.equal(aiCalls,2);assert.equal(values.smartClusters,deferredSnapshot);assert.equal(values.smartClusterVersion,deferredVersion);
    ambiguity=false;failPersistence=true;
    result=await engine.sync(progress,category,{forceRebuild:true});
    assert.equal(result.ok,false);assert.equal(values.smartClusters,deferredSnapshot);assert.equal(values.smartClusterVersion,deferredVersion);
    assert.notEqual(firstVersion,undefined);
    console.log('SNAPSHOT_FAILURE_COUNTS',JSON.stringify({firstPassAiCalls:1,repairCalls:1,invalidJson:1,repeatedRefreshAiCalls:0,invalidPublications:0}));
  } finally {
    global.fetch=oldFetch;
    if(oldEnabled===undefined)delete process.env.ANTIGRAVITY_ENABLED;else process.env.ANTIGRAVITY_ENABLED=oldEnabled;
    if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey;
  }
});
