import test from 'node:test';
import assert from 'node:assert/strict';
import { getArticleId } from '../src/smart/articles/identity.js';
import { extractEvidence, extractNumbers } from '../src/smart/clustering/resolver-evidence.js';
import { scorePair, resolveReviewGroup, resolveAmbiguousGroups, RESOLVER_CONFIG } from '../src/smart/clustering/resolver.js';
import { integrateIncrementalReviews, prepareIncrementalReviewGroups, deferredReviewPartitions } from '../src/smart/clustering/review-groups.js';
import { buildPublicationClusterSnapshot } from '../src/smart/clustering/publication-snapshot.js';
import { canReuseSmartSnapshot } from '../src/smart/refresh/reuse-policy.js';

const T0 = Date.parse('2026-11-20T08:00:00.000Z');
const at = hours => new Date(T0 + hours * 3600_000).toISOString();
const article = (name, title, { hours = 0, description = '', language = 'en', extra = {} } = {}) => ({
  link: `https://${name}.test/story`, articleKey: `https://${name}.test/story`, title, description, language,
  pubDate: at(hours), smartCategory: 'news_global', feedTitle: name, ...extra
});

// Vectors with a chosen cosine to the reference direction (1, 0).
const unitAt = cosine => [cosine, Math.sqrt(1 - cosine * cosine)];
const vectors = (map) => article => map.get(article.link) || null;
const pairVectors = (a, b, cosine) => vectors(new Map([[a.link, [1, 0]], [b.link, unitAt(cosine)]]));

const boeingA = article('wire-a', 'Boeing agrees to $4.3 billion settlement with Justice Department in Seattle', { hours: 0 });
const boeingB = article('wire-b', 'Justice Department reaches $4.3 billion settlement with Boeing', { hours: 2 });

test('evidence extraction finds entities, money, percent and places and folds diacritics', () => {
  const evidence = extractEvidence(article('x', 'Thủ tướng Phạm Minh Chính thăm Hà Nội, cam kết 25 tỷ USD', { language: 'vi' }));
  assert.ok(evidence.places.has('ha noi'));
  assert.ok([...evidence.phrases].some(phrase => phrase.startsWith('pham minh')));
  assert.equal(extractNumbers('25 tỷ USD').has('money:25000000000'), true);
  assert.equal(extractNumbers('$25 billion').has('money:25000000000'), true);
  assert.equal(extractNumbers('Giá tăng 3,5%').has('percent:3.5'), true);
  assert.equal(extractNumbers('năm 2026 và 12 người').size, 0);
  assert.equal(extractNumbers('1.250.000 đồng').has('money:1250000'), true);
});

test('strong shared evidence merges: shared entity plus money amount plus close timestamps', () => {
  const score = scorePair(boeingA, boeingB, { vectorOf: pairVectors(boeingA, boeingB, 0.92) });
  assert.equal(score.merge, true);
  assert.ok(score.points >= RESOLVER_CONFIG.minPoints);
  assert.ok(score.entityPoints >= 1 && score.numberPoints === 2 && score.timePoints === 1);
});

test('a high cosine alone never merges: no shared entities or numbers', () => {
  const a = article('a', 'Apple unveils a new phone with a faster chip');
  const b = article('b', 'Apple shares slide after a weak quarterly outlook', { hours: 1 });
  const score = scorePair(a, b, { vectorOf: pairVectors(a, b, 0.93) });
  assert.equal(score.merge, false);
  assert.equal(score.reason, 'insufficient_evidence');
});

test('gates: cosine below the review band, missing vector, distance in time, other language, hard conflict', () => {
  const low = scorePair(boeingA, boeingB, { vectorOf: pairVectors(boeingA, boeingB, 0.89) });
  assert.equal(low.merge, false); assert.equal(low.reason, 'below_review_band');
  assert.equal(scorePair(boeingA, boeingB, { vectorOf: () => null }).reason, 'no_vector');
  const late = { ...boeingB, pubDate: at(60) };
  assert.equal(scorePair(boeingA, late, { vectorOf: pairVectors(boeingA, late, 0.95) }).reason, 'too_far_apart_in_time');
  const vietnamese = { ...boeingB, language: 'vi' };
  assert.equal(scorePair(boeingA, vietnamese, { vectorOf: pairVectors(boeingA, vietnamese, 0.95) }).reason, 'cross_language');
  const conflicted = { ...boeingA, eventDate: '2026-11-01' }, other = { ...boeingB, eventDate: '2026-11-19' };
  assert.equal(scorePair(conflicted, other, { vectorOf: pairVectors(conflicted, other, 0.95) }).reason, 'event_conflict');
  const undated = { ...boeingB, pubDate: '' };
  assert.equal(scorePair(boeingA, undated, { vectorOf: pairVectors(boeingA, undated, 0.95) }).reason, 'unknown_time');
});

