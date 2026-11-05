import { selectUniversalPrefetchTargets } from './prefetch-targets.js';
import { reconcileFeedPublication } from './publication.js';

export const FEED_PUBLICATION_KEYS = ['feeds', 'articles', 'savedStates', 'boardStates',
    'readStates', 'hiddenStates', 'smartClusters', 'smartRawArticles', 'blockedArticleKeywords', 'universalPrefetchTargets'];

export async function publishFeedResults(db, articles, feeds, includePrefetch = false) {
    let publication;
    await db.updateMany(FEED_PUBLICATION_KEYS, current => {
        publication = reconcileFeedPublication(current, articles, feeds);
        if (includePrefetch) {
            try {
                publication.changes.universalPrefetchTargets = JSON.stringify(selectUniversalPrefetchTargets(
                    publication.articles, current.smartClusters || [], current.blockedArticleKeywords || []));
            } catch (error) { console.error('[PREFETCH ENGINE] Target computation failed:', error.message); }
        }
        return publication.changes;
    });
    return publication.articles;
}
