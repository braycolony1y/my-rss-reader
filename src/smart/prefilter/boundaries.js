import { preparePersonalCandidates, personalFullyExcluded } from '../feedback/pipeline.js';
import { articleIdentity } from './identity.js';
import { rawAllowedDestinations } from '../../articles/top-story-destinations.js';
import { FILTER_VERSION, prefilterEnabled } from './policy.js';
import { FILTER_POLICY_REVISION } from './retired-reasons.js';
import { getPrefilterStore, evaluateCandidate, fullyExcluded, stampDecisions, terminalExcluded, decisionsFor } from './state.js';

export const prefilterConfiguration = () => prefilterEnabled() ? [FILTER_VERSION, FILTER_POLICY_REVISION] : [];
export async function preparePrefilterCandidates({ db, articles, sources, metrics }) {
  articles = await preparePersonalCandidates(db, articles, sources);
  if (!prefilterEnabled()) return articles;
  const store = await getPrefilterStore(db, metrics);
  const kept = [];
  for (const original of articles) {
    const article = { ...original };
    evaluateCandidate(store, article, rawAllowedDestinations(article, sources));
    if (!fullyExcluded(article)) kept.push(article);
    else {
      metrics.prefilterEmbeddingsAvoided = (metrics.prefilterEmbeddingsAvoided || 0) + 1;
      metrics.prefilterClusterInputsAvoided = (metrics.prefilterClusterInputsAvoided || 0) + 1;
    }
  }
  await store.persist();
  return kept;
}
export function survivingArticles(articles) {
  articles = articles.filter(article => !personalFullyExcluded(article));
  if (!prefilterEnabled()) return articles;
  return articles.filter(article => !fullyExcluded(article)).map(stampDecisions);
}
export function survivingGroups(groups) {
  return groups.map(group => ({ ...group, articles: survivingArticles(group.articles) })).filter(group => group.articles.length);
}
export function survivingClusters(clusters, rebuild) {
  return clusters.flatMap(cluster => {
    const original = [cluster, ...(cluster.relatedArticles || [])];
    const kept = survivingArticles(original);
    if (!kept.length) return [];
    if (kept.length === original.length) return [cluster];
    // Use the existing cluster builder; do not invent a new representative or score.
    const rebuilt = rebuild(kept, { validated: true, verification: cluster.verification });
    return rebuilt ? [{ ...rebuilt, clusterId: cluster.clusterId }] : [];
  });
}
export function eligibleClusterDestinations(cluster, destinations, sources) {
  if (!prefilterEnabled()) return destinations;
  const members = [cluster, ...(cluster.relatedArticles || [])];
  return destinations.filter(section => members.some(article => rawAllowedDestinations(article, sources || []).includes(section) && !terminalExcluded(article, section)));
}
export function aiSideCandidates(articles) {
  if (!prefilterEnabled()) return [];
  const seen = new Set();
  return articles.flatMap(article => {
    if (!article.smartTopPrefilterKey || fullyExcluded(article)) return [];
    return (article.smartTopPrefilterSections || []).flatMap(section => {
      const decision = decisionsFor(article)[section];
      if (!decision || decision.final || decision.aiChecked) return [];
      const key = `${article.smartTopPrefilterKey}:${section}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ id: article.smartTopPrefilterKey, section, title: article.title }];
    });
  });
}

export function pruneReviewGroup(group) {
  group.articles = survivingArticles(group.articles || []);
  if (group.reviewUniverse) group.reviewUniverse = survivingArticles(group.reviewUniverse);
  if (group.deferredComponents) group.deferredComponents = group.deferredComponents.map(survivingArticles).filter(items => items.length);
  return group;
}

export async function hydrateStoredClusters(db, clusters, sources) {
  if (!prefilterEnabled()) return clusters;
  const store = await getPrefilterStore(db);
  for (const cluster of clusters) {
    for (const article of [cluster, ...(cluster.relatedArticles || [])]) {
      // Binding only; no rule evaluation or reusable-title search at a later boundary.
      const identity = articleIdentity(article);
      const record = store.records.get(identity.key);
      if (!record) continue;
      article.smartTopPrefilterKey = identity.key;
      article.smartTopPrefilterSections = rawAllowedDestinations(article, sources);
      article.smartTopPrefilter = record.decisions;
    }
  }
  return clusters;
}
