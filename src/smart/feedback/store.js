import { randomUUID, createHash } from 'node:crypto';
import { articleIdentity } from '../prefilter/identity.js';
import { semantics as s } from './semantics.js';
import { identity } from './identity.js';
export { identity } from './identity.js';

export const USER_SMART_FILTER_VERSION = 1;
export const PERSONAL_STATE_KEY = 'smartPersonalFilters';
const stores = new WeakMap();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const members = article => [article, ...(article.relatedArticles || [])];
export function sameArticle(a, b) {
    if (a.clusterSignature && b.clusterSignature && a.clusterSignature !== b.clusterSignature) return false;
    if (a.materialVersion && b.materialVersion && a.materialVersion !== b.materialVersion) return false;
    // Exact normalized titles may share exclusion; changed titles/evidence never use fuzzy containment.
    return a.revision === b.revision && a.keys.some(key => b.keys.includes(key));
}
const empty = () => ({ version: USER_SMART_FILTER_VERSION, revision: 0, events: [], rules: [], decisions: [], traits: {} });
export async function getPersonalStore(db) {
    if (!stores.has(db)) stores.set(db, (async () => {
        let state = await db.get(PERSONAL_STATE_KEY, { type: 'json' });
        if (typeof state === 'string') { try { state = JSON.parse(state); } catch { state = null; } }
        state = state?.version === USER_SMART_FILTER_VERSION ? { ...empty(), ...state } : empty();
        let queue = Promise.resolve();
        const store = { get state() { return state; }, transact(operation) {
            const job = queue.then(async () => {
                const draft = structuredClone(state), result = operation(draft);
                draft.revision++;
                await db.put(PERSONAL_STATE_KEY, JSON.stringify(draft));
                state = draft; // commit memory only after durable write succeeds
                return result;
            });
            queue = job.catch(() => {});
            return job;
        } };
        return store;
    })().catch(error => { stores.delete(db); throw error; }));
    return stores.get(db);
}
export function activeRules(state) { return state.rules.filter(r => r.active && r.sourceFeedbackIds.length); }
function row(article, section, fields) {
    return { id: randomUUID(), timestamp: new Date().toISOString(), articleId: article.articleKey || article.id || article.link, clusterId: article.clusterId || null,
        canonicalUrl: articleIdentity(article).url, title: s.text(article.title), source: s.text(article.feedTitle), section,
        origin: 'user_preference', filterVersion: USER_SMART_FILTER_VERSION, final: true, status: 'exclude', active: true, ...fields };
}
export async function confirmFeedback(db, { article, surface, selectedReasons, requestId }) {
    if (!['classic', 'smart_top'].includes(surface) || !article?.title || !article?.link || !Array.isArray(selectedReasons) || !selectedReasons.length || selectedReasons.length > 12) throw new Error('Select at least one reason before Apply.');
    if (selectedReasons.some(r => !s.validRule(r?.rule) || !r.label || r.rule.scope !== s.section(article))) throw new Error('Invalid or out-of-scope preference.');
    const store = await getPersonalStore(db);
    return store.transact(state => {
        const repeated = requestId && state.events.find(e => e.requestId === requestId);
        if (repeated) return repeated;
        const event = { id: randomUUID(), requestId, articleId: article.link, clusterId: article.clusterId || null, surface, timestamp: new Date().toISOString(),
            selectedReasons: selectedReasons.map(r => ({ label: s.text(r.label), rule: r.rule })), ruleIdsCreated: [], identities: members(article).map(identity), reverted: false };
        for (const reason of [...new Map(selectedReasons.map(r => [s.semanticKey(r.rule), r])).values()]) {
            const signature = s.semanticKey(reason.rule);
            let rule = state.rules.find(r => r.signature === signature);
            if (!rule) {
                rule = { id: randomUUID(), signature, criteria: reason.rule, label: s.text(reason.label), active: true, strength: reason.rule.strength,
                    feedbackCount: 0, sourceFeedbackIds: [], confidence: 'high', version: USER_SMART_FILTER_VERSION, createdAt: event.timestamp };
                state.rules.push(rule);
            }
            rule.active = true;
            rule.sourceFeedbackIds.push(event.id);
            rule.feedbackCount = rule.sourceFeedbackIds.length;
            rule.updatedAt = event.timestamp;
            event.ruleIdsCreated.push(rule.id);
        }
        state.events.push(event);
        state.decisions.push(row(article, s.section(article), { feedbackId: event.id, userRuleIds: event.ruleIdsCreated, reasonCode: 'CONFIRMED_DISLIKE', humanReason: selectedReasons.map(r => s.text(r.label)).join('; '), pipelineStage: 'confirmed_apply', decisionSource: 'explicit_confirmation', matchConfidence: 'high', identity: identity(article) }));
        return event;
    });
}
export async function undoFeedback(db, eventId) {
    const store = await getPersonalStore(db);
    return store.transact(state => {
        const event = state.events.find(e => e.id === eventId);
        if (!event) throw new Error('Feedback not found.');
        if (event.reverted) return { ok: true };
        event.reverted = true;
        event.revertedAt = new Date().toISOString();
        for (const rule of state.rules) {
            rule.sourceFeedbackIds = rule.sourceFeedbackIds.filter(id => id !== eventId);
            rule.feedbackCount = rule.sourceFeedbackIds.length;
            if (!rule.feedbackCount) rule.active = false;
        }
        for (const decision of state.decisions) {
            if (decision.feedbackId === eventId || (decision.userRuleIds?.length && !decision.userRuleIds.some(id => state.rules.some(r => r.id === id && r.active)))) {
                decision.active = false; decision.revertedAt = event.revertedAt;
            }
        }
        return { ok: true };
    });
}
export async function disableRule(db, id, remove = false) {
    const store = await getPersonalStore(db);
    return store.transact(state => {
        const rule = state.rules.find(r => r.id === id);
        if (!rule) throw new Error('Preference not found.');
        rule.active = false;
        if (remove) rule.deletedAt = new Date().toISOString();
        for (const event of state.events) if (!event.reverted && event.ruleIdsCreated.every(key => !state.rules.some(r => r.id === key && r.active))) event.disabled = true;
        for (const decision of state.decisions) if (decision.userRuleIds?.includes(id)) { decision.active = false; decision.revertedAt = new Date().toISOString(); }
        return { ok: true };
    });
}
const matchIndexes = new WeakMap();
function matchIndex(state) {
    if (matchIndexes.has(state)) return matchIndexes.get(state);
    const rules = activeRules(state), active = new Set(rules.map(rule => rule.id));
    const terminal = new Map(), events = new Map(), byId = new Map();
    for (const event of state.events) {
        byId.set(event.id, event);
        if (event.reverted || event.disabled || !event.ruleIdsCreated.some(id => active.has(id))) continue;
        for (const previous of event.identities) for (const key of previous.keys) {
            const lookup = previous.revision + ':' + key;
            const entries = events.get(lookup) || [];
            entries.push(event); events.set(lookup, entries);
        }
    }
    for (const decision of state.decisions) if (decision.active && decision.identity && decision.userRuleIds?.some(id => active.has(id))) terminal.set(decision.section + ':' + decision.identity.key, decision);
    const index = { rules, terminal, events, byId };
    matchIndexes.set(state, index);
    return index;
}
export function matchPersonal(state, article, section = s.section(article)) {
    const id = identity(article);
    const index = matchIndex(state), rules = index.rules;
    const unchangedCluster = event => !!event && (!article.relatedArticles?.length || members(article).every(member => event.identities.some(previous => sameArticle(previous, identity(member)))));
    const terminal = index.terminal.get(section + ':' + id.key);
    if (terminal && sameArticle(terminal.identity, id) && (!terminal.feedbackId || unchangedCluster(index.byId.get(terminal.feedbackId)))) return { ...terminal, reused: true };
    const exact = [...new Set(id.keys.flatMap(key => index.events.get(id.revision + ':' + key) || []))].find(event => event.identities.some(previous => sameArticle(previous, id)) && unchangedCluster(event));
    if (exact) return { feedbackId: exact.id, userRuleIds: exact.ruleIdsCreated, humanReason: 'Same unchanged story as confirmed feedback', reasonCode: 'EXACT_CONFIRMED_STORY', decisionSource: 'exact_identity', identity: id };
    const cached = state.traits[id.key];
    const candidate = cached ? { ...article, feedbackTraits: cached } : article;
    const rule = rules.find(r => {
        const traits = candidate.feedbackTraits;
        if (traits?.decisionSource === 'existing_ai' && (!traits.matchedRuleIds?.includes(r.id) || traits.matchConfidence !== 'high')) return s.matches(r.criteria, { ...article, feedbackTraits: undefined }, section);
        if (['routine_only', 'narrow'].includes(r.criteria.strength) && members(article).some(member => s.traits(member).major)) return false;
        return s.matches(r.criteria, candidate, section);
    });
    if (!rule) return null;
    return { userRuleIds: [rule.id], humanReason: rule.label, reasonCode: 'CONFIRMED_RULE_MATCH', matchedTraits: s.traits(candidate), decisionSource: 'deterministic', identity: id };
}
export async function filterPersonalArticles(db, articles, section, stage = 'smart_publication') {
    const store = await getPersonalStore(db);
    if (!activeRules(store.state).length) return articles;
    const decisions = [], kept = [];
    for (const article of articles) {
        const ownScope = s.section(article);
        const scope = !section || ownScope.startsWith(section + '_') ? ownScope : section;
        const match = matchPersonal(store.state, article, scope);
        if (!match) { kept.push(article); continue; }
        if (!match.reused) decisions.push(row(article, scope, { ...match, pipelineStage: stage, matchConfidence: 'high' }));
    }
    if (decisions.length) await store.transact(state => {
        for (const decision of decisions) {
            if (!state.decisions.some(d => d.active && d.section === decision.section && d.identity?.key === decision.identity.key)) state.decisions.push(decision);
        }
        // Decisions are bounded; confirmed rules/events remain until user reversal.
        state.decisions = state.decisions.slice(-20000);
    });
    return kept;
}
export async function personalSignature(db) {
    const store = await getPersonalStore(db);
    return digest([store.state.rules, store.state.events.map(e => [e.id, e.reverted, e.disabled])]);
}
