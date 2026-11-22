import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreStories, topSet } from '../src/ranking/score.js';
import { loadModel, decodeVector } from '../src/ranking/model.js';
import { applyHotFloor, hotOutlets, hotTier } from '../src/ranking/hot-floor.js';
import { detectRoutine } from '../src/ranking/routine.js';
import { clusterVector, coverage, timeFeatures } from '../src/ranking/features.js';
import { HOT_FLOOR, ROUTINE_DAMPER } from '../src/ranking/config.js';
import { registrableDomain, levenshteinSimilarity } from '../src/ranking/outlets.js';
import { hotnessLabel } from '../src/ranking/classic.js';
import { createVectorStore } from '../src/ranking/vector-store.js';

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const HOUR = 3600000;
const model = loadModel();
// A realistic vector: a blend of the section's frozen top and excluded centroids (a = weight of the top one).
const blend = (feed, a) => { const c = model.centroids[feed]; const v = new Float32Array(384); for (let i = 0; i < 384; i++) v[i] = a * c.top[i] + (1 - a) * c.excl[i]; const n = Math.hypot(...v); return v.map(x => x / n); };
const unitVec = seed => { const v = new Float32Array(384); for (let i = 0; i < 384; i++) v[i] = Math.sin(seed * (i + 1)); const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)); return v.map(x => x / n); };

// Different outlets word the same story differently: a unique angle phrase per outlet keeps the headlines from being collapsed as syndicated copies.
const ANGLES = ['amber', 'birch', 'cobalt', 'dune', 'ember', 'fjord', 'garnet', 'harbor', 'ivory', 'juniper', 'kestrel', 'lagoon', 'meadow', 'nectar', 'onyx', 'prairie', 'quartz', 'raven', 'saffron', 'tundra', 'umber', 'velvet', 'willow', 'xenon', 'yarrow', 'zephyr'];
export const variant = (title, i) => !i ? title : `${title} ${ANGLES[i % ANGLES.length]} ${ANGLES[(i * 7 + 3) % ANGLES.length]} angle ${i}`;
// A story reported by `outlets` (domains) starting `startAgoH` hours ago, one report every `gapMin` minutes.
const story = (id, title, outlets, { feed = 'news_global', startAgoH = 2, gapMin = 10, vec = null, titles = null } = {}) => ({
  id, feed,
  members: outlets.map((domain, i) => ({ title: titles?.[i] ?? variant(title, i), content: '', domain, sw: 1, t: NOW - startAgoH * HOUR + i * gapMin * 60000, vec }))
});
const GOLDEN = [['a', 0.827, 0.8681, 0.8727], ['b', 0.0019, 0.1021, 0.0051], ['c', 0.5438, 0.5368, 0.6743]];
const outletNames = n => Array.from({ length: n }, (_, i) => `outlet${i}.com`);
const fillers = (n, feed = 'news_global') => Array.from({ length: n }, (_, i) => story(`filler${i}`, `Local update number ${i} about a minor matter`, [`solo${i}.com`], { feed, startAgoH: 20 + i }));

test('the shipped model and frozen centroids load and are consistent', () => {
  assert.equal(model.names.length, 60);
  for (const key of ['mu', 'sd']) assert.equal(model[key].length, 60);
  for (const head of ['el', 'q', 'tp']) assert.equal(model[head].w.length, 60);
  assert.ok(model.centroids, 'centroids.json must be present');
  for (const key of ['all', 'news_vietnam', 'news_global', 'finance_vietnam', 'finance_global', 'tech_vietnam', 'tech_global']) {
    for (const side of ['top', 'excl']) {
      const v = model.centroids[key][side];
      assert.equal(v.length, 384);
      assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-4, `${key}.${side} is a unit vector`);
    }
  }
  assert.equal(decodeVector(Buffer.from(new Float32Array([1, 2]).buffer).toString('base64'))[1], 2);
});

