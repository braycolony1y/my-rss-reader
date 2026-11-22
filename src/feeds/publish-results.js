import { selectUniversalPrefetchTargets } from './prefetch-targets.js';
import { reconcileFeedPublication } from './publication.js';
import { serializeFeedPublication } from './publication-order.js';

export const FEED_PUBLICATION_KEYS = ['feeds', 'articles', 'savedStates', 'boardStates',
    'readStates', 'hiddenStates', 'smartClusters', 'smartRawArticles', 'blockedArticleKeywords', 'universalPrefetchTargets'];

export function publishFeedResults(db, articles, feeds, includePrefetch = false, order = null) {
    return serializeFeedPublication(db, () => publishNow(db, articles, feeds, includePrefetch, order));
}

async function publishNow(db, articles, feeds, includePrefetch, order) {
    let publication;
    let admitted = articles;
    await db.updateMany(FEED_PUBLICATION_KEYS, current => {
        const selected = order?.select(articles, feeds) || {articles, feeds};
        admitted = selected.articles;
        publication = reconcileFeedPublication(current, selected.articles, selected.feeds);
        if (includePrefetch) {
            try {
                publication.changes.universalPrefetchTargets = JSON.stringify(selectUniversalPrefetchTargets(
                    publication.articles, current.smartClusters || [], current.blockedArticleKeywords || []));
            } catch (error) { console.error('[PREFETCH ENGINE] Target computation failed:', error.message); }
        }
        return publication.changes;
    }, {readProjections:{smartClusters:'links',smartRawArticles:'links'}});
    order?.commit(admitted);
    return publication.articles;
}
