import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy, FILTER_VERSION, validReason } from '../src/smart/prefilter/policy.js';
import { articleIdentity } from '../src/smart/prefilter/identity.js';
import { getPrefilterStore, evaluateCandidate, terminalExcluded, acceptAiDecisions } from '../src/smart/prefilter/state.js';
import { SIDE_POLICY } from '../src/smart/prefilter/ai.js';
import { filterLog } from '../src/smart/feedback/log.js';
import { prefilterConfiguration } from '../src/smart/prefilter/boundaries.js';
import { FILTER_POLICY_REVISION } from '../src/smart/prefilter/retired-reasons.js';

const codes = ['TECH_VN_ORDINARY_PRODUCT_OR_FEATURE', 'TECH_VN_OPINION_OR_POTENTIAL', 'VN_ROUTINE_SPORTS', 'VN_NEWS_ROUTINE_SPORTS'];
let serial = 0;
const article = title => ({ title, link: `https://allowed.fixture/${++serial}`, feedTitle: 'Fixture', smartCategory: 'tech_vietnam' });
const fixture = (initial = {}) => {
  const values = { ...initial };
  return { values, async get(key) { return typeof values[key] === 'string' ? JSON.parse(values[key]) : values[key]; }, async put(key, value) { values[key] = value; } };
};

test('product updates, opinion/potential and sports survive the early policy in both sections', () => {
  for (const section of ['tech_vietnam', 'news_vietnam']) {
    for (const title of [
      'New app feature launches', 'VssID có thêm một thay đổi',
      'Robot hút bụi giá rẻ không còn được người Việt ưa chuộng',
      'Experts say Vietnam has potential', 'Chuyên gia: cơ hội cho công nghệ Việt',
      'Vietnam football team wins match', 'SEA Games medal result',
    ]) assert.equal(evaluatePolicy(article(title), section).status, 'keep', `${section}: ${title}`);
    for (const code of codes) assert.equal(validReason(section, code), false);
  }
  assert.match(SIDE_POLICY, /routine sports are allowed/);
  for (const code of codes) assert.equal(SIDE_POLICY.includes(code), false);
  assert.ok(prefilterConfiguration().includes(FILTER_POLICY_REVISION));
});

test('retired decisions on already published cards fail open before store hydration', () => {
  for (const reasonCode of codes) {
    const section = reasonCode === 'VN_NEWS_ROUTINE_SPORTS' ? 'news_vietnam' : 'tech_vietnam';
    const row = article('Previously excluded story');
    row.smartTopPrefilter = { [section]: { section, status: 'exclude', final: true, reasonCode, filterVersion: FILTER_VERSION } };
    assert.equal(terminalExcluded(row, section), false);
  }
});

test('saved retired exclusions are removed and persisted, preserving other section decisions and personal rules', async () => {
  for (const reasonCode of codes) {
    const row = article('Existing saved record'), identity = articleIdentity(row);
    const allowed = { section: 'news_vietnam', status: 'exclude', final: true, reasonCode: 'VN_NEWS_CEREMONIAL_EVENT_ONLY', filterVersion: FILTER_VERSION };
    const personal = { version: 1, rules: [{ id: 'personal', active: true }], events: [], decisions: [], traits: {} };
    const db = fixture({
      smartTopPrefilterState: { filterVersion: FILTER_VERSION, records: [{ identity, updatedAt: Date.now(), decisions: {
        tech_vietnam: { section: 'tech_vietnam', status: 'exclude', final: true, reasonCode, filterVersion: FILTER_VERSION }, news_vietnam: allowed,
      } }] }, smartPersonalFilters: personal,
    });
    const store = await getPrefilterStore(db);
    assert.equal(store.records.get(identity.key).decisions.tech_vietnam, undefined);
    assert.deepEqual(store.records.get(identity.key).decisions.news_vietnam, allowed);
    assert.equal(JSON.parse(db.values.smartTopPrefilterState).records[0].decisions.tech_vietnam, undefined);
    assert.equal(terminalExcluded(row, 'tech_vietnam'), false);
    assert.equal(terminalExcluded(row, 'news_vietnam'), true);
    const log = await filterLog(db, { origin: 'system_editorial' });
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0].humanReason, 'Routine ceremony');
    assert.equal(db.values.smartPersonalFilters, personal);
  }
});

test('AI output from an old cached prompt cannot restore any retired exclusion', async () => {
  for (const reasonCode of codes) {
    const section = reasonCode === 'VN_NEWS_ROUTINE_SPORTS' ? 'news_vietnam' : 'tech_vietnam';
    const row = article('An ambiguous story'), db = fixture(), store = await getPrefilterStore(db);
    evaluateCandidate(store, row, [section]);
    await acceptAiDecisions(db, [row], [{ id: row.smartTopPrefilterKey, section, decision: 'exclude', confidence: 'high', reasonCode, reason: 'Old policy reason', materialitySignals: [], signals: [] }], 'event_verification');
    assert.equal(terminalExcluded(row, section), false);
  }
});
