import { survivingClusters } from '../prefilter/boundaries.js';
import { buildCluster } from '../clustering/cluster.js';
import { SMART_CLUSTER_VERSION, SMART_NEWS_CLUSTER_CONFIG } from '../config.js';
import { toVietnamIso } from '../dates/publication-time.js';
import { putManySafe } from './smart-state.js';

export async function publishSmartSnapshot(context) {
  let { clusters, currentLinks, storyRelationshipsForSnapshot, candidateCountForCompleted, autoMergedClusterCountForCompleted, smartClusteringInputsJson, reviewResult, ambiguousGroupCount, smartSources, db, notify, metrics, embeddingIdentity, currentSignature, aiConfiguration, startedAt, sourceCounts, successfulSourceCount, sourceErrors, hiddenArticleCount, getProgress } = context;
  context = null;
  let autoMergedClusters = null, reviewGroups = null, candidates = null, storyIdRetentionClusters = null, existingClusters = null, finalSnapshot = null;
  clusters = survivingClusters(clusters, buildCluster);

  if (typeof global.gc === 'function') {
    global.gc();
    const memory = process.memoryUsage();
    console.log(
      '[SMART MEMORY] post-prefilter-gc',
      JSON.stringify({
        rssMB: Math.round(memory.rss / 1024 / 1024),
        heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024)
      })
    );
  }

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
          groups: [],
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
          ambiguousGroupsResolved:
            reviewResult
              .ambiguousGroupsTotal,
          ambiguousGroupsMerged:
            reviewResult
              .ambiguousGroupsMerged || 0,
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
        aiConfiguration
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
    resolverStats: {
      ambiguousGroupsTotal:
        reviewResult
          .ambiguousGroupsTotal,
      ambiguousGroupsMerged:
        reviewResult
          .ambiguousGroupsMerged,
      ambiguousGroupsKeptSeparate:
        reviewResult
          .ambiguousGroupsKeptSeparate,
      mergedComponentPairs:
        reviewResult
          .mergedComponentPairs,
      reviewedArticleCount:
        reviewResult
          .reviewedArticleCount,
      activeRelatedDevelopmentCount:
        storyRelationshipsForSnapshot.length,
      groupResults:
        reviewResult
          .groupResults
    },
    comparisonWindowHours:
      SMART_NEWS_CLUSTER_CONFIG
        .comparisonWindowHours,
    timezone:
      'Asia/Ho_Chi_Minh (UTC+7)',
    progress:
      getProgress()
  };

  // Release the heavy HNSW/review graph before status becomes ready.
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
