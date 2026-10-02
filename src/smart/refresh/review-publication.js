import { createGroupId } from '../articles/identity.js';
import { buildPublicationClusterSnapshot } from '../clustering/publication-snapshot.js';
import { mergeRelatedDevelopmentRelationships } from '../clustering/relationships.js';
import { reviewAmbiguousEventGroups } from '../clustering/review.js';
import { SMART_NEWS_CLUSTER_CONFIG } from '../config.js';
import { createProgressivePublication } from './progressive.js';

export async function reviewSmartCandidates(context) {
  let { candidates, autoMergedClusters, reviewGroups, clusterVersionChanged, existingClusters, isTargeted, targetCategory, storyIdRetentionClusters, storedStoryRelationships, currentSignature, startedAt, db, notify, providers, keyManager, metrics, ambiguousGroupCount } = context;
  const progressive = createProgressivePublication(context);
  context = null;
  // As soon as HNSW has produced a membership-valid deterministic state,
  // make that state available without replacing the last final snapshot.
  // AI-verified changes are layered into this separate progressive key.
  await progressive.publish({
    completedGroups: 0,
    reviewRelationships: [],
    resolution: 'deterministic_base'
  });

  let reviewResult = {
    clusters:
      reviewGroups.flatMap(
        group =>
          group.articles.map(
            article => ({
              id:
                createGroupId(
                  [article]
                ),
              articles:
                [article],
              verified:
                false,
              verification:
              {
                method:
                  'kept_separate',
                reason:
                  providers.length
                    ? 'verification_not_run'
                    : 'no_provider_configured'
              }
            })
          )
      ),
    ambiguousGroupsTotal:
      reviewGroups.length,
    ambiguousGroupsVerified:
      0,
    ambiguousGroupsFromCache:
      0,
    ambiguousGroupsKeptSeparate:
      reviewGroups.length,
    ambiguousGroupsDeferred:
      0,
    memoryPressureDeferredGroups:
      0,
    reviewedArticleCount:
      0,
    allProvidersFailedCount:
      providers.length
        ? reviewGroups.length
        : 0,
    providerRequests: {},
    deferredGroups: [],
    storyRelationships: [],
    groupResults: []
  };

  if (
    reviewGroups.length &&
    SMART_NEWS_CLUSTER_CONFIG
      .heavyAI
      .enabled
  ) {
    reviewResult =
      await reviewAmbiguousEventGroups(
        reviewGroups,
        providers,
        keyManager,
        db,
        progress =>
          notify(
            progress.stage ||
            'smart-ai',
            progress.message ||
            'AI verification in progress…',
            progress
          ),
        async ({
          index,
          group,
          result,
          resolvedForGroup,
          statistics
        }) => {
          if (
            result.resolution !== 'verified' &&
            result.resolution !== 'cached'
          ) {
            return;
          }

          progressive.recordResolved(
            group.id,
            resolvedForGroup
          );
          await progressive.publish({
            completedGroups: index + 1,
            reviewRelationships:
              statistics.storyRelationships || [],
            resolution: result.resolution
          });
        }
      );
  }

  metrics.deferredAmbiguousGroups =
    Number(reviewResult.ambiguousGroupsDeferred) || 0;
  metrics.memoryPressureDeferredGroups =
    Number(reviewResult.memoryPressureDeferredGroups) || 0;

  if (reviewResult.ambiguousGroupsKeptSeparate > 0) {
    metrics.unresolvedAmbiguousGroups = reviewResult.ambiguousGroupsKeptSeparate;
    console.warn(
      '[SMART VERIFY DEFERRED]',
      JSON.stringify({
        reason: 'conservative_kept_separate_fallback',
        groups: reviewResult.ambiguousGroupsKeptSeparate
      })
    );
  }

  const mergedStoryRelationships =
    mergeRelatedDevelopmentRelationships(
      storedStoryRelationships,
      reviewResult.storyRelationships || []
    );

  let finalSnapshot =
    buildPublicationClusterSnapshot({
      candidates,
      autoMergedClusters,
      reviewedClusters: reviewResult.clusters,
      reviewGroups,
      clusterVersionChanged,
      existingClusters,
      isTargeted,
      targetCategory,
      storyIdRetentionClusters,
      storyRelationships: mergedStoryRelationships
    });

  let clusters = finalSnapshot.clusters;
  let currentLinks = finalSnapshot.currentLinks;
  let storyRelationshipsForSnapshot =
    finalSnapshot.storyRelationships;

  // Everything below editorial assessment needs the final cluster graph,
  // but it does not need the several overlapping input graphs that were
  // required to build it. Keeping all of them alive through minutes of
  // AI editorial work caused the main process to approach the V8 heap
  // limit before Top Stories could run.
  const candidateCountForCompleted =
    candidates.length;

  const autoMergedClusterCountForCompleted =
    autoMergedClusters.length;

  const smartClusteringInputsJson =
    JSON.stringify(
      candidates.map(
        article => ({
          articleKey:
            article.articleKey,
          contentHash:
            article.contentHash
        })
      )
    );

  const aiProvidersUsed =
    [
      ...new Set(
        reviewResult
          .clusters
          .map(
            group =>
              group
                .providerId
          )
          .filter(Boolean)
      )
    ];

  // Progressive reconciliation is finished once the final publication
  // snapshot has been assembled.
  progressive.release();

  if (
    Array.isArray(
      reviewResult?.clusters
    )
  ) {
    reviewResult.clusters.length = 0;
  }

  if (
    Array.isArray(
      autoMergedClusters
    )
  ) {
    autoMergedClusters.length = 0;
  }
  autoMergedClusters = null;

  if (
    Array.isArray(
      reviewGroups
    )
  ) {
    reviewGroups.length = 0;
  }
  reviewGroups = null;

  if (
    Array.isArray(
      candidates
    )
  ) {
    candidates.length = 0;
  }
  candidates = null;

  storyIdRetentionClusters = null;
  existingClusters = null;

  // Keep the extracted final graph, links and relationships, but release
  // the wrapper object itself.
  finalSnapshot = null;

  if (
    typeof global.gc ===
    'function'
  ) {
    global.gc();

    const memory =
      process.memoryUsage();

    console.log(
      '[SMART MEMORY] pre-editorial-gc',
      JSON.stringify({
        rssMB:
          Math.round(
            memory.rss /
            1024 /
            1024
          ),
        heapUsedMB:
          Math.round(
            memory.heapUsed /
            1024 /
            1024
          ),
        heapTotalMB:
          Math.round(
            memory.heapTotal /
            1024 /
            1024
          )
      })
    );
  }


  return { clusters, currentLinks, storyRelationshipsForSnapshot, candidateCountForCompleted, autoMergedClusterCountForCompleted, smartClusteringInputsJson, aiProvidersUsed, reviewResult, ambiguousGroupCount, progressiveRunId: progressive.getRunId(), progressiveRevision: progressive.getRevision(), releaseProgressive: progressive.release };
}
