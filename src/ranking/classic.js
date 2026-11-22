// Adapter between the Classic Smart view (clusters of stored articles) and the pure ranker.
import { publisherId, storyMembers, storyText } from '../articles/story-ranking.js';
import { canonicalSmartCategory } from '../utils/smart-destinations.js';
import { FEEDS } from './features.js';
import { LABEL_THRESHOLDS } from './config.js';
import { scoreStories } from './score.js';

const HOUR = 3600000;
const headlineKey = a => storyText(a.title || a.link).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Section id (one of FEEDS) of a story; `destination` is the requested section when known. */
export function sectionOf(article, destination = '') {
  if (FEEDS.includes(destination)) return destination;
  const category = canonicalSmartCategory(article.smartCategory);
  if (FEEDS.includes(category)) return category;
  const region = article.region === 'vietnam' || /^vi(?:-|$)/i.test(String(article.language || '')) ? 'vietnam' : 'global';
  return ['news', 'finance', 'tech'].includes(category) ? `${category}_${region}` : `news_${region}`;
}

/** Ranker input for one story. Reprints of one headline never renew the story's freshness (as in rankStory). */
export function toRankingCluster(article, destination, vectorOf = () => null) {
  const members = storyMembers(article);
  const earliest = new Map();
  const mapped = members.map(a => {
    const t = a.publicationTimeReliable === false ? 0 : Date.parse(a.pubDate) || 0;
    const key = headlineKey(a);
    if (!earliest.has(key) || t < earliest.get(key)) earliest.set(key, t);
    return { title: a.title || '', content: a.content || a.description || a.summary || '', domain: publisherId(a), sw: Number(a.sourceWeight) || 1, t, vec: vectorOf(a) };
  });
  const latestT = Math.max(0, ...earliest.values());
  return { id: article.clusterId || article.link, feed: sectionOf(article, destination), latestT, members: mapped };
}

/** Display scale 1..10 kept from the legacy hotness so the card and saved clients are unchanged. */
export const displayHotness = score => Math.round(Math.max(1, Math.min(10, 10 * score)) * 10) / 10;

/**
 * Label for a ranked story: Breaking (tier 2 floor story, whatever its score, or a
 * fresh story at the top ~2-3% of scores), Hot (tier 1 floor story or top ~8-10% of scores; see LABEL_THRESHOLDS), Widely reported (many outlets, solid score), else ''.
 */
export function hotnessLabel({ tier = 0, hot = false, hotness = 1, sourceCount = 1, fresh = 0 } = {}) {
  if (tier >= 2) return 'Breaking';
  if (fresh >= LABEL_THRESHOLDS.breakingMinFresh && hotness >= LABEL_THRESHOLDS.breaking) return 'Breaking';
  if (tier >= 1 || hot || hotness >= LABEL_THRESHOLDS.hot) return 'Hot';
  if (sourceCount >= 6 && hotness >= 5) return 'Widely reported';
  return '';
}

/**
 * Rank the stories of a Classic view with the deterministic ranker.
 * @param {object[]} articles stories (cluster head article + relatedArticles)
 * @param {object} [options] { destination, now, vectorOf(article)->Float32Array|null, history }
 * @returns stories sorted best first, each with ranking, hotness, hotnessLabel and sourceCount
 */
export function rankClassicStories(articles, { destination = '', now = Date.now(), vectorOf = () => null, scorer = scoreStories } = {}) {
  const clusters = articles.map(a => toRankingCluster(a, destination, vectorOf));
  const { ranked } = scorer(clusters, { now });
  const byId = new Map(articles.map((a, i) => [clusters[i].id, { article: a, cluster: clusters[i] }]));
  const out = [];
  for (const r of ranked) {
    const { article, cluster } = byId.get(r.id);
    const members = storyMembers(article);
    const hotness = displayHotness(r.score);
    const sourceCount = new Set(members.map(publisherId)).size;
    const updatedAt = new Date(Math.max(0, ...members.map(a => Date.parse(a.pubDate) || 0))).toISOString();
    const ranking = { score: hotness, model: 'nonai-ranker-v1', independentSources: sourceCount, distinctOutlets: r.outlets, updatedAt, tier: r.tier, hot: r.hot, hotOutlets: r.hotOutlets, routine: r.routine,
      signals: { pElig: r.pElig, pTop: r.pTop, qHat: r.qHat, freshness: r.fresh, e5: cluster.members.some(m => m.vec) } };
    out.push({ ...article, ranking, hotness, sourceCount, hotnessLabel: hotnessLabel({ tier: r.tier, hotness, sourceCount, fresh: r.fresh }) });
  }
  return out;
}
