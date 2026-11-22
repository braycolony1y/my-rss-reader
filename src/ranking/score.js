// Deterministic story ranker. No generative AI, no network, no I/O: it combines
//   - rules and lexicons (EN + VI) over headlines and leads,
//   - stored source weights,
//   - corroboration and velocity of independent outlets,
//   - existing multilingual-e5-small vectors compared with two frozen section centroids,
// through three small linear heads (see model.json), then applies the routine damper and the
// graded hot-news floor.
//
//   score = ( mix*pTop + (1-mix) * pElig * min(1, qHat/relTop) ) * (0.45 + 0.55 * exp(-ageHours/48))
import { FEEDS, HOURS, coverage, dot, feedOneHot, noveltyFeatures, staticFeatures, timeFeatures } from './features.js';
import { HOT_FLOOR } from './config.js';
import { applyHotFloor, hotProfile, hotTier } from './hot-floor.js';
import { loadModel } from './model.js';
import { detectRoutine } from './routine.js';

const sigmoid = z => 1 / (1 + Math.exp(-z));
/** Features that need an e5 vector; they are neutral (z = 0) for a cluster without one. */
const E5_FEATURES = new Set(['tight', 'hasvec', 'nov_sim', 'n_dups', 'sim_top', 'sim_excl', 'sim_diff', 'sim_top_all', 'sim_excl_all']);

function centroidSims(vec, centroids, feed) {
  if (!vec || !centroids) return null;
  const section = centroids[feed] || centroids.all, all = centroids.all;
  const sim_top = dot(vec, section.top), sim_excl = dot(vec, section.excl);
  return { sim_top, sim_excl, sim_diff: sim_top - sim_excl, sim_top_all: dot(vec, all.top), sim_excl_all: dot(vec, all.excl) };
}

/**
 * Score story clusters. Each carries its own `feed`, so one call may span all sections.
 * @param {object[]} clusters { id, feed, latestT?, members:[{title, content?, domain, sw?, t, vec?}] }
 * @param {object} [opts]
 * @param {number} [opts.now]       ms epoch (default Date.now())
 * @param {object[]} [opts.history] older clusters of the same shape, used only for the 48 h novelty feature
 * @param {object} [opts.model]     defaults to the shipped model
 * @param {object|null} [opts.centroids] override the model's centroids (null = no e5 centroid features)
 * @param {object} [opts.hotFloor]  override HOT_FLOOR; pass { minOutlets: Infinity } to disable
 * @param {boolean} [opts.dedupeCorroboration] default true: syndicated and same-publisher outlets count once in the corroboration features; false = raw outlet count
 * @param {number|null} [opts.damper] override the routine damper strength (0 disables)
 * @returns {{ranked:object[], byId:Map<string,object>}} ranked: per section, floor applied, sorted; each item
 *   { id, feed, score, pElig, pTop, qHat, fresh, tier (0/1/2), hot (tier > 0), hotOutlets (distinct outlets in the best window),
 *   outlets (distinct outlets in all), routine:string[], damp }
 */
export function scoreStories(clusters, opts = {}) {
  const now = opts.now ?? Date.now(), model = opts.model ?? loadModel();
  const centroids = opts.centroids === undefined ? model.centroids : opts.centroids;
  const floorCfg = { ...HOT_FLOOR, ...(opts.hotFloor || {}) };
  // An explicit minOutlets override applies to every section.
  if (opts.hotFloor?.minOutlets !== undefined && !opts.hotFloor.sectionOverrides) floorCfg.sectionOverrides = {};
  const all = opts.history?.length ? [...opts.history, ...clusters] : clusters;
  for (const c of all) {
    if (!c._sf) c._sf = staticFeatures(c);
    const ts = c.members.map(m => m.t || Infinity);
    c._t0 = Math.min(...ts, c.latestT ?? Infinity);
    if (!Number.isFinite(c._t0)) c._t0 = now;
  }
  const novelty = noveltyFeatures(all);
  const items = [];
  for (const c of clusters) {
    const routine = opts.damper === undefined ? detectRoutine(c) : detectRoutine(c, { strength: opts.damper });
    const cov = coverage(c, now);
    const tf = timeFeatures(c, now, routine.strength, opts.dedupeCorroboration === false ? cov : { ...cov, independent: cov.distinctAll });
    const cs = centroidSims(c._vec, centroids, c.feed);
    const e5 = c._vec ? { ...(novelty.get(c.id) || {}), ...(cs || {}) } : {};
    const f = { ...c._sf, ...tf, ...feedOneHot(c), ...e5 };
    const neutral = !c._vec || !cs;   // no vector (or no centroids): e5 features contribute nothing
    let ze = model.el.b, zq = model.q.b, zt = model.tp.b;
    for (let i = 0; i < model.names.length; i++) {
      const name = model.names[i];
      const z = neutral && E5_FEATURES.has(name) ? 0 : ((f[name] ?? 0) - model.mu[i]) / model.sd[i];
      ze += model.el.w[i] * z; zq += model.q.w[i] * z; zt += model.tp.w[i] * z;
    }
    const pElig = sigmoid(ze), pTop = sigmoid(zt), qHat = Math.max(0, zq);
    const fresh = Math.exp(-tf.age_h / model.freshnessHours);
    const score = (model.mix * pTop + (1 - model.mix) * pElig * Math.min(1, qHat / model.relTop)) * (0.45 + 0.55 * fresh);
    const prof = hotProfile(cov.distinct, now, floorCfg);
    const item = { id: c.id, feed: c.feed, score, pElig, pTop, qHat, fresh, hotOutlets: prof.count, outlets: prof.total, firstT: prof.firstT, lastT: prof.lastT, routine: routine.kinds, damp: routine.strength, tier: 0, hot: false };
    item.tier = hotTier(item, now, floorCfg);
    item.hot = item.tier > 0;
    items.push(item);
  }
  const byFeed = new Map();
  for (const it of items) { if (!byFeed.has(it.feed)) byFeed.set(it.feed, []); byFeed.get(it.feed).push(it); }
  const ranked = [];
  for (const list of byFeed.values()) ranked.push(...applyHotFloor(list, floorCfg));
  return { ranked, byId: new Map(items.map(it => [it.id, it])) };
}

/** The contiguous top prefix with score >= mean + kappa*sd of the section (model.kappa), plus hot-floor stories. Used by the replay evaluation. */
export function topSet(ranked, { kappa = 0 } = {}) {
  const out = new Set(), byFeed = new Map();
  for (const r of ranked) { if (!byFeed.has(r.feed)) byFeed.set(r.feed, []); byFeed.get(r.feed).push(r); }
  for (const list of byFeed.values()) {
    const byScore = [...list].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    const n = byScore.length, mean = byScore.reduce((s, r) => s + r.score, 0) / n;
    const sd = Math.sqrt(byScore.reduce((s, r) => s + (r.score - mean) ** 2, 0) / n), bound = mean + kappa * sd;
    for (const r of byScore) { if (r.score < bound) break; out.add(r.id); }
    for (const r of list) if (r.hot) out.add(r.id);
  }
  return out;
}

export { FEEDS, HOURS };
