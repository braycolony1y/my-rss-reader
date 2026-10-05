import { fullyExcluded } from '../prefilter/state.js';
import { parseClusteringJson } from '../../ai/clustering-json.js';
import { getPersonalStore, identity, activeRules, filterPersonalArticles } from './store.js';
import { bindPersonalState } from './pipeline.js';
import { currentPersonalRules, personalFullyExcluded, personalEnabled } from './terminal.js';
import { semantics as s } from './semantics.js';

const string = { type: 'string' };
const traitsSchema = { type: 'object', properties: Object.fromEntries(['section','broadCategory','topic','subtopic','eventType','storyFormat','storyAngle','materialityClass','geographyScope'].map(k => [k, string]).concat([['entities', { type: 'array', items: string }], ['keyConcepts', { type: 'array', items: string }]])) };
const sideSchema = { type: 'array', items: { type: 'object', properties: { id: string, feedbackTraits: traitsSchema, userPreferenceMatch: { type: 'object', properties: { matched: { type: 'boolean' }, ruleId: string, confidence: string, reason: string } } } } };
export function extendPersonalReview(articles, spec) {
    if (!personalEnabled() || spec?.operation === 'smart-feedback-picker') return spec;
    const candidates = articles.filter(a => !fullyExcluded(a)).map(a => ({ id: identity(a).key, title: a.title, section: s.section(a), rules: currentPersonalRules(a) }));
    if (!candidates.length) return spec;
    const instruction = '\nOPTIONAL PERSONAL SMART FILTER SIDE OUTPUT: after all primary fields, optionally append personalSmartFeedback. Never truncate or change the primary task for this field. Use ONLY supplied evidence. Include compact feedbackTraits for the main event: section, broadCategory, topic, subtopic, eventType, storyFormat, storyAngle, materialityClass (major/routine/minor/unknown), geographyScope, entities, keyConcepts. For explicitly confirmed rules in each candidate, return userPreferenceMatch with matched, ruleId, confidence, reason. Match every constraint and scope; entity overlap alone is insufficient for narrow rules. Major/new/denied/approved/cancelled developments survive routine/trivial/PR rules; explicit hide_all_entity is honored. Unknown means KEEP. No extra tools or requests. Canonical event types: ' + s.types.map(([id]) => id).join(', ') + '.\n' + JSON.stringify({ personalCandidates: candidates });
    const at = spec.prompt.lastIndexOf('\n{');
    const prompt = at >= 0 ? spec.prompt.slice(0, at) + instruction + '\n' + spec.prompt.slice(at) : spec.prompt + instruction;
    return { ...spec, prompt, schema: { ...spec.schema, properties: { ...spec.schema?.properties, personalSmartFeedback: sideSchema } } };
}
export function splitPersonalOutput(value) {
    if (!value || typeof value !== 'object') return { primary: value };
    const { personalSmartFeedback, ...primary } = value;
    return { primary, personalSmartFeedback };
}
export async function acceptPersonalOutput(db, articles, parsed, stage) {
    if (!Array.isArray(parsed?.personalSmartFeedback)) return;
    const store = await getPersonalStore(db);
    const rows = parsed.personalSmartFeedback;
    await store.transact(state => {
        for (const article of articles) {
            const id = identity(article).key;
            const matches = rows.filter(r => r?.id === id);
            if (matches.length !== 1 || !matches[0].feedbackTraits || fullyExcluded(article)) continue;
            const raw = matches[0].feedbackTraits, traits = {};
            for (const key of Object.keys(traitsSchema.properties)) {
                if (['entities','keyConcepts'].includes(key)) traits[key] = Array.isArray(raw[key]) ? raw[key].filter(x => typeof x === 'string').slice(0, 12).map(s.text) : [];
                else if (typeof raw[key] === 'string') traits[key] = s.text(raw[key]);
            }
            const match = matches[0].userPreferenceMatch;
            traits.decisionSource = 'existing_ai';
            traits.matchConfidence = match?.matched === true && match.confidence === 'high' ? 'high' : 'low';
            traits.matchedRuleIds = activeRules(state).filter(rule => rule.id === match?.ruleId).map(rule => rule.id);
            state.traits[id] = traits;
            article.feedbackTraits = traits;
        }
        const keys = Object.keys(state.traits);
        for (const key of keys.slice(0, Math.max(0, keys.length - 20000))) delete state.traits[key];
    });
    // Recheck only nonterminal candidates with newly supplied semantic evidence.
    // AI match claims alone cannot bypass validated constraints or materiality.
    for (const article of articles) if (!fullyExcluded(article)) {
        for (const section of article.smartPersonalSections || [s.section(article)]) await filterPersonalArticles(db, [article], section, stage);
    }
    await bindPersonalState(db);
}
export function recoverPersonalTail(raw) {
    const text = String(raw || '');
    try { parseClusteringJson(text); return text; } catch {}
    const match = /,\s*"personalSmartFeedback"\s*:/.exec(text);
    if (!match) return text;
    try { return JSON.stringify(JSON.parse(text.slice(0, match.index).replace(/^\s*```(?:json)?\s*/, '') + '}')); } catch { return text; }
}
