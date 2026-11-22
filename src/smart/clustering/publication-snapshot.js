import { survivingArticles, survivingGroups, survivingClusters } from '../prefilter/boundaries.js';
import { retainStoryIds } from '../../articles/story-ranking.js';
import { getArticleId, stableId } from '../articles/identity.js';
import { detectArticleLanguage } from '../articles/language.js';
import { DAY_MS, HOUR_MS } from '../config.js';
import { parsePublishedTimestamp, safeDate } from '../dates/publication-time.js';
import { hostFromUrl } from '../sources/identity.js';
import { buildCluster, cleanStoredCluster } from './cluster.js';
import { attachBroaderStoryMetadata } from './relationships.js';
import { integrateIncrementalReviews } from './review-groups.js';

function assertEveryCandidateAppearsExactlyOnce(
  candidates,
  rawGroups
) {
  const expectedIds =
    new Set(
      candidates.map(
        getArticleId
      )
    );

  const seenIds = new Set();

  for (const group of rawGroups) {
    if (
      !group ||
      !Array.isArray(
        group.articles
      ) ||
      !group.articles.length
    ) {
      throw new Error(
        'Invariant failed: empty raw group'
      );
    }

    for (
      const article
      of group.articles
    ) {
      const id =
        getArticleId(article);

      if (!expectedIds.has(id)) {
        throw new Error(
          `Invariant failed: unexpected article ${id}`
        );
      }

      if (seenIds.has(id)) {
        throw new Error(
          `Invariant failed: duplicate article ${id}`
        );
      }

      seenIds.add(id);
    }
  }

  const missing =
    [...expectedIds].filter(
      id => !seenIds.has(id)
    );

  if (missing.length) {
    throw new Error(
      `Invariant failed: missing ${missing.length} article(s): ${missing.slice(0, 5).join(', ')}`
    );
  }
}

function getClusterArticleLinks(cluster) {
  return new Set(
    [
      cluster?.link,
      ...(Array.isArray(
        cluster?.relatedArticles
      )
        ? cluster.relatedArticles.map(
          article =>
            article.link
        )
        : [])
    ].filter(Boolean)
  );
}

function getLatestClusterCoverageTime(cluster) {
  const times = [
    cluster?.pubDate,
    ...(Array.isArray(cluster?.relatedArticles)
      ? cluster.relatedArticles.map(
        article => article.pubDate
      )
      : [])
  ]
    .map(parsePublishedTimestamp)
    .filter(Number.isFinite);

  return times.length
    ? Math.max(...times)
    : NaN;
}

