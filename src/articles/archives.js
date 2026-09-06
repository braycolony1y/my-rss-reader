import { isUnsafeVozThreadPayload, isVozThreadUrl, getVozPaginationMaxPage, getVozThreadPageNumber, alignVozPaginationToRequestedPage } from '../voz-thread-state.js';
import { normalizeStateUrl } from '../utils/article-utils.js';
import { isDeletedArticlePayload, normalizeArticleSourceUrl, deletedSourceKind, deletedSourceTitle } from '../article-source-state.js';
import { cleanArticleMarkup } from './markup.js';
import { normalizeArticleTitle } from '../../feed-parsers.js';

export function createArticleArchives({
    getCachedArticle,
    getArticleFetchPolicy,
    fetchParsedArticleByStrategy,
    cacheArticleResult,
    _initArticleCacheIndex,
    getLastKnownCachedArticle,
    markUnavailableSourceUrl,
    cache,
} = {}) {
    const deletedVozThreads = new Set();

    const vozBackgroundUpdatesInFlight = new Set();

    const vozBackgroundLastCheck = new Map();

    const vozCacheBoardLastCheck = new Map();

    const VOZ_BACKGROUND_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

    const VOZ_CACHE_BOARD_REFRESH_INTERVAL_MS = 55 * 1000;

    const VOZ_CACHE_BOARD_CRAWL_CONCURRENCY = 2;

    const VOZ_CACHE_BOARD_CRAWL_BATCH_FETCHES = 4;

    const VOZ_CACHE_BOARD_CRAWL_PAGE_DELAY_MS = 250;

    const VOZ_CACHE_BOARD_MAX_PAGES = 10000;

    const vozCacheBoardCrawlJobs = new Map();

    const vozCacheBoardCrawlQueue = [];

    let activeVozCacheBoardCrawls = 0;

    function vozThreadPageUrl(baseUrl, page) {
        return page === 1 ? baseUrl : `${baseUrl}/page-${page}`;
    }

    function hasUsableCachedVozPage(cached, expectedPage) {
        if (!cached?.content || cached.sourceDeletedHasCache === false) return false;
        if (cached.content.includes(DELETED_SOURCE_TOMBSTONE)) return false;
        if (isUnsafeVozThreadPayload(cached.url || '', cached) && cached.sourceDeleted !== true) return false;
        const cachedPage = Number.parseInt(cached.pagination?.currentPage, 10);
        return !Number.isSafeInteger(cachedPage) || cachedPage === expectedPage;
    }

    function enqueueVozCacheBoardCrawl(url, pagination, feedUrl = '') {
        if (!isVozThreadUrl(url)) return;
        const baseUrl = normalizeStateUrl(url);
        if (!baseUrl || deletedVozThreads.has(baseUrl)) return;
        const discoveredMaxPage = Math.min(
            VOZ_CACHE_BOARD_MAX_PAGES,
            getVozPaginationMaxPage(pagination, 1)
        );
        let job = vozCacheBoardCrawlJobs.get(baseUrl);
        if (job) {
            job.maxPage = Math.max(job.maxPage, discoveredMaxPage);
            if (feedUrl) job.feedUrl = feedUrl;
            return;
        }

        job = {
            baseUrl,
            feedUrl,
            nextPage: 1,
            maxPage: discoveredMaxPage,
            status: 'queued'
        };
        vozCacheBoardCrawlJobs.set(baseUrl, job);
        vozCacheBoardCrawlQueue.push(job);
        pumpVozCacheBoardCrawls();
    }

    function pumpVozCacheBoardCrawls() {
        while (activeVozCacheBoardCrawls < VOZ_CACHE_BOARD_CRAWL_CONCURRENCY && vozCacheBoardCrawlQueue.length) {
            const job = vozCacheBoardCrawlQueue.shift();
            if (!job || job.status !== 'queued' || deletedVozThreads.has(job.baseUrl)) {
                if (job) vozCacheBoardCrawlJobs.delete(job.baseUrl);
                continue;
            }
            job.status = 'running';
            activeVozCacheBoardCrawls++;
            runVozCacheBoardCrawlBatch(job).catch(error => {
                console.warn(`[VOZ CACHE BOARD CRAWL] ${job.baseUrl}: ${error.message}`);
            }).finally(() => {
                activeVozCacheBoardCrawls--;
                if (!deletedVozThreads.has(job.baseUrl) && job.nextPage <= job.maxPage) {
                    job.status = 'queued';
                    vozCacheBoardCrawlQueue.push(job);
                } else {
                    vozCacheBoardCrawlJobs.delete(job.baseUrl);
                }
                setTimeout(pumpVozCacheBoardCrawls, 0);
            });
        }
    }

    async function runVozCacheBoardCrawlBatch(job) {
        let fetchedPages = 0;
        while (job.nextPage <= job.maxPage && fetchedPages < VOZ_CACHE_BOARD_CRAWL_BATCH_FETCHES) {
            if (deletedVozThreads.has(job.baseUrl)) return;
            const requestedPage = job.nextPage++;
            const pageUrl = vozThreadPageUrl(job.baseUrl, requestedPage);
            const cached = await getCachedArticle(pageUrl);
            if (hasUsableCachedVozPage(cached, requestedPage)) {
                job.maxPage = Math.min(
                    VOZ_CACHE_BOARD_MAX_PAGES,
                    Math.max(job.maxPage, getVozPaginationMaxPage(cached.pagination, requestedPage))
                );
                continue;
            }

            fetchedPages++;
            console.log(`[VOZ CACHE BOARD CRAWL] Caching page ${requestedPage}/${job.maxPage}: ${pageUrl}`);
            const policy = await getArticleFetchPolicy(pageUrl, job.feedUrl);
            for (const strategy of policy.strategyOrder) {
                try {
                    const result = await fetchParsedArticleByStrategy(strategy, pageUrl, policy, job.feedUrl);
                    if (isDeletedArticlePayload(pageUrl, result)) {
                        await buildDeletedSourceResponse(pageUrl);
                        deletedVozThreads.add(job.baseUrl);
                        return;
                    }
                    if (!result?.content) continue;

                    const parsedCurrentPage = Number.parseInt(result.pagination?.currentPage, 10);
                    const actualPage = Number.isSafeInteger(parsedCurrentPage) && parsedCurrentPage > 0
                        ? parsedCurrentPage
                        : requestedPage;
                    const discoveredMaxPage = Math.min(
                        VOZ_CACHE_BOARD_MAX_PAGES,
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
                    break;
                } catch (error) {
                    // Continue through this source's configured reader methods.
                }
            }
            if (job.nextPage <= job.maxPage) {
                await new Promise(resolve => setTimeout(resolve, VOZ_CACHE_BOARD_CRAWL_PAGE_DELAY_MS));
            }
        }
    }

    function triggerVozNextPagePrefetch(nextUrl, depth = 1, feedUrl = '') {
        if (!nextUrl || !nextUrl.includes('voz.vn') || depth > 2) return Promise.resolve();
        return new Promise(resolve => {
            setTimeout(async () => {
                try {
                    const cached = await getCachedArticle(nextUrl);
                    if (cached && cached.content) { resolve(); return; }
                    console.log(`[VOZ PAGINATION PREFETCH] Background caching next page: ${nextUrl}`);
                    const policy = await getArticleFetchPolicy(nextUrl, feedUrl);
                    for (const strategy of policy.strategyOrder) {
                        try {
                            const result = await fetchParsedArticleByStrategy(strategy, nextUrl, policy, feedUrl);
                            if (isDeletedArticlePayload(nextUrl, result)) {
                                await buildDeletedSourceResponse(nextUrl);
                                break;
                            }
                            if (result && result.content) {
                                result.cached = true;
                                await cacheArticleResult(nextUrl, result);
                                console.log(`[VOZ PAGINATION PREFETCH] Successfully cached ${nextUrl} via ${strategy} (${result.content.length} bytes)`);
                                if (result.pagination && result.pagination.nextUrl && depth < 2) {
                                    triggerVozNextPagePrefetch(result.pagination.nextUrl, depth + 1, feedUrl);
                                }
                                break;
                            }
                        } catch(e) {}
                    }
                } catch (e) {
                    console.error(`[VOZ PAGINATION PREFETCH ERROR] ${nextUrl}: ${e.message}`);
                }
                resolve();
            }, 150);
        });
    }

    function triggerVozCurrentPageBackgroundUpdate(url, cachedArticle, feedUrl = '', options = {}) {
        if (!url || !url.includes('voz.vn')) return;
        const canonicalUrl = normalizeStateUrl(url);
        if (cachedArticle?.sourceDeleted) {
            deletedVozThreads.add(canonicalUrl);
            return;
        }
        const minimumIntervalMs = Number.isFinite(options.minimumIntervalMs)
            ? Math.max(0, options.minimumIntervalMs)
            : VOZ_BACKGROUND_REFRESH_INTERVAL_MS;
        const lastCheckStore = options.cacheAllPages ? vozCacheBoardLastCheck : vozBackgroundLastCheck;
        const lastCheckedAt = lastCheckStore.get(canonicalUrl) || 0;
        if (vozBackgroundUpdatesInFlight.has(canonicalUrl) || Date.now() - lastCheckedAt < minimumIntervalMs) return;
        vozBackgroundUpdatesInFlight.add(canonicalUrl);
        lastCheckStore.set(canonicalUrl, Date.now());
        if (lastCheckStore.size > 2000) {
            const oldestKey = lastCheckStore.keys().next().value;
            lastCheckStore.delete(oldestKey);
        }
        setTimeout(async () => {
            try {
                console.log(`[VOZ BACKGROUND UPDATE] Checking for new posts on ${url}`);
                const effectiveFeedUrl = feedUrl || cachedArticle?.feedUrl || '';
                const policy = await getArticleFetchPolicy(url, effectiveFeedUrl);
                for (const strategy of policy.strategyOrder) {
                    try {
                        const result = await fetchParsedArticleByStrategy(strategy, url, policy, effectiveFeedUrl);
                        if (result) {
                            if (isDeletedArticlePayload(url, result)) {
                                await buildDeletedSourceResponse(url);
                                console.log(`[VOZ BACKGROUND UPDATE] Thread ${url} is deleted. Marked to skip future background fetches.`);
                                break;
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
                                break;
                            }
                        }
                    } catch(e) {}
                }
            } catch (e) {
                console.error(`[VOZ BACKGROUND UPDATE ERROR] ${url}: ${e.message}`);
            } finally {
                vozBackgroundUpdatesInFlight.delete(canonicalUrl);
            }
        }, 2000);
    }

    async function isProtectedDeletedSourceSnapshot(url) {
        const canonicalUrl = normalizeStateUrl(url);
        if (isVozThreadUrl(url) && deletedVozThreads.has(canonicalUrl)) return true;
        const exactCachedArticle = await getCachedArticle(url);
        if (exactCachedArticle?.sourceDeleted === true) return true;
        if (canonicalUrl !== url) {
            const threadCachedArticle = await getCachedArticle(canonicalUrl);
            if (threadCachedArticle?.sourceDeleted === true) return true;
        }
        return false;
    }

    function requiresIndependentDeletionConfirmation(url) {
        // VOZ threads have a dedicated deletion/archive protocol. Every ordinary
        // article requires two independent reader methods before a permanent
        // tombstone can be created, so a proxy error cannot hide a live page.
        return !isVozThreadUrl(url);
    }

    const DELETED_SOURCE_TOMBSTONE = '<!-- deleted-source-no-cached-content -->';

    async function getArchivedVozPaginationSeed(baseUrl) {
        await _initArticleCacheIndex();
        const archivedPages = new Map();
        const canonicalBaseUrl = normalizeStateUrl(baseUrl);

        for (const meta of cache._articleCacheIndex.values()) {
            if (!meta?.url || !isVozThreadUrl(meta.url)) continue;
            if (normalizeStateUrl(meta.url) !== canonicalBaseUrl) continue;

            const cached = await getLastKnownCachedArticle(meta.url);
            const hasArchivedPosts = Boolean(
                cached?.content
                && cached.sourceDeletedHasCache !== false
                && !cached.content.includes(DELETED_SOURCE_TOMBSTONE)
                && !(isUnsafeVozThreadPayload(meta.url, cached) && cached.sourceDeleted !== true)
            );
            if (!hasArchivedPosts) continue;

            const urlPage = getVozThreadPageNumber(meta.url);
            const cachedPage = Number.parseInt(cached?.pagination?.currentPage, 10);
            const page = urlPage
                || (Number.isSafeInteger(cachedPage) && cachedPage > 0 ? cachedPage : 1);
            const pageUrl = page === 1 ? canonicalBaseUrl : `${canonicalBaseUrl}/page-${page}`;
            archivedPages.set(page, { page, url: pageUrl, isCurrent: false });
        }

        const pages = [...archivedPages.values()].sort((a, b) => a.page - b.page);
        return pages.length ? { pages } : null;
    }

    async function shouldRevalidateUnderfilledVozPage(url, cached) {
        if (!cached?.content || cached.sourceDeleted === true || !isVozThreadUrl(url)) return false;
        const postCount = (cached.content.match(/class=["']voz-post["']/gi) || []).length;
        if (!postCount || postCount >= 20) return false;
        const currentPage = getVozThreadPageNumber(url)
            || Number.parseInt(cached.pagination?.currentPage, 10)
            || 1;
        if (cached.pagination?.nextUrl) return true;
        const archivedPagination = await getArchivedVozPaginationSeed(normalizeStateUrl(url));
        const lastKnownPage = Math.max(1, ...(archivedPagination?.pages || []).map(page => Number(page?.page || 0)));
        return currentPage < lastKnownPage;
    }

    async function buildDeletedSourceResponse(url, responseMetadata = {}) {
        const requestedCacheUrl = normalizeArticleSourceUrl(url);
        const baseUrl = normalizeStateUrl(url);
        const requestedVozPage = getVozThreadPageNumber(requestedCacheUrl);
        const isSpecificVozPage = requestedVozPage !== null && requestedVozPage > 1;
        // Board membership intentionally collapses every VOZ page to one thread
        // identity. Content caching must not: every cached /page-N is distinct
        // from page 1 and must be served before the thread-level deleted snapshot.
        const snapshotUrl = isSpecificVozPage ? requestedCacheUrl : baseUrl;
        const kind = deletedSourceKind(url);
        if (kind === 'thread') {
            if (deletedVozThreads.size > 2000) deletedVozThreads.clear();
            deletedVozThreads.add(baseUrl);
        }
        const lastCache = await getLastKnownCachedArticle(snapshotUrl);
        const threadMetadataCache = isSpecificVozPage
            ? await getLastKnownCachedArticle(baseUrl)
            : lastCache;
        const archivedVozPagination = kind === 'thread'
            ? await getArchivedVozPaginationSeed(baseUrl)
            : null;
        const paginationRequestedUrl = requestedVozPage === null && kind === 'thread'
            ? `${baseUrl}/page-1`
            : requestedCacheUrl;
        const alignedPagination = kind === 'thread'
            ? alignVozPaginationToRequestedPage(archivedVozPagination, paginationRequestedUrl, baseUrl)
            : (lastCache?.pagination || null);
        const cachedPayloadIsOnlyDeletionPage = Boolean(
            lastCache
            && lastCache.sourceDeleted !== true
            && isDeletedArticlePayload(url, lastCache)
        );
        const hasCachedContent = Boolean(
            lastCache?.content
            && !cachedPayloadIsOnlyDeletionPage
            && lastCache.sourceDeletedHasCache !== false
            && !lastCache.content.includes(DELETED_SOURCE_TOMBSTONE)
            && !(isUnsafeVozThreadPayload(url, lastCache) && lastCache.sourceDeleted !== true)
        );
        if (!hasCachedContent) await markUnavailableSourceUrl(snapshotUrl);
        const deletedDetectedAt = lastCache?.deletedDetectedAt
            || threadMetadataCache?.deletedDetectedAt
            || new Date().toISOString();
        let sourceSiteName = lastCache?.siteName
            || threadMetadataCache?.siteName
            || responseMetadata.sourceSiteName
            || '';
        if (!sourceSiteName) {
            try { sourceSiteName = new URL(url).hostname.replace(/^www\./, ''); } catch (error) { }
        }
        const preserved = {
            ...(lastCache || {}),
            url: snapshotUrl,
            title: hasCachedContent
                ? lastCache.title
                : (responseMetadata.fallbackTitle
                    || lastCache?.title
                    || threadMetadataCache?.title
                    || deletedSourceTitle(url)),
            content: hasCachedContent ? lastCache.content : DELETED_SOURCE_TOMBSTONE,
            pagination: alignedPagination,
            siteName: sourceSiteName,
            sourceDeleted: true,
            sourceDeletedHasCache: hasCachedContent,
            sourceDeletedKind: kind,
            isDeletedSource: true,
            isDeletedThread: kind === 'thread',
            deletionConfirmedBy: Array.isArray(responseMetadata.deletionConfirmedBy)
                ? [...new Set(responseMetadata.deletionConfirmedBy.filter(Boolean))]
                : (lastCache?.deletionConfirmedBy || []),
            deletionConfirmationVersion: kind === 'thread' ? 1 : 2,
            deletedDetectedAt
        };
        await cacheArticleResult(snapshotUrl, preserved);
        return {
            ...preserved,
            ...responseMetadata,
            url: snapshotUrl,
            content: hasCachedContent ? cleanArticleMarkup(preserved.content) : '',
            title: normalizeArticleTitle(preserved.title),
            cached: hasCachedContent,
            sourceDeleted: true,
            sourceDeletedHasCache: hasCachedContent,
            sourceDeletedKind: kind,
            deletionConfirmedBy: preserved.deletionConfirmedBy,
            deletionConfirmationVersion: preserved.deletionConfirmationVersion,
            deletedDetectedAt
        };
    }

    return {
        requiresIndependentDeletionConfirmation,
        buildDeletedSourceResponse,
        isProtectedDeletedSourceSnapshot,
        shouldRevalidateUnderfilledVozPage,
        deletedVozThreads,
        DELETED_SOURCE_TOMBSTONE,
        triggerVozNextPagePrefetch,
        triggerVozCurrentPageBackgroundUpdate,
        enqueueVozCacheBoardCrawl,
        VOZ_CACHE_BOARD_REFRESH_INTERVAL_MS
    };
}
