import { personalTerminal, personalFullyExcluded } from '../feedback/terminal.js';
import { systemLogMetadata } from '../feedback/log-metadata.js';
import { articleIdentity } from './identity.js';
import { retiredReason, retireSavedReasons } from './retired-reasons.js';
import { FILTER_VERSION, FILTER_STATE_KEY, SECTIONS, prefilterEnabled, evaluatePolicy, validReason, materialitySignals } from './policy.js';

const stores = new WeakMap();
const loadingStores = new WeakMap();
const metricSeen = new WeakMap();
const readBindings = new WeakMap();
// A process has one production DB. Records are also stamped onto derived
// candidates for worker transport/snapshots; this index synchronizes returned
// worker copies with the original candidates without reevaluating rules.
const live = new Map();
const MAX_RECORDS = 20000;
const MAX_AGE = 30 * 86400000;
const valid = decision => decision?.filterVersion === FILTER_VERSION && !retiredReason(decision.reasonCode);
export function decisionsFor(article) {
  if (!prefilterEnabled()) return {};
  if (article.smartTopPrefilterKey) return live.get(article.smartTopPrefilterKey) || article.smartTopPrefilter || {};
  if (!live.size) return article.smartTopPrefilter || {};
  // Old published objects may predate the metadata stamp. Bind their EXACT
  // revision once; this is a state lookup, never a rule or similarity check.
  let binding = readBindings.get(article);
  if (!binding || binding.title !== article.title || binding.content !== article.content || binding.link !== article.link || binding.description !== article.description || binding.summary !== article.summary) {
    binding = { key: articleIdentity(article).key, title: article.title, content: article.content, link: article.link, description:article.description, summary:article.summary };
    readBindings.set(article, binding);
  }
  return live.get(binding.key) || article.smartTopPrefilter || {};
}
export function terminalExcluded(article, section) {
  if (personalTerminal(article, section)) return true;
  const d = decisionsFor(article)[section];
  return valid(d) && d.section === section && d.status === 'exclude' && d.final === true;
}
export function filterDestinations(article, destinations) {
  return destinations.filter(section => !terminalExcluded(article, section));
}
export function fullyExcluded(article) {
  if (personalFullyExcluded(article)) return true;
  const sections = article.smartTopPrefilterSections;
  return prefilterEnabled() && Array.isArray(sections) && sections.length > 0 && sections.every(section => terminalExcluded(article, section));
}
export function stampDecisions(article) {
  if (prefilterEnabled() && article.smartTopPrefilterKey) article.smartTopPrefilter = decisionsFor(article);
  return article;
}

export async function getPrefilterStore(db, metrics = null) {
  if (!stores.has(db)) {
    if (!loadingStores.has(db)) loadingStores.set(db, loadPrefilterStore(db));
    try { await loadingStores.get(db); } finally { loadingStores.delete(db); }
  }
  const store = stores.get(db);
  if (metrics) store.metrics = metrics;
  return store;
}

async function loadPrefilterStore(db, metrics = null) {
  if (stores.has(db)) {
    const store = stores.get(db);
    if (metrics) store.metrics = metrics;
    return store;
  }
  let stored = await db.get(FILTER_STATE_KEY, { type: 'json' });
  if (typeof stored === 'string') { try { stored = JSON.parse(stored); } catch { stored = {}; } }
  const records = new Map();
  const index = new Map();
  const store = { records, index, metrics, dirty: false, revision: 0, pendingWrite: Promise.resolve(), persist: () => {
    const write = store.pendingWrite.then(async () => {
      if (!store.dirty) return;
      const revision = store.revision;
      await db.put(FILTER_STATE_KEY, JSON.stringify({ filterVersion: FILTER_VERSION, records: [...records.values()].slice(-MAX_RECORDS) }));
      if (store.revision === revision) store.dirty = false;
    });
    store.pendingWrite = write.catch(() => {});
    return write;
  } };
  const addIndex = record => {
    for (const [, key] of record.identity.keys) {
      for (const section of SECTIONS) {
        const decision = record.decisions[section];
        if (valid(decision) && decision.status === 'exclude' && decision.final) index.set(`${section}:${key}:${record.identity.revision}`, record);
      }
    }
    live.set(record.identity.key, record.decisions);
  };
  store.addIndex = addIndex;
  if (stored?.filterVersion === FILTER_VERSION) {
    for (const record of (stored.records || []).slice(-MAX_RECORDS)) {
      if (!record?.identity?.key || Date.now() - record.updatedAt > MAX_AGE) continue;
      if (retireSavedReasons(record)) { store.dirty = true; store.revision++; }
      records.set(record.identity.key, record);
      addIndex(record);
    }
  }
  stores.set(db, store);
  await store.persist();
  return store;
}
const count = (store, key) => { if (store.metrics) store.metrics[key] = (store.metrics[key] || 0) + 1; };
function saveDecision(store, article, identity, section, result, source, stage, reusedFrom = null) {
  let record = store.records.get(identity.key);
  if (!record) {
    record = { identity, decisions: {}, updatedAt: Date.now() };
    store.records.set(identity.key, record);
  }
  const old = record.decisions[section];
  if (valid(old) && old.final && old.status === 'exclude') return old;
  const decision = { ...systemLogMetadata(article, stage), ...result, section, policyScope: section, filterVersion: FILTER_VERSION,
    evaluatedAt: new Date().toISOString(), decisionSource: source,
    decisionId: `${identity.key}:${section}:${FILTER_VERSION}`, reusedFrom };
  record.decisions[section] = decision;
  record.updatedAt = Date.now();
  article.smartTopPrefilter = record.decisions;
  store.addIndex(record);
  store.dirty = true;
  store.revision++;
  if (decision.status === 'exclude' && decision.final) {
    count(store, `${section}_${source.startsWith('reused_') ? 'reused' : source}_exclusions`);
    if (store.metrics) {
      store.metrics.prefilterExcludedByReason ||= {};
      store.metrics.prefilterExcludedByReason[decision.reasonCode] = (store.metrics.prefilterExcludedByReason[decision.reasonCode] || 0) + 1;
    }
    console.log('[smart-top-filter]', JSON.stringify({ event: 'smart_top_prefilter', timestamp: decision.evaluatedAt,
      articleId: article.articleKey || article.guid || article.id || null, url: identity.url, title: article.title,
      source: article.feedTitle, feed: article.feedUrl, stage, ...decision }));
  } else if (process.env.SMART_TOP_VN_PREFILTER_DEBUG === 'true') {
    console.log('[smart-top-filter]', JSON.stringify({ title: article.title, stage, ...decision }));
  }
  return decision;
}

