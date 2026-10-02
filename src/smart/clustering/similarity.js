import { detectArticleLanguage } from '../articles/language.js';
import { SMART_NEWS_CLUSTER_CONFIG, HOUR_MS } from '../config.js';
import { parsePublishedTimestamp } from '../dates/publication-time.js';
import { detectEventConflicts, getEventEvidence } from './event-evidence.js';

const MatchDecision = {
  AUTO_MERGE: 'auto_merge',
  REVIEW: 'review',
  REJECT: 'reject'
};

function cosineSimilarity(
  left,
  right
) {
  if (
    !left ||
    !right ||
    left.length !== right.length
  ) {
    return 0;
  }

  let dot = 0;

  for (
    let index = 0;
    index < left.length;
    index++
  ) {
    dot += left[index] * right[index];
  }

  return dot;
}

function getSmartDestinationPartition(article) {
  const category =
    String(
      article?.smartCategory ||
      article?.feedCategory ||
      ''
    ).toLowerCase().replace(/_(world|foreign)$/, '_global');

  if (category === 'news_vietnam') {
    return 'news_vietnam';
  }

  if (category === 'news_global') {
    return 'news_global';
  }

  if (category === 'finance_vietnam') {
    return 'finance_vietnam';
  }

  if (category === 'finance_global') {
    return 'finance_global';
  }

  if (
    category === 'tech_vietnam' ||
    category === 'tech_global'
  ) {
    return category;
  }

  if (category === 'tech') {
    const region =
      String(article?.region || '')
        .toLowerCase();

    if (region === 'vietnam') {
      return 'tech_vietnam';
    }

    if (
      region === 'foreign' ||
      region === 'world' ||
      region === 'global'
    ) {
      return 'tech_global';
    }

    const language =
      article?.language ||
      detectArticleLanguage(article);

    if (language === 'vi') {
      return 'tech_vietnam';
    }

    if (language === 'en') {
      return 'tech_global';
    }
  }

  return null;
}

function classifyE5Match(
  articleA,
  articleB,
  similarity
) {
  const languageA =
    articleA?.language ||
    detectArticleLanguage(
      articleA
    );

  const languageB =
    articleB?.language ||
    detectArticleLanguage(
      articleB
    );

  const crossLanguage =
    languageA !== 'unknown' &&
    languageB !== 'unknown' &&
    languageA !== languageB;

  if (crossLanguage) {
    return {
      decision:
        MatchDecision.REJECT,
      conflicts: null,
      evidence: {
        reason:
          'cross_language_partition_barrier'
      }
    };
  }

  const thresholds =
    crossLanguage
      ? SMART_NEWS_CLUSTER_CONFIG
        .thresholds
        .crossLanguage
      : SMART_NEWS_CLUSTER_CONFIG
        .thresholds
        .sameLanguage;

  if (
    similarity <
    thresholds.review
  ) {
    return {
      decision:
        MatchDecision.REJECT,
      conflicts: null,
      evidence: null
    };
  }

  const conflicts =
    detectEventConflicts(
      articleA,
      articleB
    );

  if (conflicts.hasHardConflict) {
    return {
      decision:
        MatchDecision.REJECT,
      conflicts,
      evidence: null
    };
  }

  const evidence =
    getEventEvidence(
      articleA,
      articleB
    );

  /*
   * Multilingual E5 is responsible for cross-language matching,
   * because translated headlines may share no literal tokens.
   *
   * Same-language pairs must also have concrete headline,
   * action or numeric evidence. This removes broad-topic pairs
   * that currently flood the REVIEW queue.
   */
  if (!crossLanguage) {
    const nearReviewBoundary =
      similarity <
      thresholds.review + 0.02;

    const insufficientEvidence =
      evidence.score < 2;

    const weakBoundaryEvidence =
      nearReviewBoundary &&
      evidence.score < 3;

    if (
      insufficientEvidence ||
      weakBoundaryEvidence
    ) {
      return {
        decision:
          MatchDecision.REJECT,
        conflicts,
        evidence
      };
    }
  }

  if (
    similarity >=
      thresholds.autoMerge &&
    !conflicts.hasSoftConflict
  ) {
    return {
      decision:
        MatchDecision.AUTO_MERGE,
      conflicts,
      evidence
    };
  }

  return {
    decision:
      MatchDecision.REVIEW,
    conflicts,
    evidence
  };
}