test('golden scores of fixed stories stay stable', () => {
  const clusters = [
    story('a', 'Central bank raises interest rate as inflation surges', outletNames(3), { vec: blend('news_global', 0.6) }),
    story('b', 'Local update about a minor matter', ['solo.com'], { vec: blend('news_global', 0.4), startAgoH: 30 }),
    story('c', 'Ngân hàng Nhà nước điều chỉnh lãi suất điều hành', ['vnexpress.net', 'tuoitre.vn'], { feed: 'finance_vietnam', vec: blend('finance_vietnam', 0.6) })
  ];
  // Earlier stories of the same sections feed the 48 h novelty feature (a lone story would look maximally novel).
  const history = ['news_global', 'finance_vietnam'].flatMap(feed => [0.45, 0.5, 0.55].map((a, i) => story(`old-${feed}-${i}`, 'Earlier story', [`h${i}.com`], { feed, startAgoH: 12 + i, vec: blend(feed, a) })));
  const { byId } = scoreStories(clusters, { now: NOW, history });
  const round = x => Math.round(x * 1e4) / 1e4;
  assert.deepEqual([...byId.values()].map(r => [r.id, round(r.score), round(r.pElig), round(r.pTop)]), GOLDEN);
  assert.ok(byId.get('a').score > byId.get('b').score, 'a corroborated, central-bank, top-like story outranks a stale single-outlet one');
});

test('stories without vectors rank with neutral e5 features and never produce NaN', () => {
  const withVec = story('x', 'Central bank raises interest rate as inflation surges', outletNames(3), { vec: blend('news_global', 0.6) });
  const without = story('x', 'Central bank raises interest rate as inflation surges', outletNames(3));
  const noCentroids = story('x', 'Central bank raises interest rate as inflation surges', outletNames(3), { vec: blend('news_global', 0.6) });
  const a = scoreStories([withVec], { now: NOW }).byId.get('x');
  const b = scoreStories([without], { now: NOW }).byId.get('x');
  const c = scoreStories([noCentroids], { now: NOW, centroids: null }).byId.get('x');
  for (const r of [a, b, c]) for (const k of ['score', 'pElig', 'pTop', 'qHat']) assert.ok(Number.isFinite(r[k]), `${k} finite`);
  assert.notEqual(a.score, b.score, 'a vector changes the score');
  assert.equal(b.score, c.score, 'no vector and no centroids both mean neutral e5 features');
  assert.ok(b.score > 0 && b.score <= 1);
  // The mixed case: some stories have vectors, others not, in one call.
  const mixed = scoreStories([withVec, { ...without, id: 'y' }], { now: NOW });
  assert.equal(mixed.ranked.length, 2);
});

test('clusterVector averages and normalises, ignoring missing member vectors', () => {
  assert.equal(clusterVector([null, undefined]), null);
  const v = clusterVector([unitVec(1), null, unitVec(1)]);
  assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-5);
});

test('hot floor: enough outlets inside the window lifts a story near the top and labels it hot', () => {
  const quietHot = story('hot', 'Council schedules a routine meeting for next week', outletNames(HOT_FLOOR.minOutlets), { startAgoH: 2 });
  const { ranked, byId } = scoreStories([quietHot, ...fillers(12)], { now: NOW, hotFloor: { minEligibility: 0 }, damper: 0 });
  assert.equal(byId.get('hot').hot, true);
  assert.ok(ranked.findIndex(r => r.id === 'hot') < HOT_FLOOR.maxRank, 'floored story is within the top ranks of its section');
  assert.ok(byId.get('hot').hotOutlets >= HOT_FLOOR.minOutlets);
  const off = scoreStories([quietHot, ...fillers(12)], { now: NOW, hotFloor: { minOutlets: Infinity }, damper: 0 });
  assert.equal(off.byId.get('hot').hot, false);
});

test('hot floor does not fire for too few outlets, a window that is too wide, or a stale story', () => {
  const few = story('few', 'Council schedules a meeting', outletNames(HOT_FLOOR.minOutlets - 1));
  const spread = story('spread', 'Council schedules a meeting', outletNames(HOT_FLOOR.minOutlets + 2), { gapMin: 120 }); // one new outlet every 2 h
  const stale = story('stale', 'Council schedules a meeting', outletNames(HOT_FLOOR.minOutlets + 2), { startAgoH: HOT_FLOOR.activeHours + 6 });
  const { byId } = scoreStories([few, spread, stale, ...fillers(5)], { now: NOW, hotFloor: { minEligibility: 0 }, damper: 0 });
  for (const id of ['few', 'spread', 'stale']) assert.equal(byId.get(id).hot, false, id);
  // Identical-headline reprints and opinion pieces are not independent outlets.
  const reprints = story('rep', 'Council schedules a meeting', outletNames(8), { titles: Array(8).fill('Council schedules a meeting') });
  assert.equal(scoreStories([reprints], { now: NOW, hotFloor: { minEligibility: 0 }, damper: 0 }).byId.get('rep').hot, false);
});

