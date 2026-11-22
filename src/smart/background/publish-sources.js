import { sourceWorkView } from '../prefilter/source-work.js';
import { isSmartRefreshActive, getSmartRefreshGeneration } from '../refresh/coordination.js';
import { prefetchOpenCliOnlySmartArticles } from '../sources/fetch.js';

// Network/destination work can yield to a newer foreground refresh. Recheck
// ownership inside the database queue, not only after the initial fetch.
export async function publishBackgroundSources({db, results, configuredSources, helpers, generation}) {
    const current = () => !isSmartRefreshActive() && getSmartRefreshGeneration() === generation;
    if (!current()) return false;
    const sourceWork = await sourceWorkView(db, results, configuredSources);
    if (!current()) return false;
    await helpers.resolveSmartArticleDestinations?.(sourceWork);
    if (!current()) return false;
    const articles = results.flatMap(result => result.articles || []);
    await helpers.observeCacheArticles?.(articles);
    let committed = false;
    await db.updateMany(['smartRawArticles'], () => {
        if (!current()) return {};
        committed = true;
        return {smartRawArticles: JSON.stringify(articles)};
    });
    if (committed && current()) {
        void prefetchOpenCliOnlySmartArticles(sourceWork, helpers)
            .catch(error => console.warn('[SMART PREFETCH]', error.message));
    }
    return committed;
}
