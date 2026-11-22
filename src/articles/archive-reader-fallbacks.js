import {runPublisherFallbacks} from './publisher-fallbacks.js';
import {isDeletedArticlePayload} from '../article-source-state.js';
import {getVozPaginationMaxPage} from '../voz-thread-state.js';

export function createArchiveReaderFallbacks({fetchParsedArticleByStrategy, buildDeletedSourceResponse, deletedVozThreads, getCachedArticle, cacheArticleResult, vozThreadPageUrl, enqueueVozCacheBoardCrawl, triggerVozNextPagePrefetch, maxPages}) {
    const crawlPage = ({job, pageUrl, requestedPage, policy}) => runPublisherFallbacks(pageUrl, async () => {
        for (const strategy of policy.strategyOrder) {
            try {
                const result = await fetchParsedArticleByStrategy(strategy, pageUrl, policy, job.feedUrl);
                if (isDeletedArticlePayload(pageUrl, result)) {
                    await buildDeletedSourceResponse(pageUrl);
                    deletedVozThreads.add(job.baseUrl);
                    return true;
                }
                if (!result?.content) continue;

                const parsedCurrentPage = Number.parseInt(result.pagination?.currentPage, 10);
                const actualPage = Number.isSafeInteger(parsedCurrentPage) && parsedCurrentPage > 0
                    ? parsedCurrentPage
                    : requestedPage;
                const discoveredMaxPage = Math.min(
                    maxPages,
                    getVozPaginationMaxPage(result.pagination, actualPage)
                );
                if (actualPage < requestedPage && discoveredMaxPage < requestedPage) {
                    job.maxPage = discoveredMaxPage;
                } else {
                    job.maxPage = Math.max(job.maxPage, discoveredMaxPage);
                }

                const cacheUrl = vozThreadPageUrl(job.baseUrl, actualPage);
                result.url = cacheUrl;
                result.cached = true;
                await cacheArticleResult(cacheUrl, result);
                console.log(`[VOZ CACHE BOARD CRAWL] Cached page ${actualPage}/${job.maxPage} via ${strategy}`);
                return true;
            } catch (error) {
                // Continue through this source's configured reader methods.
            }
        }
        return false;
    }, {kind: 'article', join: false, failed: value => value !== true});

    const prefetchPage = ({nextUrl, depth, feedUrl, policy}) => runPublisherFallbacks(nextUrl, async () => {
        for (const strategy of policy.strategyOrder) {
            try {
                const result = await fetchParsedArticleByStrategy(strategy, nextUrl, policy, feedUrl);
                if (isDeletedArticlePayload(nextUrl, result)) {
                    await buildDeletedSourceResponse(nextUrl);
                    return true;
                }
                if (result && result.content) {
                    result.cached = true;
                    await cacheArticleResult(nextUrl, result);
                    console.log(`[VOZ PAGINATION PREFETCH] Successfully cached ${nextUrl} via ${strategy} (${result.content.length} bytes)`);
                    if (result.pagination && result.pagination.nextUrl && depth < 2) {
                        triggerVozNextPagePrefetch(result.pagination.nextUrl, depth + 1, feedUrl);
                    }
                    return true;
                }
            } catch(e) {}
        }
        return false;
    }, {kind: 'article', join: false, failed: value => value !== true});

    const updatePage = ({url, cachedArticle, effectiveFeedUrl, canonicalUrl, options, policy}) => runPublisherFallbacks(url, async () => {
        for (const strategy of policy.strategyOrder) {
            try {
                const result = await fetchParsedArticleByStrategy(strategy, url, policy, effectiveFeedUrl);
                if (result) {
                    if (isDeletedArticlePayload(url, result)) {
                        await buildDeletedSourceResponse(url);
                        console.log(`[VOZ BACKGROUND UPDATE] Thread ${url} is deleted. Marked to skip future background fetches.`);
                        return true;
                    }
                    if (result && result.content) {
                        const parsedCurrentPage = Number.parseInt(result.pagination?.currentPage, 10);
                        const currentPage = Number.isSafeInteger(parsedCurrentPage) && parsedCurrentPage > 0
                            ? parsedCurrentPage
                            : 1;
                        const cacheTargetUrl = options.cacheAllPages
                            ? vozThreadPageUrl(canonicalUrl, currentPage)
                            : url;
                        const comparableCache = options.cacheAllPages
                            ? await getCachedArticle(cacheTargetUrl)
                            : cachedArticle;
                        const contentChanged = result.content !== comparableCache?.content;
                        if (contentChanged) {
                            result.url = cacheTargetUrl;
                            result.cached = true;
                            await cacheArticleResult(cacheTargetUrl, result);
                            console.log(`[VOZ BACKGROUND UPDATE] Updated cache for ${cacheTargetUrl} (found new posts)`);
                        } else {
                            console.log(`[VOZ BACKGROUND UPDATE] No new posts for ${cacheTargetUrl}`);
                        }

                        if (options.cacheAllPages) {
                            enqueueVozCacheBoardCrawl(canonicalUrl, result.pagination, effectiveFeedUrl);
                        } else if (contentChanged && result.pagination?.nextUrl) {
                            triggerVozNextPagePrefetch(result.pagination.nextUrl, 1, effectiveFeedUrl);
                        }
                        return true;
                    }
                }
            } catch(e) {}
        }
        return false;
    }, {kind: 'article', join: false, failed: value => value !== true});
    return {crawlPage, prefetchPage, updatePage};
}
