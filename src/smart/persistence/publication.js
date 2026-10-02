import { SMART_CLUSTER_VERSION, SMART_NEWS_CLUSTER_CONFIG } from '../config.js';
import { toVietnamIso } from '../dates/publication-time.js';
import { assessSmartEditorialClusters } from '../editorial/assessment.js';
import { getProviderHealth } from '../verification/provider-health.js';
import { putManySafe } from './smart-state.js';

export async function publishSmartSnapshot(context) {
  let { clusters, currentLinks, storyRelationshipsForSnapshot, candidateCountForCompleted, autoMergedClusterCountForCompleted, smartClusteringInputsJson, aiProvidersUsed, reviewResult, ambiguousGroupCount, progressiveRunId, progressiveRevision, releaseProgressive, smartSources, providers, keyManager, db, notify, metrics, embeddingIdentity, currentSignature, aiConfiguration, startedAt, sourceCounts, successfulSourceCount, sourceErrors, hiddenArticleCount, providerOrder, hasGeminiKey, localModel, getProgress } = context;
  context = null;
  let autoMergedClusters = null, reviewGroups = null, candidates = null, storyIdRetentionClusters = null, existingClusters = null, finalSnapshot = null;
  const editorialStats =
    await assessSmartEditorialClusters({
      clusters,
      sources:
        smartSources,
      providers,
      keyManager,
      db,
      notify,
      metrics
    });

  if (typeof global.gc === 'function') {
    global.gc();
    const memory = process.memoryUsage();
    console.log(
      '[SMART MEMORY] post-editorial-gc',
      JSON.stringify({
        rssMB: Math.round(memory.rss / 1024 / 1024),
        heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024)
      })
    );
  }

  metrics.editorialCacheHits =
    editorialStats.cacheHits;

  metrics.editorialAssessed =
    editorialStats.assessed;



  metrics.editorialAiCalls =
    editorialStats.aiCalls;
