import { pruneReviewGroup } from '../prefilter/boundaries.js';
import { getArticleId, createGroupId } from '../articles/identity.js';
import { verifyWithProviderChain } from '../verification/review.js';
import { deferredReviewPartitions } from './review-groups.js';
import { createReviewMemoryPolicy } from '../verification/memory-policy.js';

async function reviewAmbiguousEventGroups(
  ambiguousGroups,
  providers,
  keyManager,
  db,
  onProgress = null,
  onGroupResolved = null
) {
  const resolvedGroups = [];

  const statistics = {
    ambiguousGroupsTotal:
      ambiguousGroups.length,
    ambiguousGroupsVerified: 0,
    ambiguousGroupsFromCache: 0,
    ambiguousGroupsKeptSeparate: 0,
    ambiguousGroupsDeferred: 0,
    memoryPressureDeferredGroups: 0,
    reviewedArticleCount: 0,
    allProvidersFailedCount: 0,
    providerRequests: {},
    deferredGroups: [],
    storyRelationships: [],
    groupResults: []
  };

  const memoryPolicy = createReviewMemoryPolicy();

  for (
    let index = 0;
    index < ambiguousGroups.length;
    index++
  ) {
    const group =
      pruneReviewGroup(ambiguousGroups[index]);
    if (!group.articles.length) continue;

    statistics.reviewedArticleCount +=
      group.articles.length;

    if (onProgress) {
      const current = index + 1;
      const remaining = Math.max(
        0,
        ambiguousGroups.length - current
      );
      onProgress({
        stage: 'smart-ai',
        message:
          `Smart Verify · Group ${current}/${ambiguousGroups.length} · ${remaining} remaining · checking cache`,
        current,
        total: ambiguousGroups.length,
        remaining,
        reviewGroupId: group.id,
        reviewArticleCount: group.articles.length
      });
    }

    const resolvedStartIndex = resolvedGroups.length;

    const pressure = memoryPolicy.check({ completedGroups: index, totalGroups: ambiguousGroups.length });

    const result = pressure.defer
      ? {
        valid: true,
        uncertain: true,
        providerId: null,
        model: null,
        attemptedProviders: [],
        skippedProviders: [],
        resolution: 'deferred',
        reviewMode:
          Array.isArray(group.deferredComponents) && group.deferredComponents.length
            ? 'components'
            : 'articles',
        reviewUnitCount:
          Array.isArray(group.deferredComponents) && group.deferredComponents.length
            ? group.deferredComponents.length
            : group.articles.length,
        fallbackReason: 'memory_pressure',
        clusters: []
      }
      : await verifyWithProviderChain(
        group,
        providers,
        keyManager,
        db
      );

    if (result.fallbackReason === 'memory_pressure') {
      statistics.memoryPressureDeferredGroups++;
    }

    for (
      const providerId
      of result.attemptedProviders
    ) {
      statistics.providerRequests[
        providerId
      ] =
        (
          statistics
            .providerRequests[
          providerId
          ] || 0
        ) + 1;
    }

    if (
      result.resolution ===
      'verified'
    ) {
      statistics
        .ambiguousGroupsVerified++;
    } else if (
      result.resolution ===
      'cached'
    ) {
      statistics
        .ambiguousGroupsFromCache++;
    } else if (
      result.resolution ===
      'deferred'
    ) {
      statistics
        .ambiguousGroupsDeferred++;
    } else {
      statistics
        .ambiguousGroupsKeptSeparate++;

      statistics
        .allProvidersFailedCount++;
    }

    statistics.groupResults.push({
      groupId: group.id,
      articleCount:
        group.articles.length,
      attemptedProviders:
        result.attemptedProviders,
      successfulProvider:
        result.providerId,
      successfulModel:
        result.model,
      resolution:
        result.resolution,
      fallbackReason:
        result.fallbackReason || null,
      reviewMode:
        result.reviewMode || 'articles',
      reviewUnitCount:
        result.reviewUnitCount || group.articles.length,
      relatedDevelopmentCount:
        Array.isArray(result.storyRelationships)
          ? result.storyRelationships.length
          : 0
    });

    if (Array.isArray(result.storyRelationships) && result.storyRelationships.length) {
      statistics.storyRelationships.push(
        ...result.storyRelationships.map(relationship => ({
          ...relationship,
          reviewGroupId: group.id,
          providerId: result.providerId,
          model: result.model,
          verifiedAt: result.verifiedAt
        }))
      );
    }

    if (result.resolution === 'deferred') {
      const deferredPartitions = deferredReviewPartitions(
        group,
        result.fallbackReason || 'group_too_large'
      );
      resolvedGroups.push(...deferredPartitions);

      console.warn(
        '[SMART VERIFY DEFERRED]',
        JSON.stringify({
          groupId: group.id,
          articleCount: (group.reviewUniverse || group.articles).length,
          componentCount: deferredPartitions.length,
          reason: result.fallbackReason || 'group_too_large'
        })
      );

      statistics.deferredGroups.push({
        groupId: group.id,
        reason: result.fallbackReason || 'group_too_large',
        articleIds: (group.reviewUniverse || group.articles).map(getArticleId).sort(),
        components: deferredPartitions.map(partition => partition.articles.map(getArticleId).sort()),
        fullRepartition: group.fullRepartition === true,
        deferredAt: new Date().toISOString(),
        skippedProviders: result.skippedProviders || []
      });

      if (onProgress) {
        onProgress({
          stage: 'smart-ai',
          message:
            `Smart Verify ${index + 1}/${ambiguousGroups.length} · ${Math.max(0, ambiguousGroups.length - index - 1)} remaining · deferred; deterministic components retained`,
          current: index + 1,
          total: ambiguousGroups.length,
          reviewGroupId: group.id,
          reviewArticleCount: group.articles.length,
          reviewResolution: 'deferred'
        });
      }
    }

    for (
      const partition
      of result.clusters
    ) {
      const partitionSet =
        new Set(
          partition.articleIds
        );

      const partitionArticles =
        (result.reviewMode === 'components'
          ? (group.reviewUniverse || group.articles)
          : group.articles
        ).filter(
          article =>
            partitionSet.has(
              getArticleId(
                article
              )
            )
        );

      if (!partitionArticles.length) {
        continue;
      }

      const verified =
        result.resolution ===
        'verified' ||
        result.resolution ===
        'cached';

      resolvedGroups.push({
        reviewRequestId: group.id,
        id:
          createGroupId(
            partitionArticles
          ),

        articles:
          partitionArticles,

        verified,

        providerId:
          result.providerId,

        model:
          result.model,

        verifiedAt:
          result.verifiedAt,

        verification:
          verified
            ? {
              method:
                'ai_fallback',
              providerId:
                result.providerId,
              model:
                result.model,
              verifiedAt:
                result.verifiedAt
            }
            : {
              method:
                'kept_separate',
              reason:
                result.fallbackReason
            }
      });
    }

    const resolvedForGroup = resolvedGroups.slice(
      resolvedStartIndex
    );

    if (onProgress) {
      const remaining = Math.max(
        0,
        ambiguousGroups.length - index - 1
      );
      onProgress({
        stage: 'smart-ai',
        message:
          `Smart Verify ${index + 1}/${ambiguousGroups.length} complete · ${remaining} remaining · result: ${result.resolution}`,
        current: index + 1,
        total: ambiguousGroups.length,
        remaining,
        reviewGroupId: group.id,
        reviewArticleCount: group.articles.length,
        reviewResolution: result.resolution,
        providerId: result.providerId || null,
        model: result.model || null
      });
    }

    if (typeof onGroupResolved === 'function') {
      await onGroupResolved({
        index,
        group,
        result,
        resolvedForGroup,
        resolvedGroups,
        statistics
      });
    }

    if (
      result.resolution !== 'verified' &&
      result.resolution !== 'cached' &&
      result.resolution !== 'deferred'
    ) {
      console.warn(
        '[SMART VERIFY] Stopping remaining ambiguous reviews after unresolved group',
        JSON.stringify({
          groupId: group.id,
          articleCount: group.articles.length,
          reason:
            result.fallbackReason ||
            'all_providers_failed_or_uncertain',
          remainingGroups:
            Math.max(
              0,
              ambiguousGroups.length - index - 1
            )
        })
      );

      if (typeof global.gc === 'function') {
        global.gc();
      }

      break;
    }

    if ((index + 1) % 10 === 0) {
      const memory = process.memoryUsage();
      console.log(
        '[SMART MEMORY] ai-review-progress',
        JSON.stringify({
          completedGroups: index + 1,
          totalGroups: ambiguousGroups.length,
          rssMB: Math.round(memory.rss / 1024 / 1024),
          heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024)
        })
      );
    }
  }


  return {
    clusters:
      resolvedGroups,
    ...statistics
  };
}

export { reviewAmbiguousEventGroups };
