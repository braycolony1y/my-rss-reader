import { getArticleId, stableId } from '../articles/identity.js';
import { safeDate } from '../dates/publication-time.js';
import { canonicalSourceIdentity } from '../sources/identity.js';
import { tokenSimilarity, tokenOverlapCount } from '../text/normalize.js';
import { detectEventConflicts } from './event-evidence.js';
import { cosineSimilarity } from './similarity.js';

function isGenuinelyRelated(
  article,
  representative,
  isValidatedCluster = false
) {
  if (
    !article ||
    !representative
  ) {
    return false;
  }

  if (
    article.link &&
    article.link ===
    representative.link
  ) {
    return false;
  }

  const conflicts =
    detectEventConflicts(
      article,
      representative
    );

  if (conflicts.hasHardConflict) {
    return false;
  }

  const vectorSimilarity =
    article._vec &&
      representative._vec
      ? cosineSimilarity(
        article._vec,
        representative._vec
      )
      : null;

  const lexicalScore =
    tokenSimilarity(
      article.title,
      representative.title
    );

  const overlap =
    tokenOverlapCount(
      article.title,
      representative.title
    );

  const sameSource =
    canonicalSourceIdentity(article) ===
    canonicalSourceIdentity(
      representative
    );

  if (isValidatedCluster) {
    if (vectorSimilarity !== null) {
      return (
        vectorSimilarity >= 0.82
      );
    }

    return (
      overlap >= 2 &&
      lexicalScore >= 0.30
    );
  }

  if (sameSource) {
    if (vectorSimilarity !== null) {
      return (
        vectorSimilarity >= 0.92 &&
        overlap >= 4 &&
        lexicalScore >= 0.35
      );
    }

    return (
      overlap >= 4 &&
      lexicalScore >= 0.48
    );
  }

  if (vectorSimilarity !== null) {
    if (
      vectorSimilarity >= 0.93 &&
      (
        overlap >= 2 ||
        lexicalScore >= 0.20
      )
    ) {
      return true;
    }

    if (
      vectorSimilarity >= 0.89 &&
      overlap >= 3 &&
      lexicalScore >= 0.26
    ) {
      return true;
    }

    if (
      vectorSimilarity >= 0.85 &&
      overlap >= 4 &&
      lexicalScore >= 0.34
    ) {
      return true;
    }

    return false;
  }

  return (
    overlap >= 4 &&
    lexicalScore >= 0.34
  );
}

function attachBroaderStoryMetadata(clusters, relationships = []) {
  if (!Array.isArray(clusters) || !clusters.length || !Array.isArray(relationships) || !relationships.length) {
    return clusters;
  }

  const copies = clusters.map(cluster => ({ ...cluster }));
  const clusterById = new Map(copies.map(cluster => [cluster.clusterId, cluster]));
  const clusterIdByArticleId = new Map();

  for (const cluster of copies) {
    for (const article of [cluster, ...(cluster.relatedArticles || [])]) {
      const articleId = getArticleId(article);
      if (articleId) clusterIdByArticleId.set(articleId, cluster.clusterId);
    }
  }

  const adjacency = new Map(copies.map(cluster => [cluster.clusterId, new Set()]));
  const edges = [];
  const edgeKeys = new Set();

  for (const relationship of relationships) {
    if (relationship?.type !== 'related_development') continue;
    const leftClusterId = (relationship.leftArticleIds || [])
      .map(articleId => clusterIdByArticleId.get(articleId))
      .find(Boolean);
    const rightClusterId = (relationship.rightArticleIds || [])
      .map(articleId => clusterIdByArticleId.get(articleId))
      .find(Boolean);
    if (!leftClusterId || !rightClusterId || leftClusterId === rightClusterId) continue;

    const leftCluster = clusterById.get(leftClusterId);
    const rightCluster = clusterById.get(rightClusterId);
    if (!leftCluster || !rightCluster) continue;
    if (
      leftCluster.smartCategory &&
      rightCluster.smartCategory &&
      leftCluster.smartCategory !== rightCluster.smartCategory
    ) {
      continue;
    }

    const key = [leftClusterId, rightClusterId].sort().join('|');
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    adjacency.get(leftClusterId)?.add(rightClusterId);
    adjacency.get(rightClusterId)?.add(leftClusterId);
    edges.push({
      leftClusterId,
      rightClusterId,
      confidence: Number(relationship.confidence) || null,
      providerId: relationship.providerId || null,
      model: relationship.model || null,
      reviewGroupId: relationship.reviewGroupId || null,
      verifiedAt: relationship.verifiedAt || null
    });
  }

  const visited = new Set();
  for (const cluster of copies) {
    if (visited.has(cluster.clusterId) || !adjacency.get(cluster.clusterId)?.size) continue;
    const queue = [cluster.clusterId];
    const storyClusterIds = [];
    visited.add(cluster.clusterId);

    while (queue.length) {
      const current = queue.shift();
      storyClusterIds.push(current);
      for (const neighbor of adjacency.get(current) || []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    if (storyClusterIds.length < 2) continue;
    const storyId = `story_${stableId([...storyClusterIds].sort().join('|'))}`;
    const storyEdges = edges.filter(edge =>
      storyClusterIds.includes(edge.leftClusterId) &&
      storyClusterIds.includes(edge.rightClusterId)
    );
    const events = storyClusterIds
      .map(clusterId => clusterById.get(clusterId))
      .filter(Boolean)
      .map(eventCluster => ({
        clusterId: eventCluster.clusterId,
        title: eventCluster.title,
        date: eventCluster.pubDate,
        sourceCount: eventCluster.sourceCount,
        sources: [eventCluster, ...(eventCluster.relatedArticles || [])]
          .filter(article => article?.link)
          .map(article => ({ link: article.link, name: article.feedTitle }))
          .filter((source, index, array) =>
            array.findIndex(other => other.link === source.link) === index
          )
          .slice(0, 8)
      }))
      .sort((left, right) => safeDate(left.date) - safeDate(right.date));

    for (const clusterId of storyClusterIds) {
      const eventCluster = clusterById.get(clusterId);
      if (!eventCluster) continue;
      eventCluster.broaderStory = {
        id: storyId,
        relationship: 'related_development',
        events,
        edges: storyEdges
      };
    }
  }

  return copies;
}

function mergeRelatedDevelopmentRelationships(
  storedRelationships = [],
  reviewRelationships = []
) {
  const relationshipKey = relationship => {
    const left = [...(relationship.leftArticleIds || [])]
      .sort()
      .join('|');
    const right = [...(relationship.rightArticleIds || [])]
      .sort()
      .join('|');
    return [left, right].sort().join('::');
  };

  const relationships = new Map();
  for (const relationship of [
    ...storedRelationships,
    ...reviewRelationships
  ]) {
    if (relationship?.type === 'related_development') {
      relationships.set(
        relationshipKey(relationship),
        relationship
      );
    }
  }

  return [...relationships.values()];
}

export { isGenuinelyRelated, attachBroaderStoryMetadata, mergeRelatedDevelopmentRelationships };
