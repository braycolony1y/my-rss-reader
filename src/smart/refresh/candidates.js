import { normalizeBlockedKeywordEntries, articleContentFilterMatches } from '../../filters/content-filter.js';
import { isInvestingComSource } from '../articles/categories.js';
import { stableId } from '../articles/identity.js';
import { normalizeArticle } from '../articles/normalize.js';
import { isActiveCluster, extractActiveClusterArticles } from '../clustering/publication-snapshot.js';
import { SMART_CLUSTER_VERSION, SMART_NEWS_CLUSTER_CONFIG, HOUR_MS, SMART_NEWS_AI_CONFIG } from '../config.js';
import { parsePublishedTimestamp, toVietnamIso } from '../dates/publication-time.js';
import { EMBEDDING_MODEL, EMBEDDING_CACHE_VERSION } from '../embeddings/config.js';
import { buildEmbeddingText } from '../embeddings/index.js';
import { fetchInBatches, fetchSmartSource } from '../sources/fetch.js';
import { canonicalSourceUrl, isExcludedFromSmart } from '../sources/identity.js';
import { countSmartSources } from '../sources/normalize.js';
import { dedupeGoogleNewsWrappers } from '../sources/wrappers.js';
import { normalizedVerificationArticles } from '../verification/cache.js';
import { getEnabledVerificationProviders } from '../verification/provider-config.js';
import { createHash } from 'node:crypto';

