// Old bookmarks and persisted records remain readable; new IDs use Global.
export function canonicalSmartCategory(value) {
    return String(value || '').replace(/_(world|foreign)$/, '_global');
}

export function smartDestination(value, region = 'global') {
    const category = canonicalSmartCategory(value);
    if (['news', 'finance', 'tech'].includes(category)) {
        return `${category}_${region === 'vietnam' ? 'vietnam' : 'global'}`;
    }
    return category;
}