export function evaluateCandidate(store, article, sections, evaluator = evaluatePolicy, stage = 'pre_embedding') {
  if (!prefilterEnabled()) return article;
  const applicable = sections.filter(section => SECTIONS.includes(section));
  if (!applicable.length) return article;
  // Only derived candidate metadata is changed; raw RSS stores remain untouched.
  const identity = articleIdentity(article);
  article.smartTopPrefilterKey = identity.key;
  article.smartTopPrefilterSections = sections;
  article.smartTopPrefilter = store.records.get(identity.key)?.decisions || {};
  live.set(identity.key, article.smartTopPrefilter);
  for (const section of applicable) {
    if (personalTerminal(article, section)) continue;
    let firstEncounter = true;
    if (store.metrics) {
      let seen = metricSeen.get(store.metrics);
      if (!seen) { seen = new Set(); metricSeen.set(store.metrics, seen); }
      const key = `${identity.key}:${section}`;
      firstEncounter = !seen.has(key);
      seen.add(key);
      if (firstEncounter) count(store, `${section}_candidates_seen`);
    }
    const existing = decisionsFor(article)[section];
    if (valid(existing) && (existing.final || existing.deterministicChecked)) {
      if (firstEncounter && existing.final && existing.status === 'exclude') count(store, `${section}_reused_exclusions`);
      continue;
    }
    let reused;
    for (const [method, key] of identity.keys) {
      const prior = store.index.get(`${section}:${key}:${identity.revision}`);
      if (!prior) continue;
      reused = saveDecision(store, article, identity, section, prior.decisions[section], method, stage, prior.decisions[section].decisionId);
      break;
    }
    if (reused) continue;
    count(store, `${section}_deterministic_evaluations`);
    saveDecision(store, article, identity, section, { ...evaluator(article, section), deterministicChecked: true }, 'deterministic', stage);
  }
  // Bound in-memory history as well as the persisted cache. Evicted decisions
  // are simply unknown next time; no unbounded permanent KEEP whitelist.
  if (store.records.size > MAX_RECORDS) {
    const oldest = store.records.keys().next().value;
    const evicted = store.records.get(oldest);
    store.records.delete(oldest);
    live.delete(oldest);
    for (const [, key] of evicted.identity.keys) {
      for (const section of SECTIONS) {
        const lookup = `${section}:${key}:${evicted.identity.revision}`;
        if (store.index.get(lookup) === evicted) store.index.delete(lookup);
      }
    }
  }
  return article;
}
export async function acceptAiDecisions(db, articles, rows, stage) {
  if (!prefilterEnabled() || !Array.isArray(rows)) return;
  const store = await getPrefilterStore(db);
  for (const article of articles) {
    if (!article.smartTopPrefilterKey) continue;
    const identity = store.records.get(article.smartTopPrefilterKey)?.identity;
    if (!identity) continue;
    for (const section of article.smartTopPrefilterSections || []) {
      if (!SECTIONS.includes(section)) continue;
      const previous = decisionsFor(article)[section];
      if (valid(previous) && (previous.final || previous.aiChecked)) continue;
      const matching = rows.filter(row => row?.id === article.smartTopPrefilterKey && row.section === section);
      if (matching.length !== 1) continue; // missing/duplicated side output never causes a retry
      const row = matching[0];
      const overrides = materialitySignals(article, section);
      const exclude = row.decision === 'exclude' && row.confidence === 'high' && validReason(section, row.reasonCode) &&
        typeof row.reason === 'string' && row.reason.trim() && Array.isArray(row.materialitySignals) && !row.materialitySignals.length && !overrides.length;
      saveDecision(store, article, identity, section, { status: exclude ? 'exclude' : 'keep', final: Boolean(exclude), aiChecked: true, deterministicChecked: true,
        reasonCode: exclude ? row.reasonCode : null, reason: exclude ? row.reason.slice(0, 600) : 'AI side task did not establish a safe high-confidence exclusion.',
        signals: Array.isArray(row.signals) ? row.signals.filter(x => typeof x === 'string').slice(0, 12) : [],
        materialitySignals: overrides }, 'existing_ai', stage);
    }
  }
  await store.persist();
}
