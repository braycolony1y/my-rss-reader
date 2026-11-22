import { getArticleId } from '../articles/identity.js';
import { detectEventConflicts } from './event-evidence.js';
import { cosineSimilarity, classifyE5Match, MatchDecision, isAiRecoveryReviewCandidate } from './similarity.js';
import { tokenOverlapCount, tokenSimilarity } from '../text/normalize.js';

// Structural checks applied to any proposed multi-article cluster: no hard event
// conflict between members and every member reachable through eligible pairs.

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

export { pairEligibleForVerifiedCluster, postValidatePartition };
