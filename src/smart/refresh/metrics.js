import { getVerificationCache } from '../verification/cache.js';

export function createSmartRefreshMetrics() { return { articlesChecked: 0, newArticles: 0, modifiedArticles: 0, unchangedArticles: 0,
      removedArticles: 0, embeddingsReused: 0, embeddingsGenerated: 0, existingMembershipsReused: 0,
      affectedClustersReconsidered: 0, deterministicMatches: 0, deterministicNonMatches: 0,
      ambiguousGroups: 0, verificationCacheHits: 0, verificationCacheMisses: 0,
      cachedDecisionsReused: 0, cachedDecisionsInvalidated: 0, invalidationReason: null,
      firstPassAiCalls: 0, firstPassValidJson: 0, firstPassInvalidJson: 0, markdownFenceRecoveries: 0,
      safeExtractionRecoveries: 0, repairAttempts: 0, repairSuccesses: 0, repairFailures: 0,
      jsonRepairCalls: 0, fallbackProviderCalls: 0,
      fallbackProviderAttempts: 0, fallbackProviderSuccesses: 0, allProviderFailures: 0,
      successfulVerificationDecisions: 0, unresolvedAmbiguousGroups: 0, deferredAmbiguousGroups: 0,
      groupsSkippedTooLarge: 0, fullGroupRepartitions: 0,
      rebuildReason: null }; }

export async function recordSmartRefreshMetrics(db, metrics) {
try {
        const cumulative = (await db.get('smartClusteringCounters', { type: 'json' })) || {};
        for (const [key, value] of Object.entries(metrics)) if (typeof value === 'number') cumulative[key] = (Number(cumulative[key]) || 0) + value;
        cumulative.totalCacheEntries = Object.keys(await getVerificationCache(db)).length;
        cumulative.totalAiCallsAvoidedByCache = cumulative.verificationCacheHits || 0;
        await db.put('smartClusteringCounters', JSON.stringify(cumulative));
        console.log('[SMART SYNC METRICS]', JSON.stringify(metrics));
      } catch (error) { console.warn('[SMART METRICS]', error.message); }
}