test('aggregators never count as outlets, and news_vietnam needs one more outlet than the default', () => {
  const viaAggregators = story('agg', 'Council schedules a meeting', ['news.google.com', 'techmeme.com', 'msn.com', 'a.com', 'b.com']);
  assert.equal(scoreStories([viaAggregators], { now: NOW }).byId.get('agg').hotOutlets, 2);
  const outlets = HOT_FLOOR.minOutlets; // enough for the default sections
  const global = story('g', 'Central bank raises interest rate as inflation surges', outletNames(outlets), { feed: 'news_global' });
  const vietnam = story('v', 'Ngân hàng trung ương tăng lãi suất do lạm phát', outletNames(outlets), { feed: 'news_vietnam' });
  const { byId } = scoreStories([global, vietnam], { now: NOW, hotFloor: { minEligibility: 0 }, damper: 0 });
  assert.equal(byId.get('g').hot, true);
  assert.equal(byId.get('v').hot, HOT_FLOOR.minOutlets >= (HOT_FLOOR.sectionOverrides.news_vietnam ?? 0), 'the Vietnamese news override applies');
  assert.equal(byId.get('v').hot, false);
  // An explicit minOutlets overrides every section.
  assert.equal(scoreStories([vietnam], { now: NOW, hotFloor: { minOutlets: outlets, minEligibility: 0 }, damper: 0 }).byId.get('v').hot, true);
});

test('hotOutlets counts distinct outlets inside one sliding window ending recently', () => {
  const independent = new Map([['a', NOW - 5 * HOUR], ['b', NOW - 2.5 * HOUR], ['c', NOW - 2 * HOUR], ['d', NOW - 1 * HOUR]]);
  assert.equal(hotOutlets(independent, NOW, { windowHours: 3, activeHours: 12 }), 3); // b, c, d
  assert.equal(hotOutlets(independent, NOW, { windowHours: 1, activeHours: 12 }), 2); // c, d
  assert.equal(hotOutlets(independent, NOW + 40 * HOUR, { windowHours: 3, activeHours: 12 }), 0); // nothing active any more
});

test('applyHotFloor keeps order and lifts floored stories to the configured rank', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, score: 1 - i / 20, hot: false }));
  items[8].hot = true; items[9].hot = true;
  const out = applyHotFloor(items, { maxRank: 3 }).map(r => r.id);
  assert.deepEqual(out.slice(0, 5), ['s0', 's1', 's8', 's9', 's2']);
  assert.equal(new Set(out).size, 10);
  assert.deepEqual(applyHotFloor(items.map(r => ({ ...r, hot: false })), { maxRank: 3 }).map(r => r.id), items.map(r => r.id));
});

test('routine damper detects English and Vietnamese routine patterns', () => {
  const kinds = titles => detectRoutine({ members: titles.map((title, i) => ({ title, domain: `o${i}.com` })) }).kinds;
  assert.deepEqual(kinds(['Arsenal beat Chelsea 2-1 in Premier League thriller']), ['sports']);
  assert.deepEqual(kinds(['Hà Nội thắng 2-1 ở vòng 5 V-League']), ['sports']);
  assert.deepEqual(kinds(['Cannes film festival opens with fireworks']), ['festival']);
  assert.deepEqual(kinds(['Lễ hội pháo hoa quốc tế khai mạc']), ['festival']);
  assert.deepEqual(kinds(['Nation marks 80th anniversary of founding']), ['anniversary']);
  assert.deepEqual(kinds(['Kỷ niệm 80 năm Ngày thành lập Quân đội nhân dân']), ['anniversary']);
  assert.deepEqual(kinds(['Oscars 2026: full list of winners at the awards ceremony']), ['award']);
  assert.deepEqual(kinds(['Trao giải Hoa hậu Hoàn vũ Việt Nam']), ['award']);
  assert.deepEqual(kinds(['Điểm tin sáng 22/11: các sự kiện nổi bật']), ['digest']);
  assert.deepEqual(kinds(['Morning news roundup: top headlines today']), ['digest']);
  assert.deepEqual(kinds(['Fed raises interest rates by 25 basis points']), []);
  assert.deepEqual(kinds(['Quốc hội thông qua nghị quyết về ngân sách']), []);
  // High stakes keep a story newsworthy even when it matches a routine pattern.
  assert.deepEqual(kinds(['Stampede at festival kills 12']), []);
  assert.deepEqual(kinds(['Cháy lớn tại lễ hội ở Huế']), []);
  // State-media wire reposts: only state outlets, near identical wording.
  const wire = ['baotintuc.vn', 'vtv.vn', 'nhandan.vn'].map(domain => ({ title: 'Người dân hòa mình vào không gian văn hóa Hà Nội', domain }));
  assert.deepEqual(detectRoutine({ members: wire }).kinds, ['state_media']);
  const mixed = [...wire.slice(0, 2), { title: 'Người dân hòa mình vào không gian văn hóa Hà Nội', domain: 'tuoitre.vn' }];
  assert.deepEqual(detectRoutine({ members: mixed }).kinds, []);
});

