const sections = new Set(['tech_global','tech_vietnam','news_global','news_vietnam','finance_global','finance_vietnam']);
const views = new WeakMap();
const canonical = value => String(value || '').replace(/_world$/, '_global').replace(/_foreign$/, '_global');

export function publicationDestination(value, region = 'global') {
    return ['tech','news','finance'].includes(value) ? `${value}_${region}` : canonical(value);
}

// Navigation only needs the requested destination. Keep six lightweight arrays
// sharing the existing immutable cards, never a second decoded publication.
export function publicationSection(snapshot, destination) {
    if (!snapshot?.articles || !destination) return snapshot;
    let entries = views.get(snapshot);
    if (!entries) { entries = new Map(); views.set(snapshot, entries); }
    if (entries.has(destination)) return entries.get(destination);
    const result = {...snapshot, articles:snapshot.articles.filter(article => canonical(article?.topStory?.feed) === destination)};
    if (sections.has(destination)) entries.set(destination, result);
    return result;
}
