import { rankStory, retainStoryIds } from '../../articles/story-ranking.js';
import { isInvestingComSource } from '../articles/categories.js';
import { stableId } from '../articles/identity.js';
import { isVietnameseArticle } from '../articles/language.js';
import { VALID_SMART_CATEGORIES, HOUR_MS } from '../config.js';
import { safeDate } from '../dates/publication-time.js';
import { canonicalSourceIdentity } from '../sources/identity.js';
import { dedupeGoogleNewsWrappers } from '../sources/wrappers.js';
import { titleTokens, tokenSimilarity, tokenOverlapCount } from '../text/normalize.js';
import { detectEventConflicts } from './event-evidence.js';
import { isGenuinelyRelated } from './relationships.js';
import { chooseRepresentative } from './representative.js';

function calculateHotness(articles) {
  return rankStory(articles).score;
}

function getHotnessLabel(cluster) {
  const sourceCount =
    Number(cluster.sourceCount || 1);

  const hotness =
    Number(cluster.hotness || 1);

  if (
    sourceCount >= 4 &&
    hotness >= 7.5
  ) {
    return 'Breaking';
  }

  if (
    sourceCount >= 6 &&
    hotness >= 6.5
  ) {
    return 'Widely reported';
  }

  if (hotness >= 5.5) {
    return 'Hot';
  }

  return '';
}

function buildCluster(
  articles,
  metadata = null
) {
  const validated =
    metadata?.validated === true;

  const clusterInput =
    validated
      ? (
        Array.isArray(articles)
          ? articles
          : []
      )
      : dedupeGoogleNewsWrappers(
        articles
      );

  const uniqueArticles = [];
  const links = new Set();

  for (
    const article
    of clusterInput
  ) {
    if (
      !article?.link ||
      links.has(article.link)
    ) {
      continue;
    }

    links.add(article.link);
    uniqueArticles.push(article);
  }

  if (!uniqueArticles.length) {
    return null;
  }

  uniqueArticles.sort(
    (left, right) =>
      safeDate(right.pubDate) -
      safeDate(left.pubDate)
  );

  const representative =
    chooseRepresentative(
      uniqueArticles
    );

  let finalArticles;

  if (validated) {
    finalArticles = [
      representative,
      ...uniqueArticles.filter(
        article =>
          article.link !==
          representative.link
      )
    ];
  } else {
    finalArticles = [
      representative,
      ...uniqueArticles.filter(
        article =>
          article.link !==
          representative.link &&
          isGenuinelyRelated(
            article,
            representative,
            false
          )
      )
    ];
  }

  let category =
    VALID_SMART_CATEGORIES.has(
      metadata?.category
    )
      ? metadata.category
      : representative.smartCategory;

  if (
    category === 'tech' &&
    isInvestingComSource(
      representative
    )
  ) {
    category =
      isVietnameseArticle(
        representative
      )
        ? 'finance_vietnam'
        : 'finance_global';
  }

  const sourceNames =
    [
      ...new Set(
        finalArticles
          .map(
            article =>
              article.feedTitle
          )
          .filter(Boolean)
      )
    ];

  const clusterId =
    stableId(
      finalArticles
        .map(
          article =>
            article.link
        )
        .sort()
        .join('|')
    );

  return {
    ...representative,

    title:
      representative.title,

    content:
      representative.content,

    smartCategory: category,
    feedCategory: category,

    isCluster: true,

    clusterId,

    clusterCount:
      finalArticles.length,

    sourceCount:
      new Set(finalArticles.map(canonicalSourceIdentity)).size,

    sources: sourceNames,

    hotness:
      calculateHotness(
        finalArticles
      ),

    aiClustered:
      metadata?.verification
        ?.method ===
      'ai_fallback' &&
      finalArticles.length > 1,

    verification:
      metadata?.verification,

    relatedArticles:
      finalArticles
        .filter(
          article =>
            article.link !==
            representative.link
        )
        .sort(
          (left, right) =>
            Number(
              right.sourceWeight ||
              1
            ) -
            Number(
              left.sourceWeight ||
              1
            ) ||
            safeDate(
              right.pubDate
            ) -
            safeDate(
              left.pubDate
            )
        )
        .map(article => ({
          title: article.title,
          link: article.link,
          pubDate: article.pubDate,
          publicationTimeReliable:
            article.publicationTimeReliable,
          feedTitle:
            article.feedTitle,
          feedIcon:
            article.feedIcon,
          feedUrl:
            article.feedUrl,
          image: article.image,
          sourceWeight:
            article.sourceWeight,
          region: article.region,
          language:
            article.language,
          domain: article.domain,
          smartCategory:
            article.smartCategory,
          feedCategory:
            article.feedCategory,
          content:
            String(
              article.content || ''
            ).slice(0, 900)
        }))
  };
}

