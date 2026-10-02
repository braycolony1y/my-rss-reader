import { parseClusteringJson } from '../../ai/clustering-json.js';
import { getArticleId } from '../articles/identity.js';
import { detectEventConflicts } from '../clustering/event-evidence.js';
import { cosineSimilarity, classifyE5Match, MatchDecision, isAiRecoveryReviewCandidate } from '../clustering/similarity.js';
import { tokenOverlapCount, tokenSimilarity } from '../text/normalize.js';

function validateComponentReviewResult(result, units) {
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    !Array.isArray(result.exactEventGroups) ||
    !Array.isArray(result.relatedDevelopments) ||
    typeof result.uncertain !== 'boolean' ||
    Object.keys(result).some(key => !['exactEventGroups', 'relatedDevelopments', 'uncertain'].includes(key))
  ) {
    return { valid: false, reason: 'invalid_component_schema' };
  }

  const requestedIds = units.map(unit => unit.id);
  const requestedSet = new Set(requestedIds);
  const returnedIds = [];
  const groupByComponent = new Map();

  for (let index = 0; index < result.exactEventGroups.length; index++) {
    const group = result.exactEventGroups[index];
    if (
      !group ||
      typeof group !== 'object' ||
      Array.isArray(group) ||
      Object.keys(group).some(key => !['componentIds', 'confidence'].includes(key)) ||
      !Array.isArray(group.componentIds) ||
      !group.componentIds.length ||
      typeof group.confidence !== 'number' ||
      !Number.isFinite(group.confidence) ||
      group.confidence < 0 ||
      group.confidence > 1
    ) {
      return { valid: false, reason: 'invalid_exact_event_group' };
    }

    for (const componentId of group.componentIds) {
      if (!requestedSet.has(componentId)) {
        return { valid: false, reason: 'unknown_component_id' };
      }
      if (groupByComponent.has(componentId)) {
        return { valid: false, reason: 'duplicate_component_id' };
      }
      groupByComponent.set(componentId, index);
      returnedIds.push(componentId);
    }
  }

  if (
    returnedIds.length !== requestedIds.length ||
    requestedIds.some(componentId => !groupByComponent.has(componentId))
  ) {
    return { valid: false, reason: 'missing_component_id' };
  }

  const relationKeys = new Set();
  for (const relation of result.relatedDevelopments) {
    if (
      !relation ||
      typeof relation !== 'object' ||
      Array.isArray(relation) ||
      Object.keys(relation).some(key => !['componentIds', 'confidence'].includes(key)) ||
      !Array.isArray(relation.componentIds) ||
      relation.componentIds.length !== 2 ||
      relation.componentIds[0] === relation.componentIds[1] ||
      relation.componentIds.some(componentId => !requestedSet.has(componentId)) ||
      typeof relation.confidence !== 'number' ||
      !Number.isFinite(relation.confidence) ||
      relation.confidence < 0 ||
      relation.confidence > 1
    ) {
      return { valid: false, reason: 'invalid_related_development' };
    }

    const [left, right] = relation.componentIds;
    if (groupByComponent.get(left) === groupByComponent.get(right)) {
      return { valid: false, reason: 'relationship_inside_same_event' };
    }
    const key = [left, right].sort().join('|');
    if (relationKeys.has(key)) {
      return { valid: false, reason: 'duplicate_related_development' };
    }
    relationKeys.add(key);
  }

  return { valid: true, reason: null };
}

function expandComponentReviewDecision(result, units) {
  const unitById = new Map(units.map(unit => [unit.id, unit]));
  const exactGroups = result.exactEventGroups.map(group => ({
    componentIds: group.componentIds,
    confidence: group.confidence,
    articleIds: [...new Set(group.componentIds.flatMap(componentId => unitById.get(componentId)?.articleIds || []))].sort()
  }));
  const exactGroupByComponent = new Map();
  exactGroups.forEach((group, index) => group.componentIds.forEach(componentId => exactGroupByComponent.set(componentId, index)));

  const relationships = [];
  const seen = new Set();
  for (const relation of result.relatedDevelopments) {
    if (relation.confidence < 0.9) continue;
    const leftIndex = exactGroupByComponent.get(relation.componentIds[0]);
    const rightIndex = exactGroupByComponent.get(relation.componentIds[1]);
    if (leftIndex === undefined || rightIndex === undefined || leftIndex === rightIndex) continue;
    const pair = [leftIndex, rightIndex].sort((a, b) => a - b);
    const key = pair.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    relationships.push({
      type: 'related_development',
      confidence: relation.confidence,
      leftArticleIds: exactGroups[pair[0]].articleIds,
      rightArticleIds: exactGroups[pair[1]].articleIds
    });
  }

  return {
    clusters: exactGroups.map(group => ({ articleIds: group.articleIds, confidence: group.confidence })),
    storyRelationships: relationships,
    uncertain: result.uncertain === true
  };
}

function parsePartitionResponse(
  raw,
  providerName
) {
  return parseClusteringJson(raw);
}

