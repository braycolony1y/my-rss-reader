// Deterministic resolver for ambiguous cluster pairs (replaces the old LLM verification chain).
//
// The HNSW stage leaves "review" groups: article sets whose cosine similarity sits in the review
// band but below auto-merge. Every group already arrives split into deterministic components
// (group.deferredComponents, the established or auto-merged clusters). The resolver decides, per
// pair of components, whether to merge them. It merges ONLY on strong shared evidence and
// otherwise keeps them separate (the same safe fallback the pipeline always had):
//
//   gate    same language, both timestamps known and within `maxHours`, no hard event conflict,
//           cosine >= review threshold + `cosineMargin` (a vector must exist; no vector, no merge)
//   points  shared named entities (0-2), shared number or money amount (1-2: money and percent
//           count double), shared place (1), publication within `closeHours` (1)
//   merge   points >= `minPoints`, at least one entity point, and at least one number or place point
//
// Merges are agglomerative (strongest link first). A merge is refused when any sampled cross pair
// has a hard conflict, the cluster would exceed `maxClusterArticles`, or the merged set fails the
// structural validation that the publication step applies anyway.
import { getArticleId, createGroupId } from '../articles/identity.js';
import { detectArticleLanguage } from '../articles/language.js';
import { SMART_NEWS_CLUSTER_CONFIG, HOUR_MS } from '../config.js';
import { parsePublishedTimestamp } from '../dates/publication-time.js';
import { detectEventConflicts } from './event-evidence.js';
import { postValidatePartition } from './partition-validation.js';
import { deferredReviewPartitions } from './review-groups.js';
import { extractEvidence, BROAD_PLACES } from './resolver-evidence.js';
import { cosineSimilarity } from './similarity.js';

export const RESOLVER_CONFIG = Object.freeze({
  cosineMargin: 0.02,
  maxHours: 36,
  closeHours: 6,
  minPoints: 4,
  maxClusterArticles: 30,
  sampleArticles: 4
});

const evidenceCache = new WeakMap();
const evidenceOf = article => {
  let evidence = evidenceCache.get(article);
  if (!evidence) { evidence = extractEvidence(article); evidenceCache.set(article, evidence); }
  return evidence;
};
const intersection = (left, right) => [...left].filter(value => right.has(value));

/**
 * Evidence points for one pair of articles. Pure and synchronous; the vectors are injected.
 * @returns {{ merge:boolean, reason:string, points:number, cosine:number, entityPoints:number,
 *             numberPoints:number, placePoints:number, timePoints:number }}
 */
export function scorePair(left, right, { vectorOf = article => article._vec, config = RESOLVER_CONFIG } = {}) {
  const reject = (reason, extra = {}) => ({ merge: false, reason, points: 0, cosine: 0, entityPoints: 0, numberPoints: 0, placePoints: 0, timePoints: 0, ...extra });
  const languageLeft = left.language || detectArticleLanguage(left);
  const languageRight = right.language || detectArticleLanguage(right);
  if (languageLeft !== 'unknown' && languageRight !== 'unknown' && languageLeft !== languageRight) return reject('cross_language');

  const leftAt = parsePublishedTimestamp(left.pubDate), rightAt = parsePublishedTimestamp(right.pubDate);
  if (!Number.isFinite(leftAt) || !Number.isFinite(rightAt)) return reject('unknown_time');
  const hours = Math.abs(leftAt - rightAt) / HOUR_MS;
  if (hours > config.maxHours) return reject('too_far_apart_in_time');
  if (detectEventConflicts(left, right).hasHardConflict) return reject('event_conflict');

  const vectorLeft = vectorOf(left), vectorRight = vectorOf(right);
  if (!vectorLeft || !vectorRight) return reject('no_vector');
  const cosine = cosineSimilarity(vectorLeft, vectorRight);
  if (cosine < SMART_NEWS_CLUSTER_CONFIG.thresholds.sameLanguage.review + config.cosineMargin) return reject('below_review_band', { cosine });

  const a = evidenceOf(left), b = evidenceOf(right);
  const phrases = intersection(a.phrases, b.phrases);
  const units = new Set([...phrases, ...intersection(a.acronyms, b.acronyms)]);
  const inPhrase = new Set(phrases.flatMap(phrase => phrase.split(' ')));
  const singles = intersection(a.tokens, b.tokens).filter(token => !inPhrase.has(token));
  const entityPoints = units.size >= 2 ? 2 : units.size === 1 ? (singles.length >= 1 ? 2 : 1) : (singles.length >= 2 ? 1 : 0);

  const sharedNumbers = intersection(new Set(a.numbers.keys()), new Set(b.numbers.keys()));
  const numberPoints = sharedNumbers.length ? (sharedNumbers.some(key => a.numbers.get(key) !== 'plain') ? 2 : 1) : 0;
  const placePoints = intersection(a.places, b.places).some(place => !BROAD_PLACES.has(place)) ? 1 : 0;
  const timePoints = hours <= config.closeHours ? 1 : 0;

  const points = entityPoints + numberPoints + placePoints + timePoints;
  const merge = points >= config.minPoints && entityPoints >= 1 && numberPoints + placePoints >= 1;
  return { merge, reason: merge ? 'strong_shared_evidence' : 'insufficient_evidence', points, cosine, entityPoints, numberPoints, placePoints, timePoints };
}