test('a place alone is not enough without an entity point', () => {
  const a = article('a', 'Storm hits Hanoi overnight', { description: 'Heavy rain flooded streets across Hanoi, Vietnam.' });
  const b = article('b', 'Heavy rain floods streets in Hanoi, Vietnam', { hours: 1 });
  const score = scorePair(a, b, { vectorOf: pairVectors(a, b, 0.93) });
  assert.equal(score.merge, false);
});

test('a country-level place is not the place point, a city or province still is', () => {
  const mk = place => [
    article('a', `Samsung Electronics and Galaxy Fold sales surge in ${place}`),
    article('b', `Samsung Electronics hires staff and Galaxy Fold supply grows in ${place}`, { hours: 1 })
  ];
  const [ca, cb] = mk('China');
  const country = scorePair(ca, cb, { vectorOf: pairVectors(ca, cb, 0.93) });
  assert.equal(country.placePoints, 0);
  assert.equal(country.merge, false, 'a shared country must not produce a false merge');
  const [va, vb] = mk('Vietnam');
  assert.equal(scorePair(va, vb, { vectorOf: pairVectors(va, vb, 0.93) }).placePoints, 0);
  const [ha, hb] = mk('Da Nang');
  const city = scorePair(ha, hb, { vectorOf: pairVectors(ha, hb, 0.93) });
  assert.equal(city.placePoints, 1);
  assert.equal(city.merge, true);
});

test('resolveReviewGroup merges components on strong evidence and keeps the rest separate', () => {
  const unrelated = article('other', 'Local council approves new bus lanes downtown', { hours: 1 });
  const group = { id: 'g1', fullRepartition: false, articles: [boeingA, boeingB, unrelated],
    deferredComponents: [[boeingA], [boeingB], [unrelated]], reviewUniverse: [boeingA, boeingB, unrelated] };
  const map = new Map([[boeingA.link, [1, 0]], [boeingB.link, unitAt(0.92)], [unrelated.link, unitAt(0.5)]]);
  const { partitions, merges } = resolveReviewGroup(group, { vectorOf: vectors(map) });
  assert.equal(merges.length, 1);
  assert.equal(partitions.length, 1, 'only the merge is emitted for a non-repartition group');
  assert.deepEqual(partitions[0].articles.map(getArticleId).sort(), [boeingA, boeingB].map(getArticleId).sort());
  assert.equal(partitions[0].verification.method, 'deterministic_resolver');
  assert.equal(partitions[0].verified, true);
});

test('a full repartition emits every component so nothing is lost; unmerged ones stay separate', () => {
  const unrelated = article('other', 'Local council approves new bus lanes downtown', { hours: 1 });
  const group = { id: 'g2', fullRepartition: true, articles: [boeingA, unrelated], deferredComponents: [[boeingA], [unrelated]], reviewUniverse: [boeingA, unrelated] };
  const { partitions, merges } = resolveReviewGroup(group, { vectorOf: vectors(new Map([[boeingA.link, [1, 0]], [unrelated.link, unitAt(0.91)]])) });
  assert.equal(merges.length, 0);
  assert.equal(partitions.length, 2);
  assert.ok(partitions.every(partition => partition.verification.method === 'kept_separate'));
});

test('no vectors at all means everything stays separate (conservative)', () => {
  const group = { id: 'g3', fullRepartition: false, articles: [boeingA, boeingB], deferredComponents: [[boeingA], [boeingB]], reviewUniverse: [boeingA, boeingB] };
  const result = resolveAmbiguousGroups([group], { vectorOf: () => null });
  assert.equal(result.clusters.length, 0);
  assert.equal(result.ambiguousGroupsKeptSeparate, 1);
  assert.equal(result.mergedComponentPairs, 0);
});

test('resolver output integrates into the established clusters', () => {
  const group = { id: 'g4', fullRepartition: false, articles: [boeingA, boeingB], deferredComponents: [[boeingA], [boeingB]], reviewUniverse: [boeingA, boeingB] };
  const { clusters } = resolveAmbiguousGroups([group], { vectorOf: pairVectors(boeingA, boeingB, 0.92) });
  const automatic = [{ id: 'c1', articles: [boeingA], verification: { method: 'kept_separate' } }, { id: 'c2', articles: [boeingB], verification: { method: 'kept_separate' } }];
  const groups = integrateIncrementalReviews(automatic, clusters, [group]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].articles.length, 2);
  assert.equal(groups[0].verification.method, 'deterministic_resolver');
});

