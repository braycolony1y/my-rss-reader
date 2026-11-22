// Hot-news floor: widely and quickly reported stories must surface regardless of their model score.
import { HOT_FLOOR } from './config.js';
import { HOURS } from './features.js';

/**
 * News aggregators republish headlines of others; they are not originators and never count as an outlet
 * for the floor (they still count for the corroboration features, which the model was fitted with).
 */
export const AGGREGATOR_DOMAINS = new Set(['news.google.com', 'news.google.com.vn', 'google.com', 'techmeme.com', 'memeorandum.com', 'msn.com',
  'flipboard.com', 'feedly.com', 'newsbreak.com', 'ground.news', 'yahoo.com', 'news.yahoo.com', 'baomoi.com', 'smartnews.com']);

export const minOutletsFor = (feed, cfg = HOT_FLOOR) => cfg.sectionOverrides?.[feed] ?? cfg.minOutlets;

/**
 * Largest number of distinct independent outlets whose first report of the story falls in one
 * `windowHours` window ending within `activeHours` of `now`. Outlets are taken from
 * `independent` (outlet -> first report time; identical-headline reprints and opinion pieces
 * are already excluded, see coverage()).
 */
export function hotOutlets(independent, now, { windowHours = HOT_FLOOR.windowHours, activeHours = HOT_FLOOR.activeHours } = {}) {
  const times = [...independent].filter(([outlet, t]) => t <= now && !AGGREGATOR_DOMAINS.has(outlet)).map(([, t]) => t).sort((a, b) => a - b);
  let best = 0, lo = 0;
  for (let hi = 0; hi < times.length; hi++) {
    while (times[hi] - times[lo] > windowHours * HOURS) lo++;
    // Only a window that is still active (its newest report is recent) counts as hot news now.
    if (now - times[hi] <= activeHours * HOURS) best = Math.max(best, hi - lo + 1);
  }
  return best;
}

/** Whether a scored story earns the floor. `item` = { feed, hotOutlets, routine (array of kinds), pElig }. */
export function earnsHotFloor(item, cfg = HOT_FLOOR) {
  return item.hotOutlets >= minOutletsFor(item.feed, cfg) && !(item.routine?.length) && item.pElig >= cfg.minEligibility;
}

/**
 * Order one section: natural order is score descending; every story that earns the floor is
 * lifted to at most 1-based rank `maxRank + k` (k = its index among floored stories, so several
 * simultaneous hot stories keep their relative order and do not crowd out each other).
 * Stories already above that rank stay where they are. Stable and deterministic.
 * @param {Array<{id:string,score:number,hot:boolean}>} list scored items of one section
 * @returns same items, ordered
 */
export function applyHotFloor(list, cfg = HOT_FLOOR) {
  const natural = [...list].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  const hot = natural.filter(r => r.hot);
  if (!hot.length) return natural;
  const rest = natural.filter(r => !r.hot);
  const out = [];
  // Merge: next hot story is forced out once the output position reaches its allowed rank.
  let h = 0, r = 0;
  while (h < hot.length || r < rest.length) {
    const pos = out.length;               // 0-based position about to be filled
    const forced = h < hot.length && pos >= cfg.maxRank - 1 + h;
    const hotNext = h < hot.length && (forced || r >= rest.length || hot[h].score >= rest[r].score);
    out.push(hotNext ? hot[h++] : rest[r++]);
  }
  return out;
}
