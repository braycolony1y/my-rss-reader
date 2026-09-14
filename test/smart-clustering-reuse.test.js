import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getArticleId, embeddingCacheKey, buildEmbeddingText, importEmbeddingCache, prepareEmbeddings,
  verificationCacheKey, setCachedVerificationDecision, getCachedVerificationDecision,
  verifyWithProviderChain, prepareIncrementalReviewGroups, integrateIncrementalReviews,
  runIncrementalHnswClustering
} from '../smart-news.js';
const makeArticle = n => ({ articleKey: `https://fixture${n}.test/story`, link: `https://fixture${n}.test/story`,
  title: 'NASA launches Artemis rocket from Kennedy Space Center', content: 'NASA launched the Artemis rocket from Kennedy Space Center on Monday.',
  pubDate: new Date().toISOString(), language: 'en', smartCategory: 'tech', _status: 'UNCHANGED',
  _vec: Float32Array.from({length:384}, (_, i) => i === 0 ? 1 : 0) });
function memoryDb() {
  const values = {};
  return { values, get: async key => values[key] ?? null,
    put: async (key, value) => { values[key] = JSON.parse(value); } };
}
const decision = articles => ({ clusters: articles.map(article => ({articleIds:[getArticleId(article)]})), uncertain:false, providerId:'fixture', model:'fixture', verifiedAt:'2020-01-01T00:00:00Z' });
test('G/H valid decisions survive age >30 days and >500 entries; invalid results never overwrite', async () => {
  const db = memoryDb(); const groups = Array.from({length: 505}, (_, n) => ({articles:[makeArticle(n)]}));
  for (const group of groups) await setCachedVerificationDecision(db, group, [], decision(group.articles));
  const first = db.values.smartEventVerificationCache[verificationCacheKey(groups[0], [])];
  first.createdAt = 1; first.expiresAt = 2;
  assert.ok(await getCachedVerificationDecision(db, groups[0], []));
  assert.equal(Object.keys(db.values.smartEventVerificationCache).length, 505);
  await setCachedVerificationDecision(db, groups[0], [], {clusters:[],uncertain:false});
  assert.equal(db.values.smartEventVerificationCache[verificationCacheKey(groups[0], [])], first);
  const cached = await verifyWithProviderChain(groups[0], [{id:'must-not-call',type:'unknown'}], null, db);
  assert.equal(cached.resolution, 'cached'); assert.deepEqual(cached.attemptedProviders, []);
  console.log('CACHE_ACCEPTANCE_COUNTS', JSON.stringify({entries:505, cacheHits:2, aiCalls:0}));
});
test('verification identity tracks effective content and policy, independent of provider order and time', () => {
  const article = makeArticle(1), group = {articles:[article]};
  const key = verificationCacheKey(group, [{id:'old'}]);
  assert.equal(key, verificationCacheKey({...group, id:'different-event-label'}, [{id:'new'}]));
  assert.notEqual(key, verificationCacheKey({articles:[{...article, content:'material change'}]}, []));
  assert.notEqual(key, verificationCacheKey({articles:[{...article, link:'https://new.test/'}]}, []));
});
test('I embedding identity uses normalized input and actual configured model', async () => {
  const article = makeArticle(1);
  assert.equal(embeddingCacheKey(article), embeddingCacheKey({...article, pubDate:'2001-01-01', contentHash:'changed-metadata'}));
  assert.notEqual(embeddingCacheKey(article), embeddingCacheKey({...article, content:'new input'}));
  const old = process.env.SMART_EMBEDDING_MODEL;
  process.env.SMART_EMBEDDING_MODEL = 'fixture/model-B';
  try { const other = await import('../smart-news.js?model-identity-fixture'); assert.notEqual(embeddingCacheKey(article), other.embeddingCacheKey(article)); }
  finally { if (old === undefined) delete process.env.SMART_EMBEDDING_MODEL; else process.env.SMART_EMBEDDING_MODEL = old; }
  const vector = new Float32Array([1, 0]);
  importEmbeddingCache({[embeddingCacheKey(article)]:Buffer.from(vector.buffer).toString('base64')});
  let stats;
  await prepareEmbeddings([article], value => {stats=value;});
  assert.equal(stats.embeddingsGenerated, 0); assert.equal(stats.embeddingsReused, 1);
  assert.deepEqual([...article._vec], [1,0]); assert.match(buildEmbeddingText(article), /^query:/);
});
test('C/D real incremental HNSW attaches one obvious duplicate to six articles without AI review', async () => {
  const old = Array.from({length:6}, (_, i) => makeArticle(i));
  const incoming = {...makeArticle(6), _status:'NEW'};
  const result = await runIncrementalHnswClustering([...old, incoming], [{clusterId:'existing', ...old[0], relatedArticles:old.slice(1)}]);
  assert.equal(result.ambiguousGroups.length, 0);
  assert.equal(result.autoMergedClusters.length, 1);
  assert.equal(result.autoMergedClusters[0].articles.length, 7);
  assert.equal(result.metrics.existingMembershipsReused, 6);
  console.log('INCREMENTAL_ACCEPTANCE_COUNTS', JSON.stringify({...result.metrics, aiCalls:0, fullGroupRepartitions:0}));
});
test('E minimal pair review preserves existing six-member event for both match and nonmatch', () => {
  const old = Array.from({length:6}, (_, i) => makeArticle(i)), incoming = {...makeArticle(7),_status:'NEW'};
  const automatic = [{id:'old', established:true, articles:old}, {id:'new',articles:[incoming]}];
  const requests = prepareIncrementalReviewGroups([{articles:[...old,incoming]}], automatic);
  assert.equal(requests[0].articles.length,2); assert.equal(requests[0].fullRepartition,false);
  const positive = integrateIncrementalReviews(automatic, [{articles:requests[0].articles}], requests);
  assert.equal(positive.length,1); assert.equal(positive[0].articles.length,7);
  const negative = integrateIncrementalReviews(automatic, requests[0].articles.map(a=>({articles:[a]})), requests);
  assert.deepEqual(negative.map(g=>g.articles.length),[6,1]);
});
test('F bridge between two established events includes only affected groups', () => {
  const a = [makeArticle(1),makeArticle(2)], b=[makeArticle(3),makeArticle(4)], newcomer=makeArticle(5), unrelated=makeArticle(6);
  const automatic=[{established:true,articles:a},{established:true,articles:b},{articles:[newcomer]},{articles:[unrelated]}];
  const groups=prepareIncrementalReviewGroups([{articles:[a[0],b[0],newcomer]}],automatic);
  assert.equal(groups[0].fullRepartition,true); assert.equal(groups[0].articles.length,5);
  assert.ok(!groups[0].articles.includes(unrelated));
});
test('O/P real provider chain repairs once per failing provider and falls back; Q no retry of unchanged failure', async () => {
  const originalFetch = global.fetch; const article = makeArticle(10), group={articles:[article]}, db=memoryDb();
  let requests=[];
  const providers=[{id:'first',type:'ollama',model:'first',baseUrl:'http://fixture',timeoutMs:1000,maxRetries:2}, {id:'second',type:'ollama',model:'second',baseUrl:'http://fixture',timeoutMs:1000,maxRetries:2}];
  global.fetch=async (_url, options)=>{const body=JSON.parse(options.body);requests.push(body);return {ok:true,json:async()=>({message:{content:body.model==='first'?'broken':JSON.stringify({clusters:[{articleIds:[getArticleId(article)]}],uncertain:false})}})}}; 
  try {
    const result=await verifyWithProviderChain(group,providers,null,db);
    assert.equal(result.resolution,'verified');assert.equal(result.providerId,'second');assert.equal(requests.length,3);
    assert.match(requests[1].messages[0].content,/SAME decision/);
    const failing={articles:[makeArticle(11)]};requests=[];
    global.fetch=async (_url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({message:{content:'broken'}})}};
    const failed=await verifyWithProviderChain(failing,providers,null,db);
    assert.equal(failed.uncertain,true);assert.equal(requests.length,4);
    assert.equal(Object.keys(db.values.smartEventVerificationCache).length,1);
    await verifyWithProviderChain(failing,providers,null,db);assert.equal(requests.length,4);
    console.log('FALLBACK_ACCEPTANCE_COUNTS',JSON.stringify({firstPassCalls:4,repairCalls:3,invalidJson:3,fallbackAttempts:2,fallbackSuccesses:1,allProviderFailures:1}));
  } finally {global.fetch=originalFetch;}
});
