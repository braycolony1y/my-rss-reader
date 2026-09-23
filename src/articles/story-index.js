const indexes = new WeakMap();

// Published snapshots and pinned views retain immutable article membership.
// Scroll heartbeats should not rebuild an index of the entire corpus.
export function indexStoriesById(articles) {
    if (!Array.isArray(articles)) return new Map();
    let index = indexes.get(articles);
    if (!index) {
        index = new Map(articles.map(article => [String(article?.clusterId || article?.link || ''), article]));
        indexes.set(articles, index);
    }
    return index;
}