function validatePartitionResult(
  result,
  articles
) {
  if (
    !result ||
    !Array.isArray(result.clusters) ||
    typeof result.uncertain !==
    'boolean'
  ) {
    return {
      valid: false,
      reason: 'invalid_schema'
    };
  }

  if (Array.isArray(result) || Object.keys(result).some(key => !['clusters', 'uncertain'].includes(key))) {
    return { valid: false, reason: 'wrong_root_type' };
  }
  for (const cluster of result.clusters) {
    if (!cluster || typeof cluster !== 'object' || Array.isArray(cluster) ||
        Object.keys(cluster).some(key => !['articleIds', 'confidence'].includes(key)) ||
        (cluster.confidence !== undefined && (typeof cluster.confidence !== 'number' || !Number.isFinite(cluster.confidence) || cluster.confidence < 0 || cluster.confidence > 1))) {
      return { valid: false, reason: 'invalid_enum' };
    }
  }

  if (!result.clusters.length) {
    return {
      valid: false,
      reason: 'empty_cluster_array'
    };
  }

  const requestedIds =
    articles.map(getArticleId);

  const requestedSet =
    new Set(requestedIds);

  const returnedIds = [];

  for (const cluster of result.clusters) {
    if (
      !cluster ||
      !Array.isArray(
        cluster.articleIds
      ) ||
      !cluster.articleIds.length
    ) {
      return {
        valid: false,
        reason: 'empty_cluster'
      };
    }

    returnedIds.push(
      ...cluster.articleIds
    );
  }

  if (
    returnedIds.length !==
    requestedIds.length
  ) {
    return {
      valid: false,
      reason: 'wrong_article_count'
    };
  }

  if (
    new Set(returnedIds).size !==
    returnedIds.length
  ) {
    return {
      valid: false,
      reason: 'duplicate_article_ids'
    };
  }

  if (
    returnedIds.some(
      id =>
        !requestedSet.has(id)
    )
  ) {
    return {
      valid: false,
      reason: 'unknown_article_ids'
    };
  }

  if (
    requestedIds.some(
      id =>
        !returnedIds.includes(id)
    )
  ) {
    return {
      valid: false,
      reason: 'missing_article_ids'
    };
  }

  return {
    valid: true,
    reason: null
  };
}

function pairEligibleForVerifiedCluster(
  left,
  right
) {
  const conflicts =
    detectEventConflicts(
      left,
      right
    );

  if (conflicts.hasHardConflict) {
    return false;
  }

  if (
    left._vec &&
    right._vec
  ) {
    const similarity =
      cosineSimilarity(
        left._vec,
        right._vec
      );

    const classification =
      classifyE5Match(
        left,
        right,
        similarity
      );

    if (
      classification.decision !==
      MatchDecision.REJECT
    ) {
      return true;
    }

    /*
     * This pair reached a verified cluster through the generic recovery
     * review path. Hard conflicts were checked above; allow the high-level
     * exact-event verifier to recover a deterministic false negative.
     */
    return isAiRecoveryReviewCandidate(
      left,
      right,
      similarity
    );
  }

  return (
    tokenOverlapCount(
      left.title,
      right.title
    ) >= 2 &&
    tokenSimilarity(
      left.title,
      right.title
    ) >= 0.30
  );
}

function postValidatePartition(
  result,
  articles
) {
  const articleById =
    new Map(
      articles.map(article => [
        getArticleId(article),
        article
      ])
    );

  for (const cluster of result.clusters) {
    const clusterArticles =
      cluster.articleIds.map(
        id => articleById.get(id)
      );

    if (
      clusterArticles.some(
        article => !article
      )
    ) {
      return false;
    }

    if (
      clusterArticles.length <= 1
    ) {
      continue;
    }

    for (
      let left = 0;
      left <
      clusterArticles.length;
      left++
    ) {
      for (
        let right = left + 1;
        right <
        clusterArticles.length;
        right++
      ) {
        const conflicts =
          detectEventConflicts(
            clusterArticles[left],
            clusterArticles[right]
          );

        if (
          conflicts.hasHardConflict
        ) {
          return false;
        }
      }
    }

    const visited =
      new Set([0]);

    const queue = [0];

    while (queue.length) {
      const current =
        queue.shift();

      for (
        let candidate = 0;
        candidate <
        clusterArticles.length;
        candidate++
      ) {
        if (
          visited.has(candidate)
        ) {
          continue;
        }

        if (
          pairEligibleForVerifiedCluster(
            clusterArticles[current],
            clusterArticles[candidate]
          )
        ) {
          visited.add(candidate);
          queue.push(candidate);
        }
      }
    }

    if (
      visited.size !==
      clusterArticles.length
    ) {
      return false;
    }
  }

  return true;
}

export { validateComponentReviewResult, expandComponentReviewDecision, parsePartitionResponse, validatePartitionResult, pairEligibleForVerifiedCluster, postValidatePartition };
