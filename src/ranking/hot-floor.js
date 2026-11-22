// Hot-news floor: widely and quickly reported stories must surface regardless of their model score.
import { HOT_FLOOR } from './config.js';
import { HOURS } from './features.js';
import { isAggregator } from './outlets.js';

export { AGGREGATOR_DOMAINS } from './outlets.js';

export const minOutletsFor = (feed, cfg = HOT_FLOOR) => cfg.sectionOverrides?.[feed] ?? cfg.minOutlets;

export const tier2MinFor = (feed, cfg = HOT_FLOOR) => Math.max(cfg.tier2Outlets, minOutletsFor(feed, cfg));

/**
 * Hot profile of a story's distinct outlets (outlet -> first report time): `count` is the largest number of
 * outlets whose first reports fall in one `windowHours` window ending within `activeHours` of `now` (tier 1);
 * `total` is the number of outlets that have reported so far, whenever (tier 2: a big story is reported over
 * many hours, so its count is not limited to the velocity window); `firstT` / `lastT` are the first and newest
 * first-report times (aggregators excluded, reports after `now` ignored).
 */
export function hotProfile(distinct, now, { windowHours = HOT_FLOOR.windowHours, activeHours = HOT_FLOOR.activeHours } = {}) {
  const times = [...distinct].filter(([outlet, t]) => t > 0 && t <= now && !isAggregator(outlet)).map(([, t]) => t).sort((a, b) => a - b);
  let count = 0, lo = 0;
  for (let hi = 0; hi < times.length; hi++) {
    while (times[hi] - times[lo] > windowHours * HOURS) lo++;
    // Only a window that is still active (its newest report is recent) counts as hot news now.
    if (now - times[hi] <= activeHours * HOURS) count = Math.max(count, hi - lo + 1);
  }
  return { count, total: times.length, firstT: times.length ? times[0] : null, lastT: times.length ? times[times.length - 1] : null };
}

/** Largest number of distinct outlets inside one active window (see hotProfile). */
export const hotOutlets = (distinct, now, opts) => hotProfile(distinct, now, opts).count;

/**
 * Floor tier of a scored story: 2 (pinned #1, Breaking), 1 (lifted into the top ranks, Hot) or 0.
 * `item` = { feed, hotOutlets (window count), outlets (total so far), firstT, lastT, routine (array of kinds), pElig }; `now` in ms.
 * A tier 2 story that is no longer fresh (too old, or no new outlet for tier2StallHours) gets no floor.
 */
export function hotTier(item, now, cfg = HOT_FLOOR) {
  if (item.routine?.length || !(item.pElig >= cfg.minEligibility)) return 0;
  if ((item.outlets ?? item.hotOutlets) >= tier2MinFor(item.feed, cfg)) {
    const fresh = item.firstT != null && now - item.firstT <= cfg.tier2MaxAgeHours * HOURS && now - item.lastT <= cfg.tier2StallHours * HOURS;
    return fresh ? 2 : 0;
  }
  return item.hotOutlets >= minOutletsFor(item.feed, cfg) ? 1 : 0;
}

/** Whether a scored story earns any floor tier. */
export const earnsHotFloor = (item, now, cfg = HOT_FLOOR) => hotTier(item, now, cfg) > 0;

/**
 * Order one section. Natural order is score descending (ties: id). Tier 2 stories are pinned to the top ranks
 * (outlet count desc, then score; tier 2 counts all outlets so far). Tier 1 stories only LIFT: they keep their natural
 * score order, and one is moved up only when its natural position would be below the guarantee, i.e. the h-th tier 1
 * story (0-based, in score order) must sit at 1-based rank max(maxRank, h + 1) or better. A tier 1 story therefore never
 * ranks below a tier 1 story with a lower score, and a story is displaced only by a tier 1 story that needed the lift.
 * Items carry `tier` (0/1/2) or, for backwards compatibility, `hot` (= tier 1). Stable and deterministic.
 * @param {Array<{id:string,score:number,tier?:number,hot?:boolean,hotOutlets?:number}>} list scored items of one section
 * @returns same items, ordered
 */
export function applyHotFloor(list, cfg = HOT_FLOOR) {
  const tierOf = r => r.tier ?? (r.hot ? 1 : 0);
  const natural = [...list].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  const tier2Count = r => r.outlets ?? r.hotOutlets ?? 0;
  const top = natural.filter(r => tierOf(r) === 2).sort((a, b) => tier2Count(b) - tier2Count(a) || b.score - a.score || (a.id < b.id ? -1 : 1));
  const hot = natural.filter(r => tierOf(r) === 1);
  if (!top.length && !hot.length) return natural;
  const rest = natural.filter(r => !tierOf(r));
  const out = [...top];
  let h = 0, r = 0;
  while (h < hot.length || r < rest.length) {
    const pos = out.length;               // 0-based position about to be filled
    const forced = h < hot.length && pos >= Math.max(cfg.maxRank - 1, h);
    const hotNext = h < hot.length && (forced || r >= rest.length || hot[h].score >= rest[r].score);
    out.push(hotNext ? hot[h++] : rest[r++]);
  }
  return out;
}
