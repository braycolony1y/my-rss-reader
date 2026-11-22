import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy, FILTER_VERSION } from '../src/smart/prefilter/policy.js';
import { getPrefilterStore, evaluateCandidate, terminalExcluded, fullyExcluded, decisionsFor } from '../src/smart/prefilter/state.js';
import { preparePrefilterCandidates, survivingArticles, survivingGroups, aiSideCandidates } from '../src/smart/prefilter/boundaries.js';
import { sourceWorkView } from '../src/smart/prefilter/source-work.js';
import { extendAiReview, acceptAiSideTask, primaryDecision, normalizeWithSideTask, requestWithOptionalSideTask } from '../src/smart/prefilter/ai.js';
import { articleIdentity } from '../src/smart/prefilter/identity.js';
import { allowedDestinations } from '../src/articles/top-stories.js';
import { buildPublicationClusterSnapshot } from '../src/smart/clustering/publication-snapshot.js';
import { PARTITION_RESPONSE_SCHEMA } from '../src/smart/verification/schemas.js';
import { validatePartitionResult } from '../src/smart/verification/validation.js';
import { getArticleId } from '../src/smart/articles/identity.js';
import { requestClusteringDecision } from '../src/ai/clustering-json.js';

let serial = 0;
const dbFixture = (values = {}) => ({ values,
  get: async (key, options) => values[key] == null ? null : options?.type === 'json' ? JSON.parse(values[key]) : values[key],
  put: async (key, value) => { values[key] = value; },
});
const article = (title, extra = {}) => ({ title, link: `https://fixture.test/${++serial}`, feedUrl: 'https://fixture.test/rss', feedTitle: 'Fixture', pubDate: new Date().toISOString(), smartCategory: 'tech', language: 'vi', ...extra });
const tech = 'tech_vietnam', news = 'news_vietnam';
const sourcesFor = section => [{ url: 'https://fixture.test/rss', category: section, enabled: true }];

const newsKeep = [
  'Major court ruling changes detention procedure', 'New national health policy', 'Major disease outbreak',
  'Serious flood causes evacuations', 'Major education reform changes the school system',
  'Significant diplomatic agreement', 'Major corruption investigation', 'Important public infrastructure decision',
  'Major environmental pollution incident', 'National security emergency',
  'Survey reveals major deterioration in child mortality', 'Ranking data reveals a billion dollar investment shift',
  'Generic government digital-development policy discussion',
  'Học sinh Việt Nam giành 10 huy chương Olympic thiên văn quốc tế',
  'Việt Nam thắng lớn tại Olympic Thiên văn và Vật lý thiên văn quốc tế',
  'Students win medals at the mathematics Olympiad',
];
const techKeep = [
  'Conference announces $2 billion semiconductor factory', 'MoU establishes binding funded JV',
  'Pilot deploys national critical infrastructure', '2030 target with factory construction underway',
  'Việt Nam lần đầu chế tạo thiết bị điện 500 kV thay thế hàng nhập khẩu',
  'Việt Nam nghiên cứu tự sản xuất thiết bị lưới 500 kV', "Website doanh nghiệp tại Việt Nam 'sập' hàng loạt",
  'Major data center opens', 'Major telecom infrastructure deployment', 'Large committed investment',
  'Binding technology regulation enacted', 'Major cybersecurity breach', 'Completed acquisition',
  'Domestic factory begins production', 'Serious technology transfer', 'Major supply-chain shift',
];
const techExclude = [
  ['Vietnam rises in innovation index', 'TECH_VN_RANKING_OR_INDEX'],
  ['95% doanh nghiệp Việt dùng AI', 'TECH_VN_SURVEY_OR_ADOPTION_STAT'],
  ['Việt Nam có thể trở thành trung tâm AI của ASEAN vào năm 2030', 'TECH_VN_GENERIC_TARGET_OR_AMBITION'],
  ['Routine technology conference opens', 'TECH_VN_EVENT_OR_EXHIBITION'],
  ['Gian hàng nổi bật tại triển lãm đổi mới sáng tạo', 'TECH_VN_EVENT_OR_EXHIBITION'],
  ['15 công trình thắng giải sáng kiến', 'TECH_VN_AWARD_OR_CONTEST'],
  ['Company signs non-binding MoU for vague cooperation', 'TECH_VN_NON_BINDING_PARTNERSHIP'],
  ['A small pilot demonstrates a robot', 'TECH_VN_MINOR_PILOT_OR_DEMO'],
  ['A digital-skills training workshop', 'TECH_VN_EVENT_OR_EXHIBITION'],
  ['University networking program', 'TECH_VN_MINOR_TRAINING_OR_RESEARCH'],
  ['Company launches internal AI assistant', 'TECH_VN_CORPORATE_TECH_PR'],
  ['Province digitizes routine records', 'TECH_VN_MINOR_LOCAL_DIGITALIZATION'],
];
for (const title of newsKeep) test(`News keeps ${title}`, () => assert.equal(evaluatePolicy(article(title), news).status, 'keep'));
for (const title of techKeep) test(`Tech keeps ${title}`, () => assert.equal(evaluatePolicy(article(title), tech).status, 'keep'));
for (const [title, reason] of techExclude) test(`Tech excludes ${title}`, () => assert.equal(evaluatePolicy(article(title), tech).reasonCode, reason));
for (const title of ['Province rises one place in generic ranking', 'Ceremonial speech says locality aims to modernize by 2045', 'Routine ceremony with no substantive development']) {
  test(`News excludes obvious low value: ${title}`, () => assert.equal(evaluatePolicy(article(title), news).status, 'exclude'));
}
for (const section of [news, tech]) test(`${section}: sports and public consequence`, () => {
  assert.equal(evaluatePolicy(article('Vietnam football team wins match'), section).status, 'keep');
  assert.equal(evaluatePolicy(article('National football team wins Olympic medal'), section).status, 'keep');
  assert.equal(evaluatePolicy(article('Football stadium collapse causes emergency investigation'), section).status, 'keep');
});

