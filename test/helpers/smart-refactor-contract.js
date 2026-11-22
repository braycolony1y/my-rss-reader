import { createHash } from 'node:crypto';
import {
  applySmartEditorialAssessment,
  prepareSmartEditorialPlan
} from '../../src/ai/smart-editorial.js';

export async function captureSmartContract(smart, fixture) {
  const RealDate = globalThis.Date;
  const now = RealDate.parse(fixture.now);
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  try {
    smart.clearEmbeddingCache();
    smart.updateBatchStopTokens([]);
    const articles = fixture.articles.map(({ vector, ...item }) => ({
      ...smart.normalizeArticle({ ...item, feedUrl: new URL('/rss.xml', item.link).href }),
      _status: 'NEW',
      _vec: Float32Array.from(vector)
    }));
    const identity = articles.map(article => ({
      articleId: smart.getArticleId(article),
      embeddingText: smart.buildEmbeddingText(article),
      embeddingKey: smart.embeddingCacheKey(article),
      verificationKey: smart.verificationCacheKey({ articles: [article] }, []),
      partition: smart.getSmartDestinationPartition(article)
    }));
    const pairDecisions = [];
    for (let i = 0; i < articles.length; i++) for (let j = i + 1; j < articles.length; j++) {
      const similarity = articles[i]._vec.reduce((sum, value, k) => sum + value * articles[j]._vec[k], 0);
      pairDecisions.push({ i, j,
        scope: smart.isPairWithinComparisonScope(articles[i], articles[j], now),
        conflicts: smart.detectEventConflicts(articles[i], articles[j]),
        decision: smart.classifyE5Match(articles[i], articles[j], similarity),
        recovery: smart.isAiRecoveryReviewCandidate(articles[i], articles[j], similarity),
        tokenSimilarity: smart.tokenSimilarity(articles[i].title, articles[j].title),
        tokenOverlap: smart.tokenOverlapCount(articles[i].title, articles[j].title)
      });
    }
    smart.updateBatchStopTokens(articles);
    const deterministic = await smart.deterministicGroups(articles);
    const incremental = await smart.runIncrementalHnswClustering(articles, []);
    const reviewGroups = smart.prepareIncrementalReviewGroups(incremental.ambiguousGroups, incremental.autoMergedClusters);
    const reviewed = reviewGroups.flatMap(group => (group.reviewUniverse || group.articles).map(article => ({
      articles: [article], id: smart.stableId(article.link), reviewRequestId: group.id,
      verification: { method: 'deferred', reason: 'fixture_conservative_partition' }
    })));
    const snapshot = smart.buildPublicationClusterSnapshot({ candidates: articles,
      autoMergedClusters: incremental.autoMergedClusters, reviewedClusters: reviewed, reviewGroups,
      clusterVersionChanged: true, existingClusters: [], isTargeted: false, targetCategory: null,
      storyIdRetentionClusters: [], storyRelationships: [{ type: 'related_development', confidence: 0.97,
        leftArticleIds: [smart.getArticleId(articles[2])], rightArticleIds: [smart.getArticleId(articles[4])] }]
    });
    const dates = fixture.dates.map(pubDate => smart.normalizeArticle({ title: '<b>Thời sự &amp; Markets</b>', content: '<p>Thông tin Việt Nam</p>', pubDate, link: 'https://example.test/date', feedCategory: 'news_vietnam' }));
    const sources = fixture.sources.map(source => ({ identity: smart.sourceFetchPolicyIdentity(source), excluded: smart.isExcludedFromSmart({feedUrl: source.url}) }));
    const values = new Map();
    const db = { get: async key => values.has(key) ? JSON.parse(values.get(key)) : null,
      put: async (key, value) => values.set(key, value) };
    const group = { articles: articles.slice(0, 2) };
    const decision = { clusters: [{ articleIds: group.articles.map(smart.getArticleId) }], uncertain: false, providerId: 'fixture', model: 'fixture' };
    await smart.setCachedVerificationDecision(db, group, [], decision);
    const verification = {
      key: smart.verificationCacheKey(group, []),
      validation: smart.validatePartitionResult(decision, group.articles),
      cached: await smart.getCachedVerificationDecision(db, group, []),
      invalid: smart.validatePartitionResult({clusters:[{articleIds:['unknown']}],uncertain:false}, group.articles)
    };
    const vectorCache = Object.fromEntries(articles.map(article => [smart.embeddingCacheKey(article), Buffer.from(article._vec.buffer).toString('base64')]));
    smart.importEmbeddingCache(vectorCache);
    let embeddingProgress;
    await smart.prepareEmbeddings(articles, progress => { embeddingProgress = progress; });
    const editorialSources = articles.map(article => ({ url: article.feedUrl, category: article.smartCategory,
      region: article.region || (article.language === 'vi' ? 'vietnam' : 'foreign'), enabled: true }));
    const plan = prepareSmartEditorialPlan({ clusters: snapshot.clusters, sources: editorialSources, cache: {}, perDestination: 30 });
    const editorial = plan.selected.map(item => {
      const assessment = { relevance: 0.8, impact: 0.7, novelty: 0.8,
        confidence: 0.9, exclude: false, destination: item.eligibleDestinations[0], reason: 'Fixture assessment' };
      const cluster = { ...item.cluster };
      applySmartEditorialAssessment(cluster, assessment);
      return { cacheKey: item.key, destination: assessment.destination, assessment, cluster };
    });
    smart.updateBatchStopTokens([]);
    return JSON.parse(JSON.stringify({ exports: Object.keys(smart).sort(), articles, identity, pairDecisions, dates,
      sources, deterministic, incremental, reviewGroups, snapshot, verification, embeddingProgress,
      embeddingCacheDigest: createHash('sha256').update(JSON.stringify(smart.exportEmbeddingCache())).digest('hex'), editorial },
      (_key, value) => value instanceof Set ? [...value] : value instanceof Map ? [...value] : ArrayBuffer.isView(value) ? [...value] : value));
  } finally {
    globalThis.Date = RealDate;
    smart.clearEmbeddingCache();
    smart.updateBatchStopTokens([]);
  }
}