export async function prepareSmartCandidates({ db, smartSources, getSettings, hasGeminiKey, localModel, setStatus, getProgress, notify, metrics, options, isTargeted, targetCategory, startedAt, helpers, headers, setAttemptedState }) {
  const sourceCounts =
    countSmartSources(
      smartSources
    );

  notify(
    'smart-starting',
    isTargeted
      ? `Loading Smart sources for ${targetCategory}…`
      : 'Loading Smart source configuration…'
  );

  const previousStatus =
    (
      await db.get(
        'smartStatus',
        {
          type: 'json'
        }
      )
    ) || {};

  const providers =
    getEnabledVerificationProviders(
      hasGeminiKey()
    );

  const providerOrder =
    providers.map(
      provider =>
        provider.id
    );

  await setStatus({
    ...previousStatus,
    state: 'refreshing',
    startedAt,
    providerOrder,
    localModel,
    progress:
      getProgress()
  });

  let sourcesToFetch =
    isTargeted
      ? smartSources.filter(
        source =>
          source.category ===
          targetCategory
      )
      : smartSources;

  if (
    isTargeted &&
    targetCategory === 'tech'
  ) {
    sourcesToFetch =
      sourcesToFetch.filter(
        source =>
          !isInvestingComSource(
            source
          )
    );
  }

  let previousSmartArticlesForPrefetch =
    (
      await db.get(
        'smartRawArticles',
        { type: 'json', shared: true }
      )
    ) || [];

  let sourceResults =
    await fetchInBatches(
      sourcesToFetch,
      16,
      source =>
        fetchSmartSource(
          source,
          helpers.fastParseRSS,
          headers
        ),
      progress =>
        notify(
          progress.stage,
          progress.message,
          {
            ...progress,
            percent:
              progress.total
                ? Math.round(
                  progress.current /
                  progress.total *
                  100
                )
                : 0
          }
        )
    );

  if (
    typeof helpers
      .resolveSmartArticleDestinations ===
    'function'
  ) {
    notify(
      'smart-resolving',
      'Resolving publisher links and thumbnails…'
    );
    await helpers
      .resolveSmartArticleDestinations(
        sourceResults
      );
  }

  let fetchedArticles =
    sourceResults.flatMap(
      result =>
        result.articles ||
        []
    );

  await helpers.observeCacheArticles?.(fetchedArticles);
  // Do not start a second asynchronous OpenCLI article prefetch from the
  // clustering refresh. The dedicated background source loop performs that
  // work when no Smart refresh is active, so these source arrays can be
  // released before HNSW/AI review.

  const sourceErrors =
    sourceResults
      .filter(
        result =>
          !result.ok
      )
      .map(result => ({
        title:
          result.source
            .title,
        url:
          result.source
            .url,
        error:
          result.error
      }));

  const successfulSourceCount = sourceResults.length - sourceErrors.length;

  let previousHidden =
    isTargeted
      ? previousSmartArticlesForPrefetch
      : [];

  let preservedHidden =
    isTargeted
      ? previousHidden.filter(
        article =>
          article.smartCategory !==
          targetCategory
      )
      : [];

  let hiddenArticles =
    isTargeted
      ? [
        ...preservedHidden,
        ...fetchedArticles
      ]
      : fetchedArticles;

  const hiddenArticleCount = hiddenArticles.length;
  let smartRawArticlesJson = hiddenArticleCount
    ? JSON.stringify(hiddenArticles)
    : '[]';
  if (hiddenArticleCount) {
    await db.put('smartRawArticles', smartRawArticlesJson);
  }
  // The raw snapshot is already durable before clustering starts. Holding
  // this second large JSON string through HNSW + sequential AI review
  // needlessly raises the old-space floor.
  smartRawArticlesJson = null;

  let existingArticles =
    (
      await db.get(
        'articles',
        {
          // Read-only in this path. Cloning the full article database
          // blocks HTTP requests while Smart News starts in background.
          type: 'json',
          shared: true
        }
      )
    ) || [];

  let existingClusters =
    (
      await db.get(
        'smartClusters',
        {
          // Filtering below creates new arrays and normalized objects.
          type: 'json',
          shared: true
        }
      )
    ) || [];

  const previousReviewState =
    (
      await db.get(
        'smartDeferredReviewGroups',
        { type: 'json' }
      )
    ) || {};
  const storedStoryRelationships =
    previousReviewState.algorithmVersion === SMART_CLUSTER_VERSION &&
    Array.isArray(previousReviewState.relationships)
      ? previousReviewState.relationships
      : [];

  let feeds =
    (
      await db.get(
        'feeds',
        {
          type: 'json',
          shared: true
        }
      )
    ) || [];

  const settings =
    await getSettings();

  const excludedFeedCategories =
    Array.isArray(
      settings
        .excludedFeedCategories
    )
      ? settings
        .excludedFeedCategories
      : [];

  const dynamicExcludedUrls =
    new Set(
      feeds
        .filter(
          feed =>
            feed.excludeFromSmart ||
            excludedFeedCategories
              .includes(
                feed.category
              )
        )
        .map(feed =>
          canonicalSourceUrl(
            feed.url,
            true
          )
        )
    );

  const comparisonCutoff =
    Date.now() -
    SMART_NEWS_CLUSTER_CONFIG
      .comparisonWindowHours *
    HOUR_MS;

  // These collections are large enough to freeze Express if processed in
  // one uninterrupted array chain. Yield every small batch so cached page
  // and API requests remain responsive while Smart clustering prepares.
  let activeStoredArticles = [];
  for (let index = 0; index < existingClusters.length; index++) {
    const cluster = existingClusters[index];
    if (isActiveCluster(cluster)) {
      activeStoredArticles.push(...extractActiveClusterArticles(cluster).filter(article =>
        !isExcludedFromSmart(article, dynamicExcludedUrls) &&
        (!article.hiddenSmartSource || smartSources.some(source => source.url === article.feedUrl))));
    }
    if (index > 0 && index % 150 === 0) await new Promise(resolve => setImmediate(resolve));
  }

  let normalArticles = [];
  for (let index = 0; index < existingArticles.length; index++) {
    const article = existingArticles[index];
    if (
      article.link &&
      parsePublishedTimestamp(article.pubDate) >= comparisonCutoff &&
      !isExcludedFromSmart(article, dynamicExcludedUrls)
    ) {
      normalArticles.push(normalizeArticle(article));
    }
    if (index > 0 && index % 150 === 0) await new Promise(resolve => setImmediate(resolve));
  }

  let normalizedHidden = [];
  for (let index = 0; index < hiddenArticles.length; index++) {
    const article = normalizeArticle(hiddenArticles[index]);
    if (
      article.link &&
      parsePublishedTimestamp(article.pubDate) >= comparisonCutoff &&
      !isExcludedFromSmart(article, dynamicExcludedUrls)
    ) {
      normalizedHidden.push(article);
    }
    if (index > 0 && index % 150 === 0) await new Promise(resolve => setImmediate(resolve));
  }

  let articleMap =
    new Map();

  let processedArticleCount = 0;
  for (
    const article
    of activeStoredArticles
  ) {
    if (article.link) {
      articleMap.set(
        article.link,
        article
      );
    }
    processedArticleCount++;
    if (processedArticleCount % 150 === 0) await new Promise(resolve => setImmediate(resolve));
  }

  processedArticleCount = 0;
  for (
    const article
    of [
      ...normalArticles,
      ...normalizedHidden
    ]
  ) {
    if (article.link) {
      articleMap.set(
        article.link,
        article
      );
    }
    processedArticleCount++;
    if (processedArticleCount % 150 === 0) await new Promise(resolve => setImmediate(resolve));
  }

  let rawCandidates =
    dedupeGoogleNewsWrappers(
      [...articleMap.values()]
    );

  // CONTENT_FILTER_HEAVY_GATE_V2
  //
  // Content Filter matches remain in the raw article stores so the user
  // can inspect them from Content Filters. They must not enter the costly
  // Smart pipeline: content hashing, embeddings, clustering, verification,
  // editorial AI, ranking and later Smart enrichment.
  //
  // Use the exact same canonical matcher as the normal Feed/UI filters.

  const blockedArticleKeywordsForSmart =
    (
      await db.get(
        'blockedArticleKeywords',
        { type: 'json', shared: true }
      )
    ) || [];

  const blockedKeywordEntriesForSmart =
    normalizeBlockedKeywordEntries(
      blockedArticleKeywordsForSmart
    );

  const articleIsContentFilteredForSmart =
    article =>
      articleContentFilterMatches(
        article,
        blockedKeywordEntriesForSmart
      );

  const rawCandidateCountBeforeContentFilter =
    rawCandidates.length;

  if (blockedKeywordEntriesForSmart.length) {
    rawCandidates =
      rawCandidates.filter(
        article =>
          !articleIsContentFilteredForSmart(
            article
          )
      );
  }

  const contentFilteredSmartCandidateCount =
    rawCandidateCountBeforeContentFilter -
    rawCandidates.length;

  let previousRawArticles = (await db.get('smartClusteringInputs', { type: 'json', shared: true })) || (await db.get('smartRawArticles', { type: 'json', shared: true })) || [];

  const previousRawArticleCountBeforeContentFilter =
    previousRawArticles.length;

  if (blockedKeywordEntriesForSmart.length) {
    previousRawArticles =
      previousRawArticles.filter(
        article =>
          !articleIsContentFilteredForSmart(
            article
          )
      );
  }

  const contentFilteredPreviousSmartCount =
    previousRawArticleCountBeforeContentFilter -
    previousRawArticles.length;

  if (
    contentFilteredSmartCandidateCount > 0 ||
    contentFilteredPreviousSmartCount > 0
  ) {
    console.log(
      '[CONTENT FILTER] Smart heavy-work gate',
      JSON.stringify({
        keywordCount:
          blockedKeywordEntriesForSmart.length,
        currentSkipped:
          contentFilteredSmartCandidateCount,
        previousSkipped:
          contentFilteredPreviousSmartCount,
        heavyCandidatesRemaining:
          rawCandidates.length
      })
    );
  }
  let previousArticleMap = new Map();
  for (const article of previousRawArticles) {
    if (article.articleKey) {
      previousArticleMap.set(article.articleKey, article);
    }
  }

  let candidates = [];
  let activeCandidates = new Set();

  for (let candidateIndex = 0; candidateIndex < rawCandidates.length; candidateIndex++) {
    const article = rawCandidates[candidateIndex];
    let status = 'NEW';

    // Ensure legacy articles have articleKey and contentHash
    if (!article.articleKey) {
      article.articleKey = article.link || `${article.sourceTitle || 'Unknown'}:${article.guid || article.id || ''}`;
    }
    if (!article.contentHash) {
      const cleanedTitle = (article.title || '').replace(/<[^>]*>?/gm, '');
      const cleanedContent = (article.content || article.summary || article.description || '').replace(/<[^>]*>?/gm, '').slice(0, 500);
      article.contentHash = createHash('sha256')
        .update([
          cleanedTitle,
          cleanedContent,
          article.pubDate || '',
          article.category || ''
        ].join('\n'))
        .digest('hex');
    }

    article.contentHash = createHash('sha256').update(JSON.stringify({
      embedding: buildEmbeddingText(article), verification: normalizedVerificationArticles([article]),
      category: article.smartCategory, region: article.region
    })).digest('hex');

    const prev = previousArticleMap.get(article.articleKey);

    if (prev) {
      if (prev.contentHash === article.contentHash) {
        status = 'UNCHANGED';
      } else {
        status = 'MODIFIED';
      }
    }

    article._status = status;
    candidates.push(article);
    activeCandidates.add(article.articleKey);
    if (candidateIndex > 0 && candidateIndex % 150 === 0) await new Promise(resolve => setImmediate(resolve));
  }

  for (const [key, prev] of previousArticleMap.entries()) {
    if (!activeCandidates.has(key)) {
      // EXPIRED or REMOVED (we just track it logically if needed)
      // we don't necessarily push it to candidates unless we want to process removals.
    }
  }

  metrics.articlesChecked = candidates.length;
  for (const article of candidates) metrics[article._status === 'NEW' ? 'newArticles' : article._status === 'MODIFIED' ? 'modifiedArticles' : 'unchangedArticles']++;
  metrics.removedArticles = [...previousArticleMap.keys()].filter(key => !activeCandidates.has(key)).length;
  notify('smart-checking', 'Checking for changes…');
  const currentSignature =
    stableId(
      candidates
        .map(article =>
          [
            article.link,
            article.title,
            article.pubDate,
            article.contentHash, article.smartCategory, article.language, article.region
          ].join('|')
        )
        .sort()
        .join('\n')
    );

  const previousSignature =
    (
      await db.get(
        'smartCandidateSignature'
      )
    ) || '';

  const sourceSignature =
    stableId(
      smartSources
        .map(source =>
          [
            source.url,
            source.category,
            source.region,
            source.weight, source.enabled, JSON.stringify(source.fetchMethods || [])
          ].join('|')
        )
        .sort()
        .join('\n')
    );

  const aiConfiguration =
    [
      EMBEDDING_MODEL, EMBEDDING_CACHE_VERSION,
      SMART_NEWS_AI_CONFIG.cache.promptVersion,
      SMART_NEWS_AI_CONFIG.cache.rulesVersion,
      SMART_NEWS_AI_CONFIG.cache.schemaVersion,
      SMART_CLUSTER_VERSION,
      sourceSignature, JSON.stringify(settings), [...dynamicExcludedUrls].sort().join(',')
    ].join('|');

  const previousAiConfiguration =
    (
      await db.get(
        'smartAiConfig'
      )
    ) || '';

  const attemptedState = { signature: currentSignature, configuration: aiConfiguration,
    providers: providers.map(p => `${p.id}:${p.model}`).join('|') };
  setAttemptedState(attemptedState);
  const failedAttempt = await db.get('smartClusteringFailedAttempt', { type: 'json' });
  if (!options.forceRebuild && failedAttempt && Object.keys(attemptedState).every(key => attemptedState[key] === failedAttempt[key])) {
    metrics.unresolvedAmbiguousGroups = failedAttempt.unresolvedAmbiguousGroups || 1;
    notify('smart-error', 'Unresolved matches unchanged; previous clusters retained. Use Force Rebuild to retry.', { failed: true });
    return { outcome: { ok: false, skipped: true, reason: 'unchanged_failed_verification', metrics } };
  }

  if (
    !options.forceRebuild &&
    currentSignature ===
    previousSignature &&
    previousAiConfiguration ===
    aiConfiguration &&
    (await db.get('smartClusteringAlgorithmVersion')) === SMART_CLUSTER_VERSION &&
    (await db.get('smartEmbeddingIdentity')) === `${EMBEDDING_MODEL}:${EMBEDDING_CACHE_VERSION}` &&
    previousSignature
  ) {
    metrics.cachedDecisionsReused = existingClusters.filter(cluster => cluster.verification?.method === 'ai_fallback').length;
    metrics.embeddingsReused = candidates.length;
    metrics.existingMembershipsReused = candidates.length;
    notify(
      'smart-ready',
      'No article changes; existing Smart clusters were reused.'
    );

    const completed = {
      state: 'ready',
      startedAt,
      completedAt:
        toVietnamIso(
          Date.now()
        ),
      sourceCounts,
      candidateCount:
        candidates.length,
      clusterCount:
        existingClusters.length,
      newArticleCount: 0,
      providerOrder,
      aiProviders: [],
      verificationStats: metrics,
      metrics,
      progress:
        getProgress()
    };

    await setStatus(
      completed
    );

    return { outcome: { ok: true, skipped: true, ...completed } };
  }

  notify(
    'smart-embeddings',
    'Generating embeddings…',
    {
      current: 0,
      total:
        candidates.length,
      percent: 0
    }
  );

  /*
   * Reuse saved clusters only when they were created by the
   * current clustering implementation.
   */
  const storedClusterVersion =
    (
      await db.get(
        'smartClusteringAlgorithmVersion'
      )
    ) || '';

  const embeddingIdentity = `${EMBEDDING_MODEL}:${EMBEDDING_CACHE_VERSION}`;
  const previousEmbeddingIdentity = await db.get('smartEmbeddingIdentity');
  const embeddingPolicyChanged = previousEmbeddingIdentity !== embeddingIdentity;
  const clusterVersionChanged = options.forceRebuild || storedClusterVersion !== SMART_CLUSTER_VERSION || embeddingPolicyChanged;
  metrics.rebuildReason = options.forceRebuild ? 'explicit_force_rebuild' : storedClusterVersion !== SMART_CLUSTER_VERSION ? 'clustering_policy_version_changed' : embeddingPolicyChanged ? 'embedding_policy_changed' : null;
  console.log('[SMART REBUILD]', JSON.stringify({ rebuild_reason: metrics.rebuildReason }));

  const existingClusterCountBeforeRebuild = existingClusters.length;
  let storyIdRetentionClusters = existingClusters;
  if (clusterVersionChanged) {
    // retainStoryIds needs only the previous cluster id and member links.
    // Keeping the full old 8k+ cluster snapshot alive through a clean
    // rebuild and minutes of AI review caused avoidable multi-GB heap use.
    storyIdRetentionClusters = existingClusters
      .filter(cluster => cluster?.clusterId)
      .map(cluster => ({
        clusterId: cluster.clusterId,
        link: cluster.link,
        relatedArticles: Array.isArray(cluster.relatedArticles)
          ? cluster.relatedArticles.map(article => ({ link: article.link }))
          : []
      }));
    existingClusters = [];
  }

  // Candidate preparation creates several overlapping article arrays/maps.
  // The compact `candidates` list is now authoritative, while raw Smart
  // articles are already serialized for publication. Release everything
  // else before HNSW and the long sequential AI phase.
  previousSmartArticlesForPrefetch = null;
  sourceResults = null;
  fetchedArticles = null;
  previousHidden = null;
  preservedHidden = null;
  hiddenArticles = null;
  existingArticles = null;
  feeds = null;
  activeStoredArticles.length = 0;
  activeStoredArticles = null;
  normalArticles.length = 0;
  normalArticles = null;
  normalizedHidden.length = 0;
  normalizedHidden = null;
  articleMap.clear();
  articleMap = null;
  rawCandidates.length = 0;
  rawCandidates = null;
  previousRawArticles = null;
  previousArticleMap.clear();
  previousArticleMap = null;
  activeCandidates.clear();
  activeCandidates = null;

  if (typeof global.gc === 'function') {
    global.gc();
    const memory = process.memoryUsage();
    console.log(
      '[SMART MEMORY] pre-clustering-release',
      JSON.stringify({
        rssMB: Math.round(memory.rss / 1024 / 1024),
        heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
        cleanRebuild: clusterVersionChanged
      })
    );
  }


return { candidates, existingClusters, storyIdRetentionClusters, sourceCounts, sourceErrors, successfulSourceCount, hiddenArticleCount, currentSignature, aiConfiguration, embeddingIdentity, clusterVersionChanged, storedClusterVersion, existingClusterCountBeforeRebuild, storedStoryRelationships, providers, providerOrder };
}