test('terminal section decision runs evaluator once; never rechecks or leaks to News', async () => {
  const db = dbFixture(), metrics = {}, store = await getPrefilterStore(db, metrics);
  const a = article('95% doanh nghiệp Việt dùng AI');
  let calls = 0;
  const evaluate = (...args) => { calls++; return evaluatePolicy(...args); };
  evaluateCandidate(store, a, [tech, news], evaluate);
  assert.equal(calls, 2);
  assert.equal(terminalExcluded(a, tech), true);
  assert.equal(terminalExcluded(a, news), false);
  assert.equal(fullyExcluded(a), false);
  evaluateCandidate(store, a, [tech, news], () => { throw Error('reevaluated'); });
  assert.deepEqual(allowedDestinations(a, [...sourcesFor(tech), ...sourcesFor(news)]), [news]);
  assert.equal(a.title, '95% doanh nghiệp Việt dùng AI');
});

for (const section of [news, tech]) {
  for (const kind of ['identity', 'url', 'title', 'boilerplate', 'content']) test(`${section} safe reuse: ${kind}`, async () => {
    const db = dbFixture(), store = await getPrefilterStore(db);
    const title = section === tech ? '95% doanh nghiệp Việt dùng AI' : 'Province rises one place in generic ranking';
    const a = article(title, { link: `https://vnexpress.net/reuse-${++serial}.html`, articleKey: `trusted-${serial}`, contentHash: `hash-${serial}` });
    evaluateCandidate(store, a, [section]);
    const b = { ...a, smartTopPrefilter: undefined, smartTopPrefilterKey: undefined };
    if (kind === 'url') b.link += '?utm_source=rss#fragment';
    if (kind === 'title') { b.link = `https://other.test/${++serial}`; b.articleKey = 'other'; b.contentHash = ''; b.title = `  ${title}  `; }
    if (kind === 'boilerplate') { b.link = `https://vnexpress.net/other-${++serial}.html`; b.articleKey = 'other'; b.contentHash = ''; b.title += ' - VnExpress'; }
    evaluateCandidate(store, b, [section], () => { throw Error('reuse must not evaluate'); });
    assert.equal(terminalExcluded(b, section), true);
    await store.persist();
    const reopened = await getPrefilterStore(dbFixture({ ...db.values }));
    evaluateCandidate(reopened, { ...b }, [section], () => { throw Error('persisted terminal state must not evaluate'); });
  });
}

