import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getArticleId, embeddingCacheKey, buildEmbeddingText, importEmbeddingCache, prepareEmbeddings,
  prepareIncrementalReviewGroups, integrateIncrementalReviews,
  runIncrementalHnswClustering
} from '../smart-news.js';
import { EMBEDDING_MODEL, EMBEDDING_CACHE_VERSION } from '../src/smart/embeddings/config.js';
import { createHash } from 'node:crypto';
const makeArticle = n => ({ articleKey: `https://fixture${n}.test/story`, link: `https://fixture${n}.test/story`,
  title: 'NASA launches Artemis rocket from Kennedy Space Center', content: 'NASA launched the Artemis rocket from Kennedy Space Center on Monday.',
  pubDate: new Date().toISOString(), language: 'en', smartCategory: 'tech', _status: 'UNCHANGED',
  _vec: Float32Array.from({length:384}, (_, i) => i === 0 ? 1 : 0) });
test('I embedding identity uses normalized input and actual configured model', async () => {
  const article = makeArticle(1);
  assert.equal(embeddingCacheKey(article), embeddingCacheKey({...article, pubDate:'2001-01-01', contentHash:'changed-metadata'}));
  assert.notEqual(embeddingCacheKey(article), embeddingCacheKey({...article, content:'new input'}));
  const old = process.env.SMART_EMBEDDING_MODEL;
  process.env.SMART_EMBEDDING_MODEL = 'fixture/model-B';
  try {
    const otherConfig = await import('../src/smart/embeddings/config.js?model-identity-fixture');
    assert.equal(otherConfig.EMBEDDING_MODEL, 'fixture/model-B');
    const expected = createHash('sha256').update([EMBEDDING_MODEL, EMBEDDING_CACHE_VERSION, buildEmbeddingText(article)].join('\n')).digest('hex');
    assert.equal(embeddingCacheKey(article), expected);
    const changed = createHash('sha256').update([otherConfig.EMBEDDING_MODEL, EMBEDDING_CACHE_VERSION, buildEmbeddingText(article)].join('\n')).digest('hex');
    assert.notEqual(expected, changed);
  }
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
