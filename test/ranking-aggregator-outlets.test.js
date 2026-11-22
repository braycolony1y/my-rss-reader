import test from 'node:test';
import assert from 'node:assert/strict';
import { publisherKey, titlePublisher, resolveAggregatorPublisher, outletGroups } from '../src/ranking/outlets.js';
import { coverage } from '../src/ranking/features.js';
import { toRankingCluster } from '../src/ranking/classic.js';
import { scoreStories } from '../src/ranking/score.js';

const GN = 'https://news.google.com/rss/articles/CBMiWmh0dHBzOi8vZXhhbXBsZS5jb20';
const gn = (title, extra = {}) => ({ title, link: GN + Math.random().toString(36).slice(2), domain: 'news.google.com', pubDate: '2026-11-21T10:00:00Z', ...extra });

test('titlePublisher reads the trailing publisher of English and Vietnamese Google News titles', () => {
  assert.equal(titlePublisher('Fed holds rates steady as inflation cools - Reuters'), 'Reuters');
  assert.equal(titlePublisher('Nvidia earnings beat estimates | CNBC'), 'CNBC');
  assert.equal(titlePublisher('Giá vàng hôm nay tăng mạnh - Tuổi Trẻ'), 'Tuổi Trẻ');
  assert.equal(titlePublisher('Bão số 9 đổ bộ miền Trung, hàng nghìn người sơ tán - VnExpress'), 'VnExpress');
  assert.equal(titlePublisher('Không có nhà xuất bản trong tiêu đề này'), null);
});

test('publisherKey maps aliases to domains and unknown names to a compact key', () => {
  assert.equal(publisherKey('Reuters'), 'reuters.com');
  assert.equal(publisherKey('The Associated Press'), 'apnews.com');
  assert.equal(publisherKey('Bloomberg.com'), 'bloomberg.com');
  assert.equal(publisherKey('CNBC'), 'cnbc.com');
  assert.equal(publisherKey('VnExpress'), 'vnexpress.net');
  assert.equal(publisherKey('Tuổi Trẻ Online'), 'tuoitre.vn');
  assert.equal(publisherKey('Thanh Niên'), 'thanhnien.vn');
  assert.equal(publisherKey('Báo Dân trí'), 'dantri.com.vn');
  assert.equal(publisherKey('The Next Web'), 'thenextweb');
  assert.equal(publisherKey('The Globe and Mail'), 'theglobeandmail');
  assert.equal(publisherKey(''), null);
});

test('resolveAggregatorPublisher: link host first, then the headline suffix, else null', () => {
  assert.equal(resolveAggregatorPublisher(gn('Fed holds rates - Reuters', { link: 'https://www.reuters.com/markets/fed-holds-2026-11-21/' })), 'reuters.com');
  assert.equal(resolveAggregatorPublisher(gn('Fed holds rates - Reuters')), 'reuters.com');
  assert.equal(resolveAggregatorPublisher(gn('Giá vàng hôm nay tăng mạnh - Tuổi Trẻ')), 'tuoitre.vn');
  assert.equal(resolveAggregatorPublisher(gn('Nvidia earnings beat estimates | The Verge')), 'theverge.com');
  assert.equal(resolveAggregatorPublisher(gn('Headline without a publisher tag')), null);
  assert.equal(resolveAggregatorPublisher(gn('Via Yahoo - Yahoo', { link: 'https://news.yahoo.com/x' })), 'yahoo');   // a name, never an aggregator host
  assert.equal(resolveAggregatorPublisher({ title: 'x', link: GN, source: { title: 'Bloomberg', url: 'https://www.bloomberg.com' } }), 'bloomberg.com');
});

const member = (a, t) => toRankingCluster({ clusterId: 'c', link: a.link, ...a, relatedArticles: [] }, 'tech_global').members[0] && { ...toRankingCluster({ ...a, relatedArticles: [] }, 'tech_global').members[0], t };
const cluster = members => ({ id: 'c', feed: 'tech_global', members });
const NOW = Date.parse('2026-11-21T12:00:00Z');
const direct = (domain, title, t = NOW - 3600e3) => ({ title, content: '', domain, sw: 1, t });
const viaGn = (title, t = NOW - 3600e3, extra = {}) => member(gn(title, extra), t);

