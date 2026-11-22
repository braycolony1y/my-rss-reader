export function createSmartRefreshMetrics() { return { articlesChecked: 0, newArticles: 0, modifiedArticles: 0, unchangedArticles: 0,
      removedArticles: 0, embeddingsReused: 0, embeddingsGenerated: 0, existingMembershipsReused: 0,
      affectedClustersReconsidered: 0, deterministicMatches: 0, deterministicNonMatches: 0,
      ambiguousGroups: 0, ambiguousGroupsResolved: 0, mergedComponentPairs: 0,
      unresolvedAmbiguousGroups: 0, groupsSkippedTooLarge: 0, fullGroupRepartitions: 0,
      rebuildReason: null }; }

export async function recordSmartRefreshMetrics(db, metrics) {
try {
        const cumulative = (await db.get('smartClusteringCounters', { type: 'json' })) || {};
        for (const [key, value] of Object.entries(metrics)) if (typeof value === 'number') cumulative[key] = (Number(cumulative[key]) || 0) + value;
        await db.put('smartClusteringCounters', JSON.stringify(cumulative));
        console.log('[SMART SYNC METRICS]', JSON.stringify(metrics));
      } catch (error) { console.warn('[SMART METRICS]', error.message); }
}