test('routine damper shrinks the corroboration and velocity boost, and routine stories never get the floor', () => {
  const routine = story('r', 'Arsenal beat Chelsea 2-1 in Premier League', outletNames(6));
  const plain = story('p', 'Regulators approve the merger of two large banks', outletNames(6));
  const cov = coverage(routine, NOW);
  const full = timeFeatures(routine, NOW, 0, cov), damped = timeFeatures(routine, NOW, ROUTINE_DAMPER.strength, cov);
  for (const k of ['corr', 'att', 'n_pub_log', 'vel3', 'vel6', 'n_art_log']) assert.ok(damped[k] < full[k], `${k} reduced`);
  assert.equal(damped.age_h, full.age_h, 'freshness is untouched');
  const none = timeFeatures(routine, NOW, 1, cov);
  assert.equal(none.corr, 0, 'strength 1 is a single-outlet story');
  const on = scoreStories([routine], { now: NOW }).byId.get('r');
  const off = scoreStories([routine], { now: NOW, damper: 0 }).byId.get('r');
  assert.deepEqual(on.routine, ['sports']);
  assert.ok(on.damp > 0 && off.routine.length === 1 && off.damp === 0);
  assert.ok(on.score < off.score, 'damper lowers the score of routine multi-outlet stories');
  assert.equal(scoreStories([plain], { now: NOW }).byId.get('p').damp, 0);
  // Even with minimum eligibility off, routine stories do not earn the floor.
  assert.equal(scoreStories([routine], { now: NOW, hotFloor: { minEligibility: 0 } }).byId.get('r').hot, false);
  assert.equal(scoreStories([routine], { now: NOW, hotFloor: { minEligibility: 0 }, damper: 0 }).byId.get('r').hot, false);
});

test('topSet is a contiguous prefix by score plus floored stories', () => {
  const quietHot = story('hot', 'Council schedules a routine meeting', outletNames(5));
  const { ranked } = scoreStories([quietHot, ...fillers(8)], { now: NOW, hotFloor: { minEligibility: 0 }, damper: 0 });
  const top = topSet(ranked, { kappa: 0 });
  assert.ok(top.has('hot'));
  assert.ok(top.size >= 1 && top.size < ranked.length);
});

const FLOOR = { minEligibility: 0 };
const run = (clusters, hotFloor = FLOOR) => scoreStories(clusters, { now: NOW, hotFloor, damper: 0 });

test('graded floor: 3-7 outlets are tier 1 (Hot, top 3), 8 or more are tier 2 (pinned #1, Breaking)', () => {
  const t1 = story('t1', 'Council schedules a routine meeting for next week', outletNames(HOT_FLOOR.minOutlets));
  const t2 = story('t2', 'Mayor announces a routine budget review hearing', outletNames(HOT_FLOOR.tier2Outlets));
  const almost = story('almost', 'Library extends opening hours on weekends', outletNames(HOT_FLOOR.tier2Outlets - 1));
  const { ranked, byId } = run([t1, t2, almost, ...fillers(12)]);
  assert.equal(byId.get('t1').tier, 1);
  assert.equal(byId.get('almost').tier, 1, 'one outlet short of tier 2 stays tier 1');
  assert.equal(byId.get('t2').tier, 2);
  assert.equal(byId.get('t2').hot, true);
  assert.equal(ranked[0].id, 't2', 'tier 2 is pinned to #1 whatever its score');
  assert.ok(ranked.findIndex(r => r.id === 't1') < HOT_FLOOR.maxRank + 2);
  assert.equal(hotnessLabel({ tier: byId.get('t2').tier, hotness: 2 }), 'Breaking');
  assert.equal(hotnessLabel({ tier: byId.get('t1').tier, hotness: 2 }), 'Hot');
  // news_vietnam keeps its higher tier 1 minimum; tier 2 is the same for every section.
  const vn = n => story('vn', 'Hội đồng lên lịch họp định kỳ vào tuần tới', outletNames(n), { feed: 'news_vietnam' });
  assert.equal(run([vn(HOT_FLOOR.minOutlets)]).byId.get('vn').tier, 0);
  assert.equal(run([vn(HOT_FLOOR.sectionOverrides.news_vietnam)]).byId.get('vn').tier, 1);
  assert.equal(run([vn(HOT_FLOOR.tier2Outlets)]).byId.get('vn').tier, 2);
});

