import { decisionsFor } from '../prefilter/state.js';
import { rawAllowedDestinations } from '../../articles/top-story-destinations.js';
import { getPersonalStore, filterPersonalArticles, matchPersonal, activeRules, identity } from './store.js';
import { semantics as s } from './semantics.js';

import { setPersonalState, personalEnabled } from './terminal.js';
export { personalTerminal, personalFullyExcluded, currentPersonalRules } from './terminal.js';
export async function bindPersonalState(db) { const state = (await getPersonalStore(db)).state; setPersonalState(state); return state; }
export async function preparePersonalCandidates(db, articles, sources, stage = 'pre_embedding') {
    if (!personalEnabled()) return articles;
    const state = await bindPersonalState(db);
    const rules = activeRules(state);
    if (!rules.length) return articles;
    const candidates = articles.map(article => {
        const sections = rawAllowedDestinations(article, sources);
        return { ...article, smartPersonalSections: sections.length ? sections : [s.section(article)] };
    });
    const bySection = new Map();
    for (const candidate of candidates) for (const section of candidate.smartPersonalSections) {
        const system = decisionsFor(candidate)[section];
        if (system?.status === 'exclude' && system.final) continue;
        const batch = bySection.get(section) || [];
        batch.push(candidate); bySection.set(section, batch);
    }
    const survivors = new Set();
    for (const [section, batch] of bySection) for (const candidate of await filterPersonalArticles(db, batch, section, stage)) survivors.add(candidate);
    const kept = candidates.filter(candidate => survivors.has(candidate));
    await bindPersonalState(db);
    return kept;
}
export async function filterPersonalView(db, articles, section, stage = 'smart_view') {
    if (!personalEnabled()) return articles;
    const kept = await filterPersonalArticles(db, articles, section, stage);
    await bindPersonalState(db);
    return kept;
}
export async function personalSourceWork(db, results, sources) {
    const view = [];
    for (const result of results) view.push({ ...result, articles: await preparePersonalCandidates(db, result.articles || [], sources, 'pre_source_resolution') });
    return view;
}
export async function personalPublishedExcluded(db, article, section) {
    return !(await filterPersonalView(db, [article], section, 'pre_briefing')).length;
}