function buildPublicationClusterSnapshot({
  candidates,
  autoMergedClusters,
  reviewedClusters,
  reviewGroups,
  clusterVersionChanged,
  existingClusters,
  isTargeted,
  targetCategory,
  storyIdRetentionClusters,
  storyRelationships = []
}) {
  const rawGroups = survivingGroups(integrateIncrementalReviews(
    autoMergedClusters,
    reviewedClusters,
    reviewGroups
  ));
  candidates = survivingArticles(candidates);
  existingClusters = survivingClusters(existingClusters, buildCluster);

  assertEveryCandidateAppearsExactlyOnce(
    candidates,
    rawGroups
  );

  const newClusters = rawGroups
    .map(group =>
      buildCluster(
        group.articles,
        {
          validated: true,
          verification: group.verification
        }
      )
    )
    .filter(Boolean);

  const currentLinks = new Set(
    candidates.map(article => article.link)
  );
  const sevenDaysAgo = Date.now() - 7 * DAY_MS;

  const untouchedOldClusters = clusterVersionChanged
    ? []
    : existingClusters
      .filter(cluster => {
        const links = getClusterArticleLinks(cluster);

        // Candidate identity wins before targeted-category preservation.
        if ([...links].some(link => currentLinks.has(link))) {
          return false;
        }

        if (
          isTargeted &&
          targetCategory &&
          cluster.smartCategory !== targetCategory
        ) {
          return true;
        }

        const latestCoverageAt =
          getLatestClusterCoverageTime(cluster);
        return (
          Number.isFinite(latestCoverageAt) &&
          latestCoverageAt >= sevenDaysAgo
        );
      })
      // This repair pass is for retained historical clusters. Newly built
      // groups have already passed the current membership invariant.
      .map(cleanStoredCluster)
      .filter(Boolean);

  let clusters = [
    ...untouchedOldClusters,
    ...newClusters
  ];

  clusters.sort(
    (left, right) =>
      Number(right.hotness || 0) -
        Number(left.hotness || 0) ||
      Number(right.sourceWeight || 1) -
        Number(left.sourceWeight || 1) ||
      safeDate(right.pubDate) -
        safeDate(left.pubDate)
  );

  clusters = retainStoryIds(
    clusters,
    storyIdRetentionClusters
  );

  const activeRelationshipArticleIds = new Set(
    clusters.flatMap(cluster =>
      [cluster, ...(cluster.relatedArticles || [])]
        .map(getArticleId)
    )
  );

  const activeRelationships = storyRelationships.filter(
    relationship =>
      (relationship.leftArticleIds || []).some(
        articleId => activeRelationshipArticleIds.has(articleId)
      ) &&
      (relationship.rightArticleIds || []).some(
        articleId => activeRelationshipArticleIds.has(articleId)
      )
  );

  clusters = attachBroaderStoryMetadata(
    clusters,
    activeRelationships
  );

  for (const cluster of clusters) {
    if (cluster) delete cluster._vec;
    if (Array.isArray(cluster?.relatedArticles)) {
      for (const article of cluster.relatedArticles) {
        delete article._vec;
      }
    }
  }

  const publishedCounts = new Map();
  for (const cluster of clusters) {
    for (const article of [
      cluster,
      ...(cluster.relatedArticles || [])
    ]) {
      const id = getArticleId(article);
      publishedCounts.set(
        id,
        (publishedCounts.get(id) || 0) + 1
      );
    }
  }

  if (
    candidates.some(
      article =>
        publishedCounts.get(getArticleId(article)) !== 1
    ) ||
    [...publishedCounts.values()].some(count => count !== 1)
  ) {
    throw new Error(
      'Final clustering snapshot failed membership validation; previous state retained.'
    );
  }

  return {
    clusters,
    currentLinks,
    storyRelationships: activeRelationships
  };
}

function isActiveCluster(cluster, now = Date.now()) {
  const latestCoverageAt =
    getLatestClusterCoverageTime(cluster);

  if (!Number.isFinite(latestCoverageAt)) {
    return false;
  }

  return (
    now - latestCoverageAt <=
    72 * HOUR_MS
  );
}

function extractActiveClusterArticles(
  cluster
) {
  const latest =
    getLatestClusterCoverageTime(
      cluster
    );

  const clusterId =
    cluster.clusterId ||
    stableId(
      [...getClusterArticleLinks(cluster)]
        .sort()
        .join('|')
    );

  const representative = {
    ...cluster,
    isCluster: false,
    relatedArticles: undefined,
    _activeClusterId:
      clusterId,
    _activeClusterLatestAt:
      latest
  };

  const related =
    Array.isArray(
      cluster.relatedArticles
    )
      ? cluster.relatedArticles.map(
        article => ({
          ...article,
          smartCategory:
            article.smartCategory ||
            cluster.smartCategory,
          feedCategory:
            article.feedCategory ||
            cluster.feedCategory,
          domain:
            article.domain ||
            hostFromUrl(
              article.link
            ),
          sourceWeight:
            article.sourceWeight ||
            cluster.sourceWeight ||
            1,
          language:
            article.language ||
            detectArticleLanguage(
              article
            ),
          content:
            article.content || '',
          _activeClusterId:
            clusterId,
          _activeClusterLatestAt:
            latest
        })
      )
      : [];

  return [
    representative,
    ...related
  ].filter(
    article => article.link
  );
}

export { buildPublicationClusterSnapshot, isActiveCluster, extractActiveClusterArticles };
