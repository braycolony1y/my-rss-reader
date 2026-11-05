import {runArticleStrategies} from '../articles/strategy-fallbacks.js';
import {withArticleFetchLane} from '../articles/fetch-lanes.js';
import {isDeletedArticlePayload} from '../article-source-state.js';
import {enhanceArticleResultForSource} from '../articles/source-results.js';

export async function prefetchArticleStrategies(url, article, policy, {
    fetchParsedArticleByStrategy, requiresIndependentDeletionConfirmation,
    buildDeletedSourceResponse, cacheArticleResult, enqueuePrefetchedSummary,
    lane, priority, enhance = false, delayMs = 0
}) {
    const deletionEvidence = new Set();
    const result = await runArticleStrategies(url, policy.strategyOrder, async strategy => {
        const parsed = await withArticleFetchLane(lane, () => fetchParsedArticleByStrategy(
            strategy, url, policy, article?.feedUrl || '', article?.title || ''
        ));
        if (isDeletedArticlePayload(url, parsed)) {
            deletionEvidence.add(strategy);
            if (requiresIndependentDeletionConfirmation(url)) return null;
            await buildDeletedSourceResponse(url, {fallbackTitle: article?.title || ''});
            return parsed;
        }
        if (!parsed?.content) return null;
        const payload = enhance ? enhanceArticleResultForSource(url, parsed, {
            description: article?.description || article?.content || ''
        }) : parsed;
        await cacheArticleResult(url, payload);
        enqueuePrefetchedSummary(url, article, priority);
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        return payload;
    }, {lane}).catch(error => {
        if (deletionEvidence.size < 2) throw error;
        return null;
    });
    if (!result && deletionEvidence.size >= 2) {
        await buildDeletedSourceResponse(url, {fallbackTitle: article?.title || '', deletionConfirmedBy: [...deletionEvidence]});
    }
    return result;
}
