import { buildPublicationClusterSnapshot } from '../clustering/publication-snapshot.js';
import { mergeRelatedDevelopmentRelationships } from '../clustering/relationships.js';
import { resolveAmbiguousGroups } from '../clustering/resolver.js';
import { pruneReviewGroup } from '../prefilter/boundaries.js';
import { getSharedVectorStore } from '../../ranking/vector-store.js';

// Resolves the ambiguous review groups deterministically (no LLM) and builds the final cluster
// snapshot. Pairs without strong shared evidence stay separate; see clustering/resolver.js.
export async function resolveSmartCandidates(context) {
  let { candidates, autoMergedClusters, reviewGroups, clusterVersionChanged, existingClusters, isTargeted, targetCategory, storyIdRetentionClusters, storedStoryRelationships, metrics, ambiguousGroupCount, notify, vectors = getSharedVectorStore() } = context;
  context = null;

  // Candidates carry no vectors in this thread; the clustering worker persisted them in the embedding cache.
  const loading = vectors.warm(reviewGroups.flatMap(group => group.reviewUniverse || group.articles));
  if (loading) await loading;
  reviewGroups.forEach(pruneReviewGroup);
  const reviewResult = resolveAmbiguousGroups(reviewGroups, { vectorOf: article => article._vec || vectors.get(article) });
  notify?.('smart-resolve', `Resolved ${reviewResult.ambiguousGroupsTotal} ambiguous groups · ${reviewResult.mergedComponentPairs} merged on strong evidence`, {
    current: reviewResult.ambiguousGroupsTotal, total: reviewResult.ambiguousGroupsTotal });

  metrics.ambiguousGroupsResolved = reviewResult.ambiguousGroupsMerged;
  metrics.mergedComponentPairs = reviewResult.mergedComponentPairs;
  metrics.unresolvedAmbiguousGroups = reviewResult.ambiguousGroupsKeptSeparate;

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

  // Everything below needs the final cluster graph, but not the several
  // overlapping input graphs that were required to build it. Release them
  // before the snapshot is persisted.
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
      '[SMART MEMORY] post-resolve-gc',
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


  return { clusters, currentLinks, storyRelationshipsForSnapshot, candidateCountForCompleted, autoMergedClusterCountForCompleted, smartClusteringInputsJson, reviewResult, ambiguousGroupCount };
}