for (const suffix of [', invests $2 billion in a factory', '? Government denies this', ', completed acquisition', ', court opens investigation', ', 10 people killed', ', rollout cancelled', ', approved today', ', new scope and date']) {
  test(`changed evidence blocks reuse: ${suffix}`, async () => {
    const store = await getPrefilterStore(dbFixture());
    const a = article('95% doanh nghiệp Việt dùng AI');
    evaluateCandidate(store, a, [tech]);
    let calls = 0;
    const b = { ...a, title: a.title + suffix };
    evaluateCandidate(store, b, [tech], () => { calls++; return { status: 'keep', final: false }; });
    assert.equal(calls, 1); assert.equal(terminalExcluded(b, tech), false);
  });
}
test('new body at same URL and exact title is not blindly reused; query IDs preserved', async () => {
  const store = await getPrefilterStore(dbFixture());
  const a = article('95% doanh nghiệp Việt dùng AI'); evaluateCandidate(store, a, [tech]);
  const b = { ...a, content: 'A major factory investment was committed.' };
  evaluateCandidate(store, b, [tech]); assert.equal(terminalExcluded(b, tech), false);
  assert.notEqual(articleIdentity({ ...a, link: 'https://fixture.test/read?id=1' }).url, articleIdentity({ ...a, link: 'https://fixture.test/read?id=2' }).url);
  assert.notEqual(articleIdentity({ ...a, title: 'Do not ban AI' }).revision, articleIdentity({ ...a, title: 'Do ban AI' }).revision);
});

test('filter version invalidates stale exclusions', async () => {
  const a = article('An ambiguous development');
  a.smartTopPrefilter = { [tech]: { status: 'exclude', final: true, section: tech, filterVersion: 'obsolete' } };
  assert.equal(terminalExcluded(a, tech), false);
  const store = await getPrefilterStore(dbFixture()); let calls = 0;
  evaluateCandidate(store, a, [tech], () => { calls++; return { status: 'keep', final: false }; });
  assert.equal(calls, 1);
});

for (const section of [news, tech]) test(`${section}: stable A C E survivors; B D never embed/cluster/rank`, async () => {
  const db = dbFixture(), metrics = {};
  const input = ['A', 'B', 'C', 'D', 'E'].map(id => article(['B','D'].includes(id) ? 'Province rises one place in generic ranking' : `Ambiguous story ${id}`, { fixtureId: id, content: id }));
  const before = structuredClone(input);
  const survivors = await preparePrefilterCandidates({ db, articles: input, sources: sourcesFor(section), metrics });
  const calls = { embedding: [], cluster: [], ranking: [] };
  for (const stage of Object.keys(calls)) for (const a of survivingArticles(survivors)) calls[stage].push(a.fixtureId);
  for (const values of Object.values(calls)) assert.deepEqual(values, ['A','C','E']);
  assert.deepEqual(input, before, 'ordinary RSS input remains intact');
  for (const a of survivors) for (const key of Object.keys(before[0])) assert.deepEqual(a[key], before.find(x => x.fixtureId === a.fixtureId)[key]);
  assert.equal(metrics.prefilterEmbeddingsAvoided, 2);
});

test('early source gate excludes only Smart-specific work and preserves raw entries', async () => {
  const db = dbFixture();
  const rows = [{ articles: [article('Province rises one place in generic ranking'), article('Major court ruling')] }];
  const view = await sourceWorkView(db, rows, sourcesFor(news));
  assert.equal(view[0].articles.length, 1); assert.equal(rows[0].articles.length, 2);
  const mixed = await sourceWorkView(dbFixture(), [{ articles: [article('95% doanh nghiệp Việt dùng AI')] }], [{ url: 'https://fixture.test/rss', category: 'tech' }]);
  assert.equal(mixed[0].articles.length, 1); // still needs Global shared work
  assert.deepEqual(allowedDestinations(mixed[0].articles[0], [{ url:'https://fixture.test/rss',category:'tech' }]), ['tech_global']);
});