function isAiRecoveryReviewCandidate(
  articleA,
  articleB,
  similarity
) {
  if (
    !articleA ||
    !articleB ||
    !Number.isFinite(similarity)
  ) {
    return false;
  }

  const conflicts =
    detectEventConflicts(
      articleA,
      articleB
    );

  if (conflicts.hasHardConflict) {
    return false;
  }

  /*
   * Recovery is deliberately limited to a tight publication window.
   * Distinct later developments should become separate exact events or
   * RELATED_DEVELOPMENT rather than being pulled back into the first event.
   */
  const timestampA =
    parsePublishedTimestamp(
      articleA?.pubDate
    );

  const timestampB =
    parsePublishedTimestamp(
      articleB?.pubDate
    );

  if (
    Number.isFinite(timestampA) &&
    Number.isFinite(timestampB) &&
    Math.abs(timestampA - timestampB) >
      24 * HOUR_MS
  ) {
    return false;
  }

  const languageA =
    articleA?.language ||
    detectArticleLanguage(
      articleA
    );

  const languageB =
    articleB?.language ||
    detectArticleLanguage(
      articleB
    );

  const crossLanguage =
    languageA !== 'unknown' &&
    languageB !== 'unknown' &&
    languageA !== languageB;

  const thresholds =
    crossLanguage
      ? SMART_NEWS_CLUSTER_CONFIG
          .thresholds
          .crossLanguage
      : SMART_NEWS_CLUSTER_CONFIG
          .thresholds
          .sameLanguage;

  /*
   * Slightly wider than ordinary REVIEW, but still strongly semantic.
   * The AI verifier, not this function, makes the final merge decision.
   */
  const evidence =
    getEventEvidence(
      articleA,
      articleB
    );

  /*
   * The ordinary matcher remains strict.
   *
   * Recovery is only a request for AI review, so concrete event evidence
   * may compensate for weaker embedding similarity. This is intentionally
   * generic: it works for launches, rulings, recalls, shutdowns, earnings,
   * disasters, matches, policy decisions, acquisitions, etc.
   */
  let recoveryFloor;

  if (evidence.score >= 4) {
    recoveryFloor =
      Math.max(
        0.58,
        thresholds.review - 0.14
      );
  } else if (evidence.score >= 3) {
    recoveryFloor =
      Math.max(
        0.61,
        thresholds.review - 0.11
      );
  } else if (evidence.score >= 2) {
    recoveryFloor =
      Math.max(
        0.64,
        thresholds.review - 0.09
      );
  } else if (evidence.score >= 1) {
    recoveryFloor =
      Math.max(
        0.68,
        thresholds.review - 0.07
      );
  } else {
    recoveryFloor =
      Math.max(
        0.72,
        thresholds.review - 0.04
      );
  }

  if (
    similarity <
    recoveryFloor
  ) {
    return false;
  }

  /*
   * With concrete event evidence, let the exact-event verifier decide.
   * Without such evidence, require an unusually strong semantic match.
   */
  return (
    evidence.score >= 1 ||
    similarity >=
      thresholds.review + 0.03
  );

}

function pairKey(leftIndex, rightIndex) {
  return leftIndex < rightIndex
    ? `${leftIndex}|${rightIndex}`
    : `${rightIndex}|${leftIndex}`;
}

function isPairWithinComparisonScope(
  articleA,
  articleB,
  now = Date.now()
) {
  const destinationA =
    getSmartDestinationPartition(
      articleA
    );
  const destinationB =
    getSmartDestinationPartition(
      articleB
    );

  /*
   * Smart destinations are editorially independent. A pair from different
   * destinations must never reach the deterministic classifier or AI review.
   * Unknown destination membership is isolated rather than guessed.
   */
  if (
    !destinationA ||
    !destinationB ||
    destinationA !== destinationB
  ) {
    return false;
  }

  const timestampA =
    parsePublishedTimestamp(
      articleA?.pubDate
    );

  const timestampB =
    parsePublishedTimestamp(
      articleB?.pubDate
    );

  if (
    !Number.isFinite(timestampA) ||
    !Number.isFinite(timestampB)
  ) {
    return false;
  }

  const normalWindowMs =
    SMART_NEWS_CLUSTER_CONFIG
      .comparisonWindowHours *
    HOUR_MS;

  if (
    Math.abs(
      timestampA - timestampB
    ) <= normalWindowMs
  ) {
    return true;
  }

  if (
    articleA?._activeClusterId &&
    articleA._activeClusterId ===
    articleB?._activeClusterId
  ) {
    return true;
  }

  const recentCutoff =
    now - normalWindowMs;

  const activeA =
    Number.isFinite(
      articleA?._activeClusterLatestAt
    ) &&
    articleA._activeClusterLatestAt >=
    recentCutoff;

  const activeB =
    Number.isFinite(
      articleB?._activeClusterLatestAt
    ) &&
    articleB._activeClusterLatestAt >=
    recentCutoff;

  if (
    activeA &&
    timestampB >= recentCutoff
  ) {
    return true;
  }

  if (
    activeB &&
    timestampA >= recentCutoff
  ) {
    return true;
  }

  return false;
}

function chooseMedoid(
  indices,
  pairSimilarities,
  nodes
) {
  let bestIndex = indices[0];
  let bestScore = -1;

  for (const index of indices) {
    let score = 0;

    for (
      const otherIndex
      of indices
    ) {
      if (index === otherIndex) {
        continue;
      }

      score +=
        pairSimilarities.get(
          pairKey(
            index,
            otherIndex
          )
        ) || 0;
    }

    const candidateId =
      nodes[index].id;

    const bestId =
      nodes[bestIndex].id;

    if (
      score > bestScore ||
      (
        score === bestScore &&
        candidateId.localeCompare(
          bestId
        ) < 0
      )
    ) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export { MatchDecision, cosineSimilarity, getSmartDestinationPartition, classifyE5Match, isAiRecoveryReviewCandidate, pairKey, isPairWithinComparisonScope };