test('a merge that fails structural validation is skipped instead of failing the refresh', () => {
  // Titles share nothing, so the token-based connectivity check in the publication step rejects the pair.
  const a = article('a', 'Boeing agrees to $4.3 billion settlement', { hours: 0 });
  const b = { ...boeingB, title: 'Justice Department $4.3 billion' };
  const forced = [{ reviewRequestId: 'g5', id: 'p', articles: [a, b], verified: true, verification: { method: 'deterministic_resolver' } }];
  const automatic = [{ id: 'c1', articles: [a] }, { id: 'c2', articles: [b] }];
  const groups = integrateIncrementalReviews(automatic, forced, [{ id: 'g5', articles: [a, b], deferredComponents: [[a], [b]] }]);
  assert.equal(groups.length, 2);
  assert.ok(groups.every(group => group.articles.length === 1));
});

test('resolution is deterministic regardless of input order', () => {
  const unrelated = article('other', 'Local council approves new bus lanes downtown', { hours: 1 });
  const base = { id: 'g6', fullRepartition: true };
  const map = new Map([[boeingA.link, [1, 0]], [boeingB.link, unitAt(0.92)], [unrelated.link, unitAt(0.5)]]);
  const one = resolveReviewGroup({ ...base, articles: [boeingA, boeingB, unrelated], deferredComponents: [[boeingA], [boeingB], [unrelated]] }, { vectorOf: vectors(map) });
  const two = resolveReviewGroup({ ...base, articles: [unrelated, boeingB, boeingA], deferredComponents: [[unrelated], [boeingB], [boeingA]] }, { vectorOf: vectors(map) });
  const key = result => result.partitions.map(partition => partition.articles.map(getArticleId).sort().join('+')).sort().join('|');
  assert.equal(key(one), key(two));
});

const snapshotOf = (articles, automatic, reviewed, reviewGroups) => buildPublicationClusterSnapshot({
  candidates: articles, autoMergedClusters: automatic, reviewedClusters: reviewed, reviewGroups,
  clusterVersionChanged: false, existingClusters: [], isTargeted: false, storyIdRetentionClusters: [], storyRelationships: []
});
const publishedIds = snapshot => snapshot.clusters.flatMap(cluster => [cluster, ...(cluster.relatedArticles || [])].map(getArticleId));

test('a full repartition resolved with no evidence still publishes every article exactly once', () => {
  const nasa = n => article(`nasa${n}`, `NASA launches Artemis rocket number ${n}`, { hours: n, description: `NASA launched the Artemis rocket ${n} from Kennedy Space Center on Monday.` });
  const articles = [1, 2, 3, 4].map(nasa);
  const automatic = [{ articles: [articles[0], articles[1]], established: true }, { articles: [articles[2], articles[3]], established: true }];
  const reviewGroups = prepareIncrementalReviewGroups([{ id: 'x', articles: [articles[0], articles[2]] }, { id: 'y', articles: [articles[1], articles[3]] }], automatic);
  assert.ok(reviewGroups[0].fullRepartition);
  const { clusters } = resolveAmbiguousGroups(reviewGroups, { vectorOf: () => null });
  const ids = publishedIds(snapshotOf(articles, automatic, clusters, reviewGroups));
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
});

test('a non-repartition group resolved with no evidence leaves the automatic clusters untouched', () => {
  const nasa = n => article(`nasa${n}`, `NASA launches Artemis rocket number ${n}`, { hours: n });
  const articles = [1, 2, 3, 4, 5, 6].map(nasa);
  const automatic = articles.map(a => ({ articles: [a], established: false }));
  const requests = [[0, 1], [2, 3], [4, 5]].map(([i, j], n) => ({ id: `g${n}`, articles: [articles[i], articles[j]], fullRepartition: false }));
  const reviewGroups = prepareIncrementalReviewGroups(requests, automatic);
  const { clusters, ambiguousGroupsKeptSeparate } = resolveAmbiguousGroups(reviewGroups, { vectorOf: () => null });
  assert.equal(ambiguousGroupsKeptSeparate, 3);
  assert.equal(snapshotOf(articles, automatic, clusters, reviewGroups).clusters.length, 6);
});

test('deferred partitions stay disjoint when stored and current components overlap', () => {
  const [a, b, c] = ['a', 'b', 'c'].map(name => article(name, `Story ${name}`));
  const partitions = deferredReviewPartitions({ id: 'g', articles: [a, b, c], deferredComponents: [[a, b], [a], [c]] }, 'resolver');
  const ids = partitions.flatMap(partition => partition.articles.map(getArticleId));
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
});

test('a snapshot with a recorded deferral is not reused', async () => {
  const db = { get: async key => key === 'smartDeferredReviewGroups' ? { groups: [{ reason: 'time_budget' }] } : key === 'smartClusteringAlgorithmVersion' ? 'x' : null };
  assert.equal(await canReuseSmartSnapshot({ forceRebuild: false, currentSignature: 's', previousSignature: 's', previousAiConfiguration: 'c', aiConfiguration: 'c', db }), false);
});
