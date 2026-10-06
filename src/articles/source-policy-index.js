import { normalizeStateUrl } from '../utils/article-utils.js';

const indexes = new WeakMap();
// A new persisted article generation produces a new shared array. Weak keys
// let old generations disappear along with their database/pinned-view owners.
export function associatedSourceUrls(articles, targetUrl) {
    let index = indexes.get(articles);
    if (!index) {
        index = new Map();
        for (const article of articles) {
            if (!article?.feedUrl) continue;
            for (const value of [article.link, article.originalLink, article.id]) {
                const identity = normalizeStateUrl(value);
                let feeds = index.get(identity);
                if (!feeds) { feeds = new Set(); index.set(identity, feeds); }
                feeds.add(article.feedUrl);
            }
        }
        indexes.set(articles, index);
    }
    return [...(index.get(normalizeStateUrl(targetUrl)) || [])];
}