test('Google News items count as their real publishers; Reuters via Google News plus reuters.com direct is one outlet', () => {
  const c = cluster([
    direct('reuters.com', 'Fed holds rates steady as inflation cools'),
    viaGn('Fed holds rates steady as inflation cools - Reuters'),
    viaGn('Fed keeps interest rates unchanged, signals caution - Bloomberg', NOW - 3000e3),
    viaGn('Powell: no rush to cut rates | CNBC', NOW - 2000e3),
    viaGn('No tag on this one, cannot be attributed', NOW - 1000e3)
  ]);
  const { distinct } = coverage(c, NOW);
  assert.equal(distinct.size, 3, 'Reuters (direct + via GN), Bloomberg, CNBC; the unresolvable item counts as 0');
});

test('Vietnamese Google News items resolve to distinct outlets and dedupe against direct feeds', () => {
  const c = cluster([
    direct('vnexpress.net', 'Bão số 9 đổ bộ miền Trung, hàng nghìn người sơ tán'),
    viaGn('Bão số 9 đổ bộ miền Trung, hàng nghìn người sơ tán - VnExpress'),
    viaGn('Bão số 9 gây mưa lớn nhiều tỉnh miền Trung - Tuổi Trẻ', NOW - 3000e3),
    viaGn('Miền Trung ứng phó bão số 9, sơ tán dân - Thanh Niên', NOW - 2500e3),
    viaGn('Thủ tướng chỉ đạo ứng phó bão - Báo Dân trí', NOW - 2000e3)
  ]);
  assert.equal(coverage(c, NOW).distinct.size, 4);
});

test('a name-only publisher matches the direct feed whose domain label spells it', () => {
  const c = cluster([direct('thenextweb.com', 'Cursor runs Chinese AI models, House report finds'), viaGn('House report: US startups rely on Chinese AI models - The Next Web')]);
  assert.equal(coverage(c, NOW).distinct.size, 1);
  assert.deepEqual(outletGroups([{ title: 'a b c' }, { title: 'x y z' }], ['thenextweb.com', 'thenextweb']), [0, 0]);
});

test('unresolvable aggregator items still count as 0, and the corroboration features keep treating the aggregator as one outlet', () => {
  const c = cluster([viaGn('One untagged headline', NOW - 3000e3), viaGn('Another untagged headline here', NOW - 2000e3)]);
  const cov = coverage(c, NOW);
  assert.equal(cov.distinct.size, 0);
  const tagged = cluster([viaGn('Story - Reuters', NOW - 3000e3), viaGn('A different story - Bloomberg', NOW - 2000e3)]);
  assert.equal(coverage(tagged, NOW).distinctAll.size, 1, 'model features unchanged: all aggregator items share one outlet');
});

test('aggregator-only story reaches tier 1 when three real publishers report it', () => {
  const c = cluster([
    viaGn('Chip export curbs widen to AI servers - Reuters', NOW - 3 * 3600e3),
    viaGn('US widens chip export curbs to AI servers - Bloomberg', NOW - 2 * 3600e3),
    viaGn('Washington tightens AI server chip exports | CNBC', NOW - 3600e3)
  ]);
  c.id = 'agg';
  const { byId } = scoreStories([c], { now: NOW, hotFloor: { minEligibility: 0 }, damper: 0 });
  assert.equal(byId.get('agg').outlets, 3);
  assert.equal(byId.get('agg').tier, 1);
});

test('Techmeme headlines resolve from the trailing (Author/Publisher)', () => {
  assert.equal(resolveAggregatorPublisher({ domain: 'techmeme.com', link: 'https://www.techmeme.com/261121/p1', title: 'Cade Metz asks how quantum computers may correct errors (Cade Metz/New York Times)' }), 'nytimes.com');
  assert.equal(resolveAggregatorPublisher({ domain: 'techmeme.com', link: 'https://www.techmeme.com/261121/p2', title: 'Amazon nears a deal to buy Decart (Financial Times)' }), 'ft.com');
});
