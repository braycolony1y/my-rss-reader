import { identity } from './store.js';
// Read-only binding used by synchronous downstream boundaries. It never evaluates rules.
let currentState = null;
let terminals = new Map();
export const personalEnabled = () => !/^(0|false|off)$/i.test(process.env.SMART_PERSONAL_FILTER_ENABLED || 'true');
export function setPersonalState(state) {
    if (currentState === state) return;
    currentState = state;
    terminals = new Map();
    const active = new Set(state.rules.filter(r => r.active && r.sourceFeedbackIds.length).map(r => r.id));
    for (const decision of state.decisions) {
        if (!decision.active || !decision.identity || !decision.userRuleIds?.some(id => active.has(id))) continue;
        const sections = terminals.get(decision.identity.key) || new Set();
        sections.add(decision.section); terminals.set(decision.identity.key, sections);
    }
}
export function personalTerminal(article, section) {
    if (!personalEnabled() || !terminals.size) return false;
    const sections = terminals.get(identity(article).key);
    return !!sections && (!section || sections.has(section));
}
export function personalFullyExcluded(article) {
    const sections = article.smartPersonalSections;
    return !!sections?.length && sections.every(section => personalTerminal(article, section));
}
export function currentPersonalRules(article) {
    if (!personalEnabled() || !currentState) return [];
    return currentState.rules.filter(r => r.active && r.sourceFeedbackIds.length && (!article || r.criteria.scope === (article.topStory?.feed || article.feedbackSection || article.smartCategory) || (article.smartPersonalSections || []).includes(r.criteria.scope))).slice(0, 30).map(r => ({ id: r.id, ...r.criteria }));
}