for (const confidence of ['high', 'medium', 'low']) test(`same required AI call, ${confidence} confidence side decision`, async () => {
  const db = dbFixture(), store = await getPrefilterStore(db);
  const a = article('A business technology update'); evaluateCandidate(store, a, [tech]);
  const group = { articles: [a] };
  const spec = extendAiReview(group, null, 'PRIMARY PROMPT', PARTITION_RESPONSE_SCHEMA);
  assert.ok(spec.prompt.startsWith('PRIMARY PROMPT')); assert.ok(spec.schema.properties.smartTopPrefilter);
  assert.deepEqual(spec.schema.required, PARTITION_RESPONSE_SCHEMA.required);
  let calls = 0;
  const side = { id: a.smartTopPrefilterKey, section: tech, decision: 'exclude', confidence, reasonCode: 'TECH_VN_CORPORATE_TECH_PR', reason: 'Only routine internal assistant publicity.', signals: ['pr'], materialitySignals: [] };
  const response = { clusters: [{ articleIds: [getArticleId(a)], confidence: 1 }], uncertain: false, smartTopPrefilter: [side] };
  const parsed = await requestClusteringDecision({ request: async () => { calls++; return JSON.stringify(response); }, validate: value => validatePartitionResult(primaryDecision(value), [a]), schema: PARTITION_RESPONSE_SCHEMA });
  await acceptAiSideTask(db, group, parsed, 'event_verification');
  assert.equal(calls, 1, 'baseline 1 / after 1');
  assert.equal(terminalExcluded(a, tech), confidence === 'high');
  assert.equal(aiSideCandidates([a]).length, 0, 'no later AI vote');
  const groups = survivingGroups([{ articles: [a] }]);
  assert.equal(groups.length, confidence === 'high' ? 0 : 1);
  assert.equal(decisionsFor(a)[tech].aiChecked, true);
  console.log('PREFILTER_AI_REQUEST_COUNT', JSON.stringify({ before: 1, after: calls, confidence }));
});

test('malformed/missing side output cannot trigger a repair or a second side decision', async () => {
  for (const side of [undefined, null, 'wrong', [{ id: 'unknown', decision: 'exclude' }]]) {
    const db = dbFixture(), store = await getPrefilterStore(db), a = article('Ambiguous technology update');
    evaluateCandidate(store, a, [tech]); let calls = 0;
    const response = { clusters: [{ articleIds: [getArticleId(a)] }], uncertain: false, smartTopPrefilter: side };
    const parsed = await requestClusteringDecision({ request: async () => { calls++; return JSON.stringify(response); }, validate: value => validatePartitionResult(primaryDecision(value), [a]), schema: PARTITION_RESPONSE_SCHEMA });
    await acceptAiSideTask(db, { articles: [a] }, parsed, 'event_verification');
    assert.equal(calls, 1); assert.equal(terminalExcluded(a, tech), false); assert.equal(aiSideCandidates([a]).length, 0);
  }
});

test('provider normalization preserves side field without weakening primary normalization', () => {
  const raw = JSON.stringify({ clusters: [{ articleIds: ['a'] }], uncertain: false, smartTopPrefilter: [{ id: 'a' }] });
  let normalized = 0;
  const result = normalizeWithSideTask(raw, primary => { normalized++; assert.equal(Object.hasOwn(JSON.parse(primary), 'smartTopPrefilter'), false); return primary; });
  assert.equal(normalized, 1); assert.deepEqual(JSON.parse(result).smartTopPrefilter, [{id:'a'}]);
});

test('AI terminal exclusion is removed from final snapshot and old retained clusters', async () => {
  const db = dbFixture(), store = await getPrefilterStore(db);
  const a = article('Ambiguous corporate announcement'); evaluateCandidate(store, a, [tech]);
  await acceptAiSideTask(db, {articles:[a]}, {smartTopPrefilter:[{id:a.smartTopPrefilterKey,section:tech,decision:'exclude',confidence:'high',reasonCode:'TECH_VN_CORPORATE_TECH_PR',reason:'Routine internal assistant publicity',signals:[],materialitySignals:[]}]}, 'event_verification');
  const snapshot = buildPublicationClusterSnapshot({ candidates:[a], autoMergedClusters:[{articles:[a]}], reviewedClusters:[], reviewGroups:[], clusterVersionChanged:false, existingClusters:[{...a,clusterId:'old'}], isTargeted:false, storyIdRetentionClusters:[] });
  assert.equal(snapshot.clusters.length,0);
});

