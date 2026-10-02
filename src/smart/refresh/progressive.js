import { stableId } from '../articles/identity.js';
import { buildPublicationClusterSnapshot } from '../clustering/publication-snapshot.js';
import { mergeRelatedDevelopmentRelationships } from '../clustering/relationships.js';
import { deferredReviewPartitions } from '../clustering/review-groups.js';
import { SMART_CLUSTER_VERSION } from '../config.js';
import { toVietnamIso } from '../dates/publication-time.js';
import { getHeapStatistics } from 'node:v8';

export function createProgressivePublication(context) {
  let { candidates, autoMergedClusters, reviewGroups, clusterVersionChanged, existingClusters, isTargeted, targetCategory, storyIdRetentionClusters, storedStoryRelationships, currentSignature, startedAt, db, notify } = context;
  context = null;
  const progressiveRunId = stableId(
    [
      SMART_CLUSTER_VERSION,
      startedAt,
      currentSignature,
      targetCategory || 'all'
    ].join('|')
  );
  let progressiveRevision = 0;
  let progressiveVersion = '';
  let progressiveClusterCount = 0;

  const configuredProgressiveMaxCandidates =
    Number(
      process.env
        .SMART_PROGRESSIVE_MAX_CANDIDATES
    );

  const progressiveMaxCandidates =
    Number.isFinite(
      configuredProgressiveMaxCandidates
    ) &&
    configuredProgressiveMaxCandidates > 0
      ? Math.floor(
          configuredProgressiveMaxCandidates
        )
      : 6000;

  // A progressive publication duplicates almost the complete Smart
  // cluster graph while the clustering/review graph is still live.
  // For a large corpus this can consume more than a gigabyte of
  // additional old-space. Skip that optional intermediate view and
  // publish the normal final snapshot instead.
  const progressivePublicationAllowed =
    candidates.length <=
    progressiveMaxCandidates;

  let progressivePublicationDisabled =
    false;

  const progressiveResolvedByGroup =
    new Map();

  const progressiveBaselineByGroup =
    progressivePublicationAllowed
      ? new Map(
          reviewGroups.map(
            group => [
              group.id,
              deferredReviewPartitions(
                group,
                'verification_pending'
              )
            ]
          )
        )
      : new Map();

  const progressiveHeapLimitBytes =
    Number(getHeapStatistics().heap_size_limit) ||
    (4 * 1024 * 1024 * 1024);
  const configuredProgressiveHeapMb = Number(
    process.env.SMART_PROGRESSIVE_PUBLISH_HEAP_MAX_MB
  );
  const progressiveHeapMaxBytes =
    Number.isFinite(configuredProgressiveHeapMb) &&
    configuredProgressiveHeapMb > 0
      ? configuredProgressiveHeapMb * 1024 * 1024
      : Math.floor(progressiveHeapLimitBytes * 0.55);

  const publishProgressiveSnapshot = async ({
    completedGroups = 0,
    reviewRelationships = [],
    resolution = 'deterministic_base'
  } = {}) => {
    if (!reviewGroups.length) return false;

    if (!progressivePublicationAllowed) {
      if (!progressivePublicationDisabled) {
        progressivePublicationDisabled =
          true;

        console.warn(
          '[SMART PROGRESSIVE] Disabled for large corpus',
          JSON.stringify({
            candidates:
              candidates.length,
            maxCandidates:
              progressiveMaxCandidates,
            reviewGroups:
              reviewGroups.length
          })
        );

        // Retire a potentially huge progressive payload retained by
        // the in-memory DB from a previous run.
        await db.put(
          'smartProgressivePublication',
          'null'
        );

        await db.put(
          'smartProgressiveClusterState',
          JSON.stringify({
            active: false,
            provisional: true,
            stage:
              'disabled-large-corpus',
            version: '',
            runId:
              progressiveRunId,
            revision:
              progressiveRevision,
            algorithmVersion:
              SMART_CLUSTER_VERSION,
            candidateCount:
              candidates.length,
            totalReviewGroups:
              reviewGroups.length,
            reason:
              'large_corpus_memory_guard',
            updatedAt:
              toVietnamIso(
                Date.now()
              )
          })
        );

        progressiveResolvedByGroup.clear();
        progressiveBaselineByGroup.clear();

        if (
          typeof global.gc ===
          'function'
        ) {
          global.gc();

          const memory =
            process.memoryUsage();

          console.log(
            '[SMART MEMORY] progressive-disabled-gc',
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
      }

      return false;
    }

    let memory = process.memoryUsage();
    if (
      memory.heapUsed >= progressiveHeapMaxBytes &&
      typeof global.gc === 'function'
    ) {
      global.gc();
      memory = process.memoryUsage();
    }
    if (memory.heapUsed >= progressiveHeapMaxBytes) {
      console.warn(
        '[SMART PROGRESSIVE] Publication deferred under memory pressure',
        JSON.stringify({
          completedGroups,
          totalGroups: reviewGroups.length,
          heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
          heapLimitMB: Math.round(progressiveHeapLimitBytes / 1024 / 1024),
          publishThresholdMB: Math.round(progressiveHeapMaxBytes / 1024 / 1024)
        })
      );
      return false;
    }

    try {
      const reviewedClusters = reviewGroups.flatMap(
        group =>
          progressiveResolvedByGroup.has(group.id)
            ? progressiveResolvedByGroup.get(group.id)
            : (progressiveBaselineByGroup.get(group.id) || [])
      );
      const relationships =
        mergeRelatedDevelopmentRelationships(
          storedStoryRelationships,
          reviewRelationships
        );
      let snapshot = buildPublicationClusterSnapshot({
        candidates,
        autoMergedClusters,
        reviewedClusters,
        reviewGroups,
        clusterVersionChanged,
        existingClusters,
        isTargeted,
        targetCategory,
        storyIdRetentionClusters,
        storyRelationships: relationships
      });

      progressiveRevision++;
      progressiveVersion =
        `${progressiveRunId}_progressive_${progressiveRevision}_${snapshot.clusters.length}`;
      progressiveClusterCount = snapshot.clusters.length;
      const remainingGroups = Math.max(
        0,
        reviewGroups.length - completedGroups
      );

      notify(
        'smart-publishing',
        completedGroups > 0
          ? `Publishing verified Smart updates · ${completedGroups}/${reviewGroups.length} complete · ${remainingGroups} remaining`
          : `Publishing deterministic Smart snapshot · ${reviewGroups.length} review groups pending`,
        {
          current: completedGroups > 0 ? 2 : 1,
          total: 3,
          publicationPhase:
            completedGroups > 0
              ? 'progressive_review_update'
              : 'deterministic_base',
          reviewCurrent: completedGroups,
          reviewTotal: reviewGroups.length,
          reviewRemaining: remainingGroups,
          reviewResolution: resolution,
          progressive: true,
          progressiveRevision,
          progressiveVersion
        }
      );

      // Publish the large cluster payload first and the tiny activation
      // state second. Readers require matching versions, so they either see
      // the previous complete publication, this complete publication, or
      // safely fall back to the last final snapshot -- never a mixed pair.
      let progressivePublicationJson = JSON.stringify({
        version: progressiveVersion,
        revision: progressiveRevision,
        runId: progressiveRunId,
        clusters: snapshot.clusters
      });
      await db.put(
        'smartProgressivePublication',
        progressivePublicationJson
      );
      await db.put(
        'smartProgressiveClusterState',
        JSON.stringify({
          active: true,
          provisional: true,
          stage: 'reviewing',
          version: progressiveVersion,
          runId: progressiveRunId,
          revision: progressiveRevision,
          algorithmVersion: SMART_CLUSTER_VERSION,
          clusterCount: snapshot.clusters.length,
          completedReviewGroups: completedGroups,
          totalReviewGroups: reviewGroups.length,
          remainingReviewGroups: remainingGroups,
          lastResolution: resolution,
          updatedAt: toVietnamIso(Date.now())
        })
      );

      console.log(
        '[SMART PROGRESSIVE] Published',
        JSON.stringify({
          version: progressiveVersion,
          revision: progressiveRevision,
          clusters: snapshot.clusters.length,
          completedGroups,
          totalGroups: reviewGroups.length,
          remainingGroups,
          resolution
        })
      );

      progressivePublicationJson = null;
      snapshot.clusters.length = 0;
      snapshot.currentLinks.clear();
      snapshot = null;
      if (typeof global.gc === 'function') global.gc();
      return true;
    } catch (error) {
      console.warn(
        '[SMART PROGRESSIVE] Publication skipped:',
        error.message
      );
      return false;
    }
  };


  function release() {
    progressiveResolvedByGroup.clear();
    progressiveBaselineByGroup.clear();
    candidates = null;
    autoMergedClusters = null;
    reviewGroups = null;
    existingClusters = null;
    storyIdRetentionClusters = null;
    storedStoryRelationships = null;
  }
  return { publish: publishProgressiveSnapshot, recordResolved: (id, groups) => progressiveResolvedByGroup.set(id, groups), release, getRunId: () => progressiveRunId, getRevision: () => progressiveRevision };
}
