// Pure feature extraction for the deterministic story ranker (no I/O, no generative AI).
//
// A "cluster" is { id, feed, latestT?, members:[{ title, content?, domain, sw?, t, vec? }] } where
//   feed   one of FEEDS (section id, e.g. 'news_vietnam')
//   t      publication time in ms epoch
//   sw     stored source weight (smartSourceScores), defaults to 1
//   vec    L2-normalised multilingual-e5-small vector of the member, optional
import { LEX, GUARDS, POLICY_EXCLUDE } from './lexicons.js';
import { NOVELTY_WINDOW_HOURS } from './config.js';
import { isAggregator, outletGroups } from './outlets.js';

export const FEEDS = ['news_vietnam', 'news_global', 'finance_vietnam', 'finance_global', 'tech_vietnam', 'tech_global'];
export const HOURS = 3600000;

const has = (re, s) => re.test(s) ? 1 : 0;

/** Lowercase, strip diacritics (đ -> d) and collapse whitespace; the form policy.js guards expect. */
export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
export const stripHtml = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
/** Outlet identity of a member (hostname without www./m.). */
export const publisherOf = m => String(m.domain || '').toLowerCase().replace(/^(www\.|m\.)/, '') || String(m.feed || '').toLowerCase();
const headlineKey = t => stripHtml(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
export function unit(v) { const n = Math.sqrt(dot(v, v)) || 1; const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / n; return o; }

/** Mean of member vectors, L2-normalised; null when no member has a vector. */
export function clusterVector(vectors) {
  const vecs = vectors.filter(Boolean);
  if (!vecs.length) return null;
  const sum = new Float32Array(vecs[0].length);
  for (const v of vecs) for (let i = 0; i < sum.length; i++) sum[i] += v[i];
  return unit(sum);
}

/**
 * Features that do not depend on "now". Also sets cluster._vec (unit cluster vector or null).
 * Missing vectors degrade gracefully: hasvec = 0 and tight = 1; the centroid and novelty
 * features are then zero (see score.js), which is the same as the fitted "no e5" input.
 */
export function staticFeatures(cluster) {
  const ms = cluster.members;
  const rep = ms[0];
  const title = stripHtml(rep.title);
  const allTitles = ms.map(m => stripHtml(m.title)).join(' ');
  const body = stripHtml(rep.content).slice(0, 600);
  const text = title + ' ' + body;
  const f = {};
  // Lexicons: 1 when found in any member title, 0.5 when only in the lead, else 0.
  for (const k of Object.keys(LEX)) f[k] = has(LEX[k], allTitles) ? 1 : (has(LEX[k], text) ? 0.5 : 0);
  const tn = norm(title + ' ' + body);
  for (const k of Object.keys(GUARDS)) f[k] = has(GUARDS[k], tn);
  f.policy_exclude = has(POLICY_EXCLUDE, norm(title));
  f.rs_impact = Math.min(1, 0.28 + (has(LEX.rs_geo, allTitles) + has(LEX.rs_macro, allTitles) + has(LEX.rs_tech, allTitles)) * 0.34);
  // Title shape.
  const words = title.split(/\s+/).filter(Boolean);
  const caps = words.slice(1).filter(w => /^[A-Z][\p{L}\-]+/u.test(w)).length;
  f.t_len = Math.min(1.5, title.length / 100);
  f.t_digit = has(/\d/, title);
  f.t_pct = has(/%|\bpercent\b|\bphần trăm\b/iu, title);
  f.t_caps = words.length > 1 ? Math.min(1, caps / Math.max(1, words.length - 1)) : 0;
  f.t_q = has(/\?/, title);
  f.t_quote = has(/["“”‘’']/, title);
  f.t_colon = has(/:/, title);
  f.body_len = Math.min(1, body.length / 500);
  f.vi = /[ăâđêôơưàáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/iu.test(title) ? 1 : 0;
  // Source authority from the stored (frozen) source weights.
  const sws = ms.map(m => Number(m.sw) || 1);
  f.sw_max = Math.max(...sws);
  f.sw_rep = Number(rep.sw) || 1;
  // e5 cluster vector and tightness.
  const vecs = ms.map(m => m.vec).filter(Boolean);
  cluster._vec = clusterVector(vecs);
  if (cluster._vec) {
    f.tight = vecs.length > 1 ? vecs.reduce((a, v) => a + dot(v, cluster._vec), 0) / vecs.length : 1;
    f.hasvec = 1;
  } else { f.tight = 1; f.hasvec = 0; }
  f.multi = ms.length > 1 ? 1 : 0;
  return f;
}

/**
 * Per-outlet coverage of a cluster as of `now` (members published later are ignored).
 * `firstSeen` maps outlet -> time of its first report; `independent` is the subset of
 * outlets that did not just reprint an identical headline and are not opinion pieces.
 * `distinct` maps real outlets (aggregators dropped; one publisher under several hostnames, and syndicated or
 * near-identical reposts, collapsed into one; see outlets.js) to the time of their first report; `distinctAll`
 * is the same collapse over `independent` (aggregators kept), for the corroboration features.
 */
export function coverage(cluster, now) {
  const ms = cluster.members.filter(m => !m.t || m.t <= now);
  const use = ms.length ? ms : cluster.members;
  const firstSeen = new Map(), seenTitles = new Set(), independent = new Map(), distinct = new Map(), distinctAll = new Map();
  let t0 = Infinity, tLast = 0;
  const sorted = [...use].sort((a, b) => (a.t || 0) - (b.t || 0));
  const groups = outletGroups(sorted, sorted.map(publisherOf));
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    const p = publisherOf(m);
    if (!firstSeen.has(p)) firstSeen.set(p, m.t || 0);
    const k = headlineKey(m.title);
    const opinion = LEX.x_opinion.test(m.title || '');
    if (!seenTitles.has(k) && !opinion && !independent.has(p)) { independent.set(p, m.t || 0); if (!distinctAll.has(groups[i])) distinctAll.set(groups[i], m.t || 0); }
    if (!opinion && !isAggregator(p) && !distinct.has(groups[i])) distinct.set(groups[i], m.t || 0);
    seenTitles.add(k);
    if (m.t) { t0 = Math.min(t0, m.t); tLast = Math.max(tLast, m.t); }
  }
  if (!Number.isFinite(t0)) t0 = now;
  return { used: use, firstSeen, independent, distinct, distinctAll, t0, tLast };
}

/**
 * Time-dependent features. `damp` in [0,1) is the routine damper strength: the effective
 * outlet/article counts that feed corroboration and velocity are shrunk toward a single
 * outlet by that fraction (0 = untouched).
 */
export function timeFeatures(cluster, now, damp = 0, cov = coverage(cluster, now)) {
  const { used, firstSeen, independent, t0, tLast } = cov;
  const shrink = n => 1 + (n - 1) * (1 - damp);
  const nPub = shrink(firstSeen.size), nIndep = shrink(Math.max(1, independent.size)), nArt = shrink(used.length);
  const ageH = Math.max(0, (now - (cluster.latestT || tLast || t0)) / HOURS);
  let v3 = 0, v6 = 0;
  for (const t of firstSeen.values()) { if (t - t0 <= 3 * HOURS) v3++; if (t - t0 <= 6 * HOURS) v6++; }
  v3 = shrink(v3); v6 = shrink(v6);
  return {
    n_pub_log: Math.log1p(nPub), att: Math.min(1, Math.log1p(nPub) / Math.log(32)),
    corr: 1 - 1 / nIndep, n_indep: nIndep, n_art_log: Math.log1p(nArt),
    vel3: Math.log1p(v3), vel6: Math.log1p(v6), vel_frac: v3 / Math.max(1, firstSeen.size),
    age_h: ageH, fresh: Math.exp(-ageH / 48), fresh_cl: Math.exp(-ageH / 30), first_age_h: Math.max(0, (now - t0) / HOURS)
  };
}

/**
 * Novelty: 1 - max cosine to other clusters of the same feed that started earlier within
 * `windowH`, plus the count (capped at 3) of near duplicates (cosine > 0.85) in that window.
 * Clusters need `_vec` and `_t0` (first report time).
 */
export function noveltyFeatures(clusters, windowH = NOVELTY_WINDOW_HOURS) {
  const out = new Map(), byFeed = new Map();
  for (const c of clusters) { if (!byFeed.has(c.feed)) byFeed.set(c.feed, []); byFeed.get(c.feed).push(c); }
  for (const list of byFeed.values()) {
    list.sort((a, b) => a._t0 - b._t0);
    for (let i = 0; i < list.length; i++) {
      const c = list[i]; let best = 0, dups = 0;
      if (c._vec) for (let j = i - 1; j >= 0; j--) {
        const o = list[j]; if (c._t0 - o._t0 > windowH * HOURS) break; if (!o._vec) continue;
        const s = dot(c._vec, o._vec); if (s > best) best = s; if (s > 0.85) dups++;
      }
      out.set(c.id, { max_prev_sim: best, nov_sim: 1 - best, n_dups: Math.min(3, dups) });
    }
  }
  return out;
}

export function feedOneHot(cluster) { const f = {}; for (const x of FEEDS) f['feed_' + x] = cluster.feed === x ? 1 : 0; return f; }