test('kill switch restores untouched inputs, routing, prompt and schema', async () => {
  const db = dbFixture(), store = await getPrefilterStore(db), a = article('95% doanh nghiệp Việt dùng AI');
  evaluateCandidate(store,a,[tech]); assert.equal(terminalExcluded(a,tech),true);
  const old = process.env.SMART_TOP_VN_PREFILTER_ENABLED;
  process.env.SMART_TOP_VN_PREFILTER_ENABLED='false';
  try {
    const input=[a]; assert.equal(await preparePrefilterCandidates({db,articles:input,sources:sourcesFor(tech),metrics:{}}),input);
    assert.deepEqual(allowedDestinations(a,sourcesFor(tech)),[tech]);
    const spec = extendAiReview({articles:[a]},null,'primary',PARTITION_RESPONSE_SCHEMA);
    assert.equal(spec.schema.properties.smartTopPrefilter, undefined);
    assert.ok(spec.schema.properties.personalSmartFeedback); // independent personal side task
    assert.ok(spec.prompt.startsWith('primary'));
    assert.equal(terminalExcluded(a,tech),false);
  } finally { if(old===undefined) delete process.env.SMART_TOP_VN_PREFILTER_ENABLED; else process.env.SMART_TOP_VN_PREFILTER_ENABLED=old; }
});

test('truncated optional side tail cannot cause a new primary repair request', async () => {
  const a = article('Uncertain announcement'); let calls = 0;
  const primary = JSON.stringify({clusters:[{articleIds:[getArticleId(a)]}],uncertain:false});
  const parsed = await requestClusteringDecision({
    request: () => requestWithOptionalSideTask(async () => { calls++; return primary.slice(0,-1) + ',"smartTopPrefilter":[{"id":"truncated'; }),
    validate: value => validatePartitionResult(value,[a]), schema:PARTITION_RESPONSE_SCHEMA,
  });
  assert.equal(calls,1); assert.equal(parsed.clusters.length,1);
});

test('concurrent readers share one authoritative store and ordered writes preserve new decisions', async () => {
  let reads=0;const values={};
  const db={get:async()=>{reads++;await new Promise(resolve=>setImmediate(resolve));return null;},put:async(key,value)=>{await new Promise(resolve=>setImmediate(resolve));values[key]=value;}};
  const [left,right]=await Promise.all([getPrefilterStore(db),getPrefilterStore(db)]);
  assert.equal(left,right);assert.equal(reads,1);
  evaluateCandidate(left,article('Province rises one place in generic ranking'),[news]);
  const first=left.persist();
  await new Promise(resolve=>setImmediate(resolve));
  evaluateCandidate(right,article('95% doanh nghiệp Việt dùng AI'),[tech]);
  await Promise.all([first,right.persist()]);
  const stored=JSON.parse(values.smartTopPrefilterState);
  assert.equal(stored.records.length,2);
});

test('mixed cluster cannot regain excluded Tech eligibility through a News-only member', async () => {
  const {smartEditorialEligibleDestinations}=await import('../src/ai/smart-editorial.js');
  const store=await getPrefilterStore(dbFixture());
  const t=article('95% doanh nghiệp Việt dùng AI',{feedUrl:'https://fixture.test/tech'});
  const n=article('A public-interest survey',{feedUrl:'https://fixture.test/news'});
  evaluateCandidate(store,t,[tech,'tech_global']);
  evaluateCandidate(store,n,[news]);
  const sources=[{url:t.feedUrl,category:'tech'},{url:n.feedUrl,category:news}];
  assert.deepEqual(smartEditorialEligibleDestinations({...t,relatedArticles:[n]},sources),[news,'tech_global']);
});
