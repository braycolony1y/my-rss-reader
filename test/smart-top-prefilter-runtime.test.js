import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as smart from '../smart-news.js';
import { captureSmartRuntimeContract } from './helpers/smart-runtime-contract.js';
import { withoutVietnamPrefilter } from './helpers/without-vietnam-prefilter.js';
import { getPrefilterStore, evaluateCandidate, terminalExcluded } from '../src/smart/prefilter/state.js';
import { attemptProviderVerification } from '../src/smart/verification/attempt.js';
import { getArticleId } from '../src/smart/articles/identity.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/smart-refactor/input.json',import.meta.url),'utf8'));
const stripFilter = value => JSON.parse(JSON.stringify(value,(key,val)=>key.startsWith('smartTopPrefilter') ? undefined : val));

test('complete refresh: same AI request count and unchanged surviving clusters/ranking data', async () => {
  const before = await withoutVietnamPrefilter(()=>captureSmartRuntimeContract(smart,fixture));
  const after = await captureSmartRuntimeContract(smart,fixture);
  assert.deepEqual(after.workerMessages,before.workerMessages);
  assert.equal(after.requests.length,before.requests.length);
  assert.deepEqual(stripFilter(after.stored.smartClusters),before.stored.smartClusters);
  assert.ok(after.requests.some(request=>JSON.stringify(request).includes('SMART TOP EARLY-EXCLUSION SIDE TASK')));
  assert.equal(after.second.skipped,true);
  assert.equal(after.first.metrics.editorialAssessmentFailures,0);
  console.log('FULL_REFRESH_AI_COUNT',JSON.stringify({before:before.requests.length,after:after.requests.length}));
});

test('complete refresh: obvious exclusion never reaches the worker or AI; raw RSS remains', async () => {
  const lowValue = { ...fixture.articles.find(a=>a.feedCategory==='news_vietnam'), link:'https://vnexpress.net/prefilter-ranking-fixture',title:'Province rises one place in generic ranking',content:'One-place ranking change without a substantive development.' };
  const input = {...fixture,articles:[...fixture.articles,lowValue]};
  const result = await captureSmartRuntimeContract(smart,input);
  assert.ok(!result.workerMessages[0].articleKeys.includes(lowValue.link));
  assert.ok(result.stored.smartRawArticles.some(a=>a.link===lowValue.link));
  assert.ok(!result.stored.smartClusters.some(a=>a.link===lowValue.link));
  assert.ok(result.requests.every(request=>!JSON.stringify(request).includes(lowValue.title)));
  assert.equal(result.first.metrics.prefilterEmbeddingsAvoided,1);
});

test('real verification adapter accepts side exclusion in the same mocked HTTP AI request', async () => {
  const values={}, db={get:async(key,options)=>values[key]==null?null:options?.type==='json'?JSON.parse(values[key]):values[key],put:async(key,value)=>{values[key]=value;}};
  const a={title:'Company announces an internal workflow change',content:'An internal assistant used by one team.',link:'https://fixture.test/ai-side-adapter',feedUrl:'https://fixture.test/rss',smartCategory:'tech',language:'vi',pubDate:new Date().toISOString()};
  const store=await getPrefilterStore(db);evaluateCandidate(store,a,['tech_vietnam']);
  let calls=0;const oldFetch=global.fetch;
  global.fetch=async(url,options)=>{
    if(String(url).endsWith('/api/tags')) return {ok:true,json:async()=>({models:[{name:'qwen2.5:3b'}]})};
    calls++;
    const request=JSON.parse(options.body);
    assert.ok(request.format.properties.smartTopPrefilter);
    assert.match(request.messages[0].content,/SMART TOP EARLY-EXCLUSION SIDE TASK/);
    return {ok:true,json:async()=>({message:{content:JSON.stringify({clusters:[{articleIds:[getArticleId(a)],confidence:1}],uncertain:false,smartTopPrefilter:[{id:a.smartTopPrefilterKey,section:'tech_vietnam',decision:'exclude',confidence:'high',reasonCode:'TECH_VN_CORPORATE_TECH_PR',reason:'Only internal AI assistant publicity.',signals:['internal assistant'],materialitySignals:[]}]})}})};
  };
  try {
    const result=await attemptProviderVerification({id:'prefilter-local-fixture',type:'ollama',model:'qwen2.5:3b',baseUrl:'http://fixture.test',timeoutMs:5000,maxRetries:0},{id:'prefilter-group',articles:[a]},null,db);
    assert.equal(result.valid,true,JSON.stringify(result));
    assert.equal(calls,1);
    assert.equal(terminalExcluded(a,'tech_vietnam'),true);
  } finally {global.fetch=oldFetch;}
});

test('stale published cards, worker raw overlays and briefings obey persisted terminal state', async () => {
  const {filterPublishedSnapshot,prefilterWorkerState,workerPrefilterValues,prepareRankingCandidates}=await import('../src/smart/prefilter/publication.js');
  const {createStoryBriefings}=await import('../src/articles/story-briefing.js');
  const values={}, db={get:async(key,options)=>values[key]==null?null:options?.type==='json'?JSON.parse(values[key]):values[key],put:async(key,value)=>{values[key]=value;}};
  const a={title:'95% doanh nghiệp Việt dùng AI',link:'https://fixture.test/stale-terminal',feedUrl:'https://fixture.test/rss',topStory:{feed:'tech_vietnam'}};
  const stale=structuredClone(a);
  evaluateCandidate(await getPrefilterStore(db),a,['tech_vietnam']);
  const view=await filterPublishedSnapshot(db,{articles:[stale]});
  assert.equal(view.articles.length,0);
  const transport=await prefilterWorkerState(db);
  const workerValues=workerPrefilterValues(transport.state);
  const workerDb={get:async key=>workerValues[key]};
  const remaining=await prepareRankingCandidates(workerDb,[structuredClone(stale)],[{url:a.feedUrl,category:'tech',region:'vietnam'}]);
  assert.equal(remaining.length,0);
  let fetches=0,ai=0;
  const briefings=createStoryBriefings({db,generate:async()=>{ai++;throw Error('must not generate');},loadSource:async()=>{fetches++;throw Error('must not fetch');}});
  assert.equal((await briefings.get(stale,'tech_vietnam')).reason,'terminal_smart_top_exclusion');
  assert.equal(fetches,0);assert.equal(ai,0);
});