test('stories of one tier are ordered by outlet count, then by score', () => {
  const items = [
    { id: 'a', score: 0.9, tier: 2, hotOutlets: 8 }, { id: 'b', score: 0.1, tier: 2, hotOutlets: 11 }, { id: 'c', score: 0.5, tier: 2, hotOutlets: 11 },
    { id: 'd', score: 0.2, tier: 1, hotOutlets: 6 }, { id: 'e', score: 0.1, tier: 1, hotOutlets: 7 }, { id: 'f', score: 0.8, tier: 0 }, { id: 'g', score: 0.7, tier: 0 },
    { id: 'h', score: 0.6, tier: 0 }, { id: 'i', score: 0.3, tier: 0 }
  ];
  assert.deepEqual(applyHotFloor(items, { maxRank: 3 }).map(r => r.id), ['c', 'b', 'a', 'e', 'd', 'f', 'g', 'h', 'i']); // tier 2 first, then tier 1 (7 outlets before 6), already past rank 3
  // End to end: the story with more outlets comes first even when it scores lower.
  const small = story('small', 'Council schedules a routine meeting for next week', outletNames(8));
  const big = story('big', 'Mayor announces a routine budget review hearing', outletNames(12).map(d => 'x' + d));
  assert.deepEqual(run([small, big, ...fillers(6)]).ranked.slice(0, 2).map(r => r.id), ['big', 'small']);
});

test('syndicated reposts and one publisher under several hostnames count as one outlet', () => {
  const title = 'Authorities detain suspected cartel leader after joint operation in northern region';
  const wire = story('wire', title, Array.from({ length: 10 }, (_, i) => `paper${i}.com`), { titles: Array.from({ length: 10 }, (_, i) => i % 2 ? title.toUpperCase() : `${title} - Paper ${i}`) });
  assert.equal(coverage(wire, NOW).distinct.size, 1, 'near-identical headlines from ten domains are one outlet');
  const lead = 'The suspected leader was detained early on Friday morning following a joint operation by federal forces and state police in the northern region, officials said.';
  const sameLead = { id: 'lead', feed: 'news_global', members: ['a.com', 'b.com', 'c.com'].map((domain, i) => ({ title: `Completely different headline number ${i} about unrelated words ${ANGLES[i]}`, content: lead, domain, t: NOW - HOUR + i * 60000 })) };
  assert.equal(coverage(sameLead, NOW).distinct.size, 1, 'the same lead text collapses outlets');
  const hosts = story('hosts', 'Council schedules a routine meeting', ['www.cnn.com', 'edition.cnn.com', 'amp.cnn.com', 'bbc.co.uk', 'news.bbc.co.uk', 'one.blogspot.com', 'two.blogspot.com']);
  assert.equal(coverage(hosts, NOW).distinct.size, 4, 'cnn.com x3 -> 1, bbc.co.uk x2 -> 1, two separate blogspot blogs stay apart');
  const genuine = story('gen', 'Council schedules a routine meeting', outletNames(6));
  assert.equal(coverage(genuine, NOW).distinct.size, 6, 'differently worded reports stay separate');
  // Syndication gives no floor, however many domains carry it.
  const { byId } = run([wire, ...fillers(5)]);
  assert.equal(byId.get('wire').tier, 0);
  assert.equal(byId.get('wire').outlets, 1);
  assert.equal(registrableDomain('news.google.com.vn'), 'google.com.vn');
  assert.ok(levenshteinSimilarity('abcdefghij', 'abcdefghix') >= 0.9 && levenshteinSimilarity('abcdef', 'uvwxyz', 0.9) === 0);
});