function buildEarlySmartClusters(candidates, previous = []) {
  const byLink = new Map(candidates.map(a => [a.link, a]));
  const claimed = new Set();
  const groups = [];
  for (const old of previous) {
    const members = [old, ...(old.relatedArticles || [])].map(a => byLink.get(a.link)).filter(a => a && !claimed.has(a.link));
    if (members.length < 2) continue;
    const accepted = members.filter(a => a === members[0] || !detectEventConflicts(a, members[0]).hasHardConflict);
    groups.push(accepted);
    accepted.forEach(a => claimed.add(a.link));
  }
  const index = new Map();
  const keys = a => [...titleTokens(a.title)].sort((a,b) => b.length-a.length).slice(0, 5).map(t => `${a.smartCategory}:${t}`);
  const add = (a, id) => { for (const key of keys(a)) { if (!index.has(key)) index.set(key, new Set()); if (index.get(key).size < 80) index.get(key).add(id); } };
  groups.forEach((group,id) => group.forEach(a => add(a,id)));
  for (const article of candidates) {
    if (claimed.has(article.link)) continue;
    const possible = new Set(keys(article).flatMap(key => [...(index.get(key) || [])]));
    const match = [...possible].find(id => groups[id].length < 50 && groups[id].every(member =>
      Math.abs(safeDate(member.pubDate)-safeDate(article.pubDate)) <= 72 * HOUR_MS &&
      tokenSimilarity(member.title,article.title) >= 0.78 && tokenOverlapCount(member.title,article.title) >= 5 &&
      isGenuinelyRelated(article, member)));
    const id = match ?? groups.length;
    if (match === undefined) groups.push([]);
    groups[id].push(article); claimed.add(article.link); add(article,id);
  }
  return retainStoryIds(groups.map(group => buildCluster(group, {validated:true, verification:{method:'lexical_pending_embeddings',provisional:true}})).filter(Boolean), previous);
}

function cleanStoredCluster(cluster) {
  if (
    !cluster ||
    typeof cluster !== 'object'
  ) {
    return cluster;
  }

  if (
    !Array.isArray(
      cluster.relatedArticles
    ) ||
    !cluster.relatedArticles.length
  ) {
    return cluster;
  }

  const cleanRelated =
    cluster.relatedArticles.filter(
      related => {
        if (
          !related?.link ||
          related.link ===
          cluster.link
        ) {
          return false;
        }

        // Verification records describe how the cluster was accepted, but a
        // newer deterministic hard-conflict rule must still be able to repair
        // an already-saved cluster immediately after deployment.
        if (
          detectEventConflicts(
            related,
            cluster
          ).hasHardConflict
        ) {
          return false;
        }

        if (cluster.verification) {
          return true;
        }

        return isGenuinelyRelated(
          related,
          cluster,
          Boolean(
            cluster.aiClustered
          )
        );
      }
    );

  if (
    cleanRelated.length ===
    cluster.relatedArticles.length
  ) {
    return cluster;
  }

  const sources =
    [
      ...new Set(
        [
          cluster.feedTitle,
          ...cleanRelated.map(
            article =>
              article.feedTitle
          )
        ].filter(Boolean)
      )
    ];

  return {
    ...cluster,
    relatedArticles:
      cleanRelated,
    clusterCount:
      cleanRelated.length + 1,
    sourceCount:
      sources.length,
    sources
  };
}

export { calculateHotness, getHotnessLabel, buildCluster, buildEarlySmartClusters, cleanStoredCluster };
