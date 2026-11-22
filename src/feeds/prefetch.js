import {prefetchArticleStrategies} from './prefetch-strategies.js';
import { selectUniversalPrefetchTargets } from './prefetch-targets.js';
import { createNextArticlesPrefetch } from './next-articles-prefetch.js';
import { normalizeArticleSourceUrl } from '../article-source-state.js';
import { safeHttpUrl, normalizeStateUrl, isInvalidImage, isRedditUrl } from '../utils/article-utils.js';
import sourceRegistry from '../sources/index.js';
import { enhanceArticleResultForSource } from '../articles/source-results.js';
import { withArticleFetchLane } from '../articles/fetch-lanes.js';

export function createArticlePrefetch({
    getBestImage,
    BROWSER_HEADERS,
    getCachedArticle,
    getCachedArticleMetadata,
    getArticleFetchPolicy,
    hasOnlyOpenCliFetchMethod,
    fetchParsedArticleByStrategy,
    cacheArticleResult,
    env,
    requiresIndependentDeletionConfirmation,
    buildDeletedSourceResponse,
    waitForHttpIdle,
    progress,
    googleNews,
} = {}) {
    const fetchParsedP3 = (...args) => withArticleFetchLane('p3', () => fetchParsedArticleByStrategy(...args));
    let openCliIngestPrefetchTail = Promise.resolve();

    const openCliIngestPrefetchInFlight = new Map();

    function scheduleOpenCliIngestPrefetch(article, feedUrl = '') {
        const url = normalizeArticleSourceUrl(article?.link || article?.url || '');
        if (!safeHttpUrl(url) || isRedditUrl(url)) return Promise.resolve(false);
        const key = normalizeStateUrl(url);
        if (openCliIngestPrefetchInFlight.has(key)) return openCliIngestPrefetchInFlight.get(key);

        const task = openCliIngestPrefetchTail
            .catch(() => undefined)
            .then(async () => {
                const sourceHandler = sourceRegistry.getHandler(url);
                const promoteArticleImage = async result => {
                    const candidate = safeHttpUrl(result?.image);
                    let currentIsInvalid = !article.image || isInvalidImage(article.image);
                    try {
                        if (sourceHandler?.isInvalidFeedImage?.(article.image)) currentIsInvalid = true;
                    } catch (error) { }
                    if (!currentIsInvalid) return;
                    if (candidate && !isInvalidImage(candidate)) {
                        article.image = candidate;
                        return;
                    }
                    const primaryImageTarget = sourceHandler?.primaryImageTarget?.(result);
                    if (!safeHttpUrl(primaryImageTarget)) return;
                    const resolvedImage = await getBestImage(
                        primaryImageTarget,
                        (imageUrl, options = {}) => fetch(imageUrl, { headers: BROWSER_HEADERS, ...options })
                    );
                    if (resolvedImage && !isInvalidImage(resolvedImage)) article.image = resolvedImage;
                };
                const cached = await getCachedArticle(url);
                if (cached) {
                    await promoteArticleImage(enhanceArticleResultForSource(url, cached, { cacheMigration: true }));
                    return true;
                }
                const policy = await getArticleFetchPolicy(url, feedUrl);
                if (!policy.hasStrictConfiguredMethods || !hasOnlyOpenCliFetchMethod(policy.strategyOrder)) return false;

                const result = await fetchParsedP3(
                    'opencli-fetch',
                    url,
                    policy,
                    feedUrl,
                    article?.title || ''
                );
                if (!result?.content) throw new Error('OpenCLI returned no usable article content');
                await promoteArticleImage(result);
                const didCache = await cacheArticleResult(url, {
                    ...result,
                    url,
                    feedUrl: feedUrl || result.feedUrl || '',
                    fetchStrategy: 'opencli-fetch'
                });
                if (!didCache) throw new Error('OpenCLI article content could not be cached');
                console.log(`[OPENCLI INGEST] Cached new article before display: ${url}`);
                return true;
            });

        const tracked = task
            .catch(error => {
                console.warn(`[OPENCLI INGEST] Could not prefetch ${url}: ${error.message}`);
                return false;
            })
            .finally(() => openCliIngestPrefetchInFlight.delete(key));
        openCliIngestPrefetchTail = tracked;
        openCliIngestPrefetchInFlight.set(key, tracked);
        return tracked;
    }

    async function prefetchOpenCliOnlyArticles(articles = [], feedUrl = '') {
        if (!Array.isArray(articles) || !articles.length) return [];
        return Promise.all(articles.map(article => scheduleOpenCliIngestPrefetch(article, feedUrl)));
    }

    function enqueuePrefetchedSummary(url, articleData, priority) {
        // Background summarization is completely disabled for all sources
        return;
    }

    const triggerNextFiveArticlesPrefetch = createNextArticlesPrefetch({ env, getCachedArticleMetadata, getCachedArticle, enqueuePrefetchedSummary, progress, getArticleFetchPolicy, fetchParsedArticleByStrategy, requiresIndependentDeletionConfirmation, buildDeletedSourceResponse, cacheArticleResult });

    // ============================================================================
    // CONTINUOUS SEQUENTIAL SYNC QUEUE & UNIVERSAL TAB PREFETCH
    // ============================================================================

    let isUniversalPrefetching = false;

    async function computeUniversalPrefetchList(env, articleSnapshot = null) {
        try {
            console.log('\n[PREFETCH ENGINE] Computing universal prefetch targets...');
            const articles = Array.isArray(articleSnapshot)
                ? articleSnapshot
                : (await env.RSS_DATA.get('articles', { type: 'json', shared: true }) || []);
            const blockedKeywords = await env.RSS_DATA.get('blockedArticleKeywords', { type: 'json' }) || [];
            const smartClustersRaw = await env.RSS_DATA.get('smartClusters', { type: 'json', shared: true }) || [];
            const toProcess = selectUniversalPrefetchTargets(articles, smartClustersRaw, blockedKeywords);
            console.log(`[PREFETCH ENGINE] Computed ${toProcess.length} prefetch targets for the next atomic database commit.`);
            return toProcess;
        } catch (e) {
            console.error('[PREFETCH ENGINE] Target computation failed:', e.message);
            return null;
        }
    }

    async function runUniversalTabPrefetch(env) {
        if (isUniversalPrefetching) return;
        isUniversalPrefetching = true;
        try {
            await waitForHttpIdle();
            const toProcess = await env.RSS_DATA.get('universalPrefetchTargets', { type: 'json' }) || [];
            console.log(`[PREFETCH ENGINE] Loaded ${toProcess.length} unique top-5 articles from cache. Checking cache and prefetching...`);


            let prefetchedCount = 0;
            for (const art of toProcess) {
                const url = art.link || art.originalLink;
                if (!url || isRedditUrl(url)) continue;
                let cached = await getCachedArticle(url);
                if (!cached && googleNews.googleNewsUrlCache && googleNews.googleNewsUrlCache.has(url) && googleNews.googleNewsUrlCache.get(url).resolvedUrl) {
                    cached = await getCachedArticle(googleNews.googleNewsUrlCache.get(url).resolvedUrl);
                }
                if (cached && cached.content) {
                    enqueuePrefetchedSummary(url, art, 2);
                    continue; // Already saved on disk, ready to serve!
                }

                try {
                    const policy = await getArticleFetchPolicy(url, art.feedUrl || '');
                    const result = await prefetchArticleStrategies(url, art, policy, {
                        fetchParsedArticleByStrategy, requiresIndependentDeletionConfirmation,
                        buildDeletedSourceResponse, cacheArticleResult, enqueuePrefetchedSummary,
                        lane: 'p4', priority: 2, delayMs: 600
                    });
                    if (result?.content) prefetchedCount++;
                } catch (e) {}
            }
            console.log(`[PREFETCH ENGINE] Universal prefetch completed. Prefetched and saved ${prefetchedCount} new articles to disk.`);
        } catch (err) {
            console.error('[PREFETCH ENGINE] Fatal error:', err.message);
        } finally {
            isUniversalPrefetching = false;
        }
    }

    return {
        prefetchOpenCliOnlyArticles,
        computeUniversalPrefetchList,
        runUniversalTabPrefetch,
        triggerNextFiveArticlesPrefetch
    };
}