function sampleOf(articles, size) {
  return [...articles]
    .sort((x, y) => (parsePublishedTimestamp(y.pubDate) || 0) - (parsePublishedTimestamp(x.pubDate) || 0) || getArticleId(x).localeCompare(getArticleId(y)))
    .slice(0, size);
}

/**
 * Partition one review group. Components that share strong evidence are merged.
 * @returns {{ partitions:object[], merges:object[], componentCount:number }}
 *   partitions: resolved groups in the same shape the publication step has always consumed.
 */
export function resolveReviewGroup(group, { vectorOf, config = RESOLVER_CONFIG } = {}) {
  const components = deferredReviewPartitions(group, 'resolver').map(partition => partition.articles);
  const samples = components.map(articles => sampleOf(articles, config.sampleArticles));

  const links = [];
  for (let i = 0; i < components.length; i++) {
    for (let j = i + 1; j < components.length; j++) {
      let best = null;
      for (const left of samples[i]) {
        for (const right of samples[j]) {
          const score = scorePair(left, right, { vectorOf, config });
          if (score.merge && (!best || score.points > best.points || (score.points === best.points && score.cosine > best.cosine))) best = score;
        }
      }
      if (best) links.push({ i, j, ...best });
    }
  }
  links.sort((x, y) => y.points - x.points || y.cosine - x.cosine || x.i - y.i || x.j - y.j);

  const owner = components.map((_, index) => index);       // component -> cluster id
  const members = new Map(components.map((_, index) => [index, [index]]));
  const merges = [];
  for (const link of links) {
    const ci = owner[link.i], cj = owner[link.j];
    if (ci === cj) continue;
    const left = members.get(ci), right = members.get(cj);
    const articles = [...left, ...right].flatMap(index => components[index]);
    if (articles.length > config.maxClusterArticles) continue;
    // Every sampled cross pair must be free of hard conflicts, not just the linking pair.
    const conflicted = left.some(x => right.some(y => samples[x].some(a => samples[y].some(b => detectEventConflicts(a, b).hasHardConflict))));
    if (conflicted) continue;
    if (!postValidatePartition({ clusters: [{ articleIds: articles.map(getArticleId) }] }, articles)) continue;
    for (const index of right) owner[index] = ci;
    members.set(ci, [...left, ...right]);
    members.delete(cj);
    merges.push({ componentIds: [link.i, link.j], points: link.points, cosine: Number(link.cosine.toFixed(4)), reason: link.reason,
      entityPoints: link.entityPoints, numberPoints: link.numberPoints, placePoints: link.placePoints, timePoints: link.timePoints });
  }

  const partitions = [];
  for (const indexes of members.values()) {
    const articles = indexes.flatMap(index => components[index]);
    const merged = indexes.length > 1;
    // A group that is not a full repartition only needs its changes: untouched components stay as published.
    if (!merged && !group.fullRepartition) continue;
    partitions.push({
      reviewRequestId: group.id,
      id: createGroupId(articles),
      articles,
      verified: merged,
      verification: merged
        ? { method: 'deterministic_resolver', reason: 'strong_shared_evidence' }
        : { method: articles.length > 1 ? 'deterministic_components' : 'kept_separate', reason: 'insufficient_evidence' }
    });
  }
  return { partitions, merges, componentCount: components.length };
}

/** Resolve every review group. Same result shape the publication stage reads. */
export function resolveAmbiguousGroups(groups, options = {}) {
  const statistics = {
    ambiguousGroupsTotal: groups.length,
    ambiguousGroupsMerged: 0,
    ambiguousGroupsKeptSeparate: 0,
    mergedComponentPairs: 0,
    reviewedArticleCount: 0,
    storyRelationships: [],
    groupResults: []
  };
  const clusters = [];
  for (const group of groups) {
    if (!group?.articles?.length) continue;
    const { partitions, merges, componentCount } = resolveReviewGroup(group, options);
    clusters.push(...partitions);
    statistics.reviewedArticleCount += group.articles.length;
    statistics.mergedComponentPairs += merges.length;
    if (merges.length) statistics.ambiguousGroupsMerged++; else statistics.ambiguousGroupsKeptSeparate++;
    statistics.groupResults.push({ groupId: group.id, articleCount: group.articles.length, componentCount, merges });
  }
  return { clusters, ...statistics };
}