test('routine stories earn neither tier, even with 12 outlets', () => {
  const match = story('m', 'Arsenal beat Chelsea 2-1 in Premier League thriller', outletNames(12));
  const { byId } = scoreStories([match, ...fillers(4)], { now: NOW, hotFloor: FLOOR });
  assert.ok(byId.get('m').routine.includes('sports'));
  assert.equal(byId.get('m').tier, 0);
  assert.equal(byId.get('m').hot, false);
});

test('the floor decays: tier 2 expires after its max age or when outlet velocity stalls, tier 1 follows the active window', () => {
  const fresh = story('fresh', 'Council schedules a routine meeting for next week', outletNames(9), { startAgoH: 2 });
  const old = story('old', 'Mayor announces a routine budget review hearing', outletNames(9), { startAgoH: HOT_FLOOR.tier2MaxAgeHours + 1 });
  const stalled = story('stalled', 'Library extends opening hours on weekends', outletNames(9), { startAgoH: HOT_FLOOR.tier2StallHours + 2, gapMin: 5 });
  // Reports keep arriving (one outlet per 20 min for 12 h) but the story began more than the max age ago.
  const trickle = story('trickle', 'Harbor authority reviews ferry timetable changes', outletNames(30), { startAgoH: HOT_FLOOR.tier2MaxAgeHours + 0.5, gapMin: 25 });
  const { byId } = run([fresh, old, stalled, trickle, ...fillers(5)]);
  assert.equal(byId.get('fresh').tier, 2);
  assert.equal(byId.get('old').tier, 0, 'older than tier2MaxAgeHours: back to its normal score');
  assert.equal(byId.get('stalled').tier, 0, 'no new outlet for tier2StallHours: back to its normal score');
  assert.equal(byId.get('trickle').tier, 0, 'a long trickle of reports does not keep tier 2 beyond its max age');
  // A big story is reported over many hours: 9 outlets at one per hour (never 8 inside the 4 h window) is still tier 2 while it is fresh and still growing.
  const slow = story('slow', 'Border crossing reopens after a routine inspection', outletNames(9), { startAgoH: 9, gapMin: 60 });
  assert.equal(run([slow, ...fillers(3)]).byId.get('slow').tier, 2);
  assert.ok(run([slow, ...fillers(3)]).byId.get('slow').hotOutlets < HOT_FLOOR.tier2Outlets, 'the window count alone would only be tier 1');
  // Timings are config: a longer max age keeps the old story pinned.
  assert.equal(run([old, ...fillers(3)], { ...FLOOR, tier2MaxAgeHours: 24, tier2StallHours: 24 }).byId.get('old').tier, 2);
  // Tier 1 is not subject to the tier 2 stall rule.
  const t1 = story('t1', 'Council schedules a routine meeting for next week', outletNames(4), { startAgoH: HOT_FLOOR.tier2StallHours + 3 });
  assert.equal(run([t1, ...fillers(3)]).byId.get('t1').tier, 1);
  assert.equal(hotTier({ feed: 'news_global', hotOutlets: 9, firstT: NOW - HOUR, lastT: NOW - 60000, routine: [], pElig: 0.9 }, NOW), 2);
  assert.equal(hotTier({ feed: 'news_global', hotOutlets: 9, firstT: NOW - HOUR, lastT: NOW - 60000, routine: ['sports'], pElig: 0.9 }, NOW), 0);
  assert.equal(hotTier({ feed: 'news_global', hotOutlets: 9, firstT: NOW - HOUR, lastT: NOW - 60000, routine: [], pElig: 0.1 }, NOW), 0);
});

test('the vector store loads once, caches misses, and is inert when disabled', async () => {
  const calls = [];
  const encode = v => Buffer.from(v.buffer).toString('base64');
  const articles = [{ title: 'a' }, { title: 'b' }];
  const store = createVectorStore({
    keyOf: a => `k-${a.title}`, now: () => 1000,
    load: async (file, keys, importEntries) => { calls.push([...keys]); if (keys.has('k-a')) importEntries({ 'k-a': encode(unitVec(1)) }); }
  });
  assert.equal(store.get(articles[0]), null);
  await store.warm(articles);
  assert.deepEqual(calls, [['k-a', 'k-b']]);
  assert.equal(store.get(articles[0]).length, 384);
  assert.equal(store.get(articles[1]), null);
  assert.equal(store.revision, 1);
  await store.warm(articles);           // k-b is a fresh miss: nothing to load
  assert.equal(calls.length, 1);
  const inert = createVectorStore({ enabled: false, load: async () => assert.fail('must not load') });
  assert.equal(inert.warm(articles), null);
});
