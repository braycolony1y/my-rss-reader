import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSmartNewsEngine } from '../smart-news.js';

test('A/B/P/Q/R/S refresh, deterministic resolution, failure retention and explicit rebuild', async () => {
  const oldWebEnabled = process.env.GEMINI_WEB_ENABLED;
  process.env.GEMINI_WEB_ENABLED = 'false';
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

    assert.equal(aiCalls,0,'no model is ever called');

    const initialAiCalls=aiCalls;
    const firstSnapshot=values.smartClusters, firstVersion=values.smartClusterVersion;

    stages.length=0;
    result=await engine.sync(progress,category);

    assert.equal(result.skipped,true,JSON.stringify(result));
    assert.equal(workerCalls,1);
    assert.equal(aiCalls,initialAiCalls);

    assert.equal(result.metrics.embeddingsGenerated,0);
    assert.equal(values.smartClusters,firstSnapshot);
    assert.ok(!stages.includes('smart-resolve'));
    assert.ok(!stages.includes('smart-embeddings'));

    await engine.getStatus();
    assert.equal(workerCalls,1);
    assert.equal(aiCalls,initialAiCalls);

    result=await engine.sync(progress,category,{forceRebuild:true});
    assert.equal(result.ok,true,result.error);assert.equal(result.metrics.rebuildReason,'explicit_force_rebuild');assert.equal(workerCalls,2);
    values.smartClusteringAlgorithmVersion='incompatible-old-policy';
    result=await engine.sync(progress,category);
    assert.equal(result.ok,true,result.error);assert.equal(result.metrics.rebuildReason,'clustering_policy_version_changed');assert.equal(workerCalls,3);
    const validSnapshot=values.smartClusters, validVersion=values.smartClusterVersion, validCommits=commits.length;
    articles.push({...articles[0],link:'https://fixture.test/two',title:'NASA plans next Artemis rocket launch'});ambiguity=true;
    result=await engine.sync(progress,category);

    assert.equal(result.ok,true,result.error);
    // The ambiguous group is resolved deterministically: without strong shared evidence the articles stay separate.
    assert.equal(aiCalls,0);
    assert.ok(stages.includes('smart-resolve'));
    assert.equal(commits.length,validCommits+1);
    assert.notEqual(values.smartClusters,validSnapshot);assert.notEqual(values.smartClusterVersion,validVersion);
    assert.equal(result.metrics.ambiguousGroups,1);assert.equal(result.metrics.ambiguousGroupsResolved,0);
    assert.equal(result.metrics.mergedComponentPairs,0);assert.equal(result.metrics.unresolvedAmbiguousGroups,1);
    assert.equal(JSON.parse(values.smartClusters).length,2,'both articles are published, each exactly once');
    assert.equal(JSON.parse(values.smartDeferredReviewGroups).groups.length,0);
    const deferredSnapshot=values.smartClusters, deferredVersion=values.smartClusterVersion, deferredWorkerCalls=workerCalls;
    result=await engine.sync(progress,category);
    assert.equal(result.ok,true,result.error);assert.equal(result.skipped,true,JSON.stringify(result));
    assert.equal(workerCalls,deferredWorkerCalls);

    // An unchanged refresh performs no additional work.
    assert.equal(aiCalls,0);

    assert.equal(values.smartClusters,deferredSnapshot);
    assert.equal(values.smartClusterVersion,deferredVersion);
    ambiguity=false;failPersistence=true;
    result=await engine.sync(progress,category,{forceRebuild:true});
    assert.equal(result.ok,false);assert.equal(values.smartClusters,deferredSnapshot);assert.equal(values.smartClusterVersion,deferredVersion);
    assert.notEqual(firstVersion,undefined);
    
  } finally {
    global.fetch=oldFetch;
    if(oldWebEnabled===undefined)delete process.env.GEMINI_WEB_ENABLED;else process.env.GEMINI_WEB_ENABLED=oldWebEnabled;
    if(oldEnabled===undefined)delete process.env.ANTIGRAVITY_ENABLED;else process.env.ANTIGRAVITY_ENABLED=oldEnabled;
    if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey;
  }
});