metrics.editorialAssessmentFailures =
    editorialStats.failed;

  metrics.editorialAssessmentPending =
    editorialStats.pending;

  console.log(
    '[SMART EDITORIAL]',
    JSON.stringify(
      editorialStats
    )
  );

  const clusterVersion =
    `${toVietnamIso(Date.now())}_${clusters.length}`;

  notify(
    'smart-publishing',
    'Publishing final Smart snapshot…',
    {
      current: 3,
      total: 3,
      publicationPhase: 'final',
      progressive: false
    }
  );
  await putManySafe(
    db,
    {
      smartEmbeddingIdentity: embeddingIdentity,
      smartClusteringFailedAttempt: 'null',
      smartDeferredReviewGroups:
        JSON.stringify({
          algorithmVersion: SMART_CLUSTER_VERSION,
          updatedAt: toVietnamIso(Date.now()),
          groups: reviewResult.deferredGroups || [],
          relationships: storyRelationshipsForSnapshot
        }),
      smartClusteringInputs:
        smartClusteringInputsJson,
      smartClusters:
        JSON.stringify(
          clusters
        ),

      /*
       * Timestamp/snapshot identifier for this saved result.
       */
      smartClusterVersion:
        clusterVersion,

      /*
       * Clustering implementation that produced these clusters.
       * Saved atomically with smartClusters only after success.
       */
      smartClusteringAlgorithmVersion:
        SMART_CLUSTER_VERSION,

      /*
       * Publish the completed snapshot and its identity atomically.
       */
      smartClusterState:
        JSON.stringify({
          provisional: false,
          stage: 'ready',
          clusterCount:
            clusters.length,
          ambiguousGroupsTotal:
            ambiguousGroupCount,
          ambiguousGroupsReviewed:
            reviewResult
              .ambiguousGroupsTotal,
          ambiguousGroupsDeferred:
            reviewResult
              .ambiguousGroupsDeferred || 0,
          memoryPressureDeferredGroups:
            reviewResult
              .memoryPressureDeferredGroups || 0,
          relatedDevelopmentCount:
            storyRelationshipsForSnapshot.length,
          completedAt:
            toVietnamIso(
              Date.now()
            )
        }),

      smartCandidateLinks:
        JSON.stringify(
          [...currentLinks].sort()
        ),

      smartCandidateSignature:
        currentSignature,

      smartAiConfig:
        aiConfiguration,

      // Final publication atomically retires the progressive view.
      smartProgressivePublication:
        'null',
      smartProgressiveClusterState:
        JSON.stringify({
          active: false,
          provisional: false,
          stage: 'ready',
          version: '',
          runId: progressiveRunId,
          revision: progressiveRevision,
          algorithmVersion: SMART_CLUSTER_VERSION,
          completedReviewGroups: reviewResult.ambiguousGroupsTotal,
          totalReviewGroups: reviewResult.ambiguousGroupsTotal,
          remainingReviewGroups: 0,
          completedAt: toVietnamIso(Date.now())
        })
    },
    {
      allowLargeReduction:
        true
    }
  );

  if (typeof global.gc === 'function') {
    global.gc();
    const memory = process.memoryUsage();
    console.log(
      '[SMART MEMORY] post-final-persist-gc',
      JSON.stringify({
        rssMB: Math.round(memory.rss / 1024 / 1024),
        heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024)
      })
    );
  }

  const providerHealth =
    await getProviderHealth(db);

  const completed = {
    metrics,
    state: 'ready',
    provisional: false,
    startedAt,
    completedAt:
      toVietnamIso(
        Date.now()
      ),
    configuredSourceCount:
      smartSources.length,
    sourceCounts,
    successfulSourceCount,
    failedSourceCount:
      sourceErrors.length,
    sourceErrors,
    hiddenArticleCount,
    candidateCount:
      candidateCountForCompleted,
    clusterCount:
      clusters.length,
    autoMergedClusterCount:
      autoMergedClusterCountForCompleted,
    ambiguousGroupCount:
      ambiguousGroupCount,
    providerOrder,
    aiProviders:
      aiProvidersUsed,
    geminiConfigured:
      hasGeminiKey(),
    geminiUsed:
      aiProvidersUsed.some(
        providerId =>
          providerId.startsWith(
            'gemini-'
          )
      ),
    localConfigured:
      providers.some(
        provider =>
          provider.type ===
          'ollama'
      ),
    localUsed:
      aiProvidersUsed.includes(
        'local-qwen'
      ),
    localModel,
    verificationStats: {
      ambiguousGroupsTotal:
        reviewResult
          .ambiguousGroupsTotal,
      ambiguousGroupsVerified:
        reviewResult
          .ambiguousGroupsVerified,
      ambiguousGroupsFromCache:
        reviewResult
          .ambiguousGroupsFromCache,
      ambiguousGroupsKeptSeparate:
        reviewResult
          .ambiguousGroupsKeptSeparate,
      ambiguousGroupsDeferred:
        reviewResult
          .ambiguousGroupsDeferred || 0,
      memoryPressureDeferredGroups:
        reviewResult
          .memoryPressureDeferredGroups || 0,
      relatedDevelopmentCount:
        (reviewResult.storyRelationships || []).length,
      activeRelatedDevelopmentCount:
        storyRelationshipsForSnapshot.length,
      reviewedArticleCount:
        reviewResult
          .reviewedArticleCount,
      allProvidersFailedCount:
        reviewResult
          .allProvidersFailedCount,
      providerRequests:
        reviewResult
          .providerRequests,
      groupResults:
        reviewResult
          .groupResults
    },
    aiProviderHealth:
      providerHealth,
    comparisonWindowHours:
      SMART_NEWS_CLUSTER_CONFIG
        .comparisonWindowHours,
    timezone:
      'Asia/Ho_Chi_Minh (UTC+7)',
    progress:
      getProgress()
  };

  // The Top Stories reconciler may start as soon as status becomes
  // ready. Release the heavy HNSW/review graph first so ranking does not
  // overlap with several gigabytes of now-dead clustering state.
  releaseProgressive();
  if (Array.isArray(reviewResult?.clusters)) {
    reviewResult.clusters.length = 0;
  }
  reviewResult = null;
  if (Array.isArray(autoMergedClusters)) {
    autoMergedClusters.length = 0;
  }
  autoMergedClusters = null;
  if (Array.isArray(reviewGroups)) {
    reviewGroups.length = 0;
  }
  reviewGroups = null;
  if (Array.isArray(candidates)) {
    candidates.length = 0;
  }
  candidates = null;
  storyIdRetentionClusters = null;
  existingClusters = null;
  if (currentLinks) currentLinks.clear();
  currentLinks = null;
  if (finalSnapshot?.clusters) {
    finalSnapshot.clusters.length = 0;
  }
  finalSnapshot = null;
  clusters.length = 0;
  clusters = null;

  if (typeof global.gc === 'function') {
    global.gc();
    const memory = process.memoryUsage();
    console.log(
      '[SMART MEMORY] pre-ready-gc',
      JSON.stringify({
        rssMB: Math.round(memory.rss / 1024 / 1024),
        heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024)
      })
    );
  }


  return completed;
}
