import { normalizeArticleSourceUrl, isDeletedArticlePayload } from '../article-source-state.js';
import { safeHttpUrl, normalizeStateUrl, isInvalidImage } from '../utils/article-utils.js';
import sourceRegistry from '../sources/index.js';
import { enhanceArticleResultForSource } from '../articles/source-results.js';
import { normalizeBlockedKeywordEntries, articleContentFilterMatches } from '../filters/content-filter.js';
import { cleanStoredCluster } from '../../smart-news.js';

export function createArticlePrefetch({
    getBestImage,
    BROWSER_HEADERS,
    getCachedArticle,
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
    let openCliIngestPrefetchTail = Promise.resolve();

    const openCliIngestPrefetchInFlight = new Map();

    function scheduleOpenCliIngestPrefetch(article, feedUrl = '') {
        const url = normalizeArticleSourceUrl(article?.link || article?.url || '');
        if (!safeHttpUrl(url)) return Promise.resolve(false);
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

                const result = await fetchParsedArticleByStrategy(
                    'opencli',
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
                    fetchStrategy: 'opencli'
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

    let currentPrefetchRunId = 0;

    async function triggerNextFiveArticlesPrefetch(currentUrl, dryRun = false, prefetchTargets = null, waitPromise = null) {
        const runId = ++currentPrefetchRunId;
        const urlsToPrefetch = new Map();
        try {
            const articles = await env.RSS_DATA.get('articles', { type: 'json', shared: true }) || [];

            if (prefetchTargets && prefetchTargets.length > 0) {
                for (const target of prefetchTargets) {
                    const targetUrl = typeof target === 'string' ? target : (target?.url || target?.originalLink || target?.link);
                    if (!targetUrl || urlsToPrefetch.size >= 5) continue;
                    const knownArticle = articles.find(article =>
                        [article?.link, article?.originalLink, article?.id].includes(targetUrl)
                    );
                    urlsToPrefetch.set(targetUrl, {
                        ...(knownArticle || {}),
                        ...(typeof target === 'object' && target ? target : {})
                    });
                }
            } else {
                // Check next 5 in active articles list (Fallback if not provided)
                const idx = articles.findIndex(a => (a.originalLink || a.link) === currentUrl);
                if (idx !== -1) {
                    for (let i = idx + 1; i < Math.min(articles.length, idx + 6); i++) {
                        const art = articles[i];
                        const u = art?.originalLink || art?.link;
                        if (u && u !== currentUrl && urlsToPrefetch.size < 5) urlsToPrefetch.set(u, art);
                    }
                }
            }
        } catch (e) {}

        const list = await Promise.all([...urlsToPrefetch.keys()].map(async u => {
            try {
                const cached = await getCachedArticle(u);
                return { url: u, isCached: !!(cached && cached.content) };
            } catch {
                return { url: u, isCached: false };
            }
        }));

        if (urlsToPrefetch.size === 0 || dryRun) return list;

        setTimeout(async () => {
            try {
                console.log(`[NEXT-5 PREFETCH] Triggered background prefetch for ${urlsToPrefetch.size} articles after reading ${currentUrl}`);

                for (const [targetUrl, art] of urlsToPrefetch.entries()) {
                    if (currentPrefetchRunId !== runId) {
                        console.log(`[NEXT-5 PREFETCH] Aborting old prefetch queue for ${currentUrl} because a newer article was opened.`);
                        return;
                    }
                    // Wait for any active foreground article requests to finish so we don't starve opencli/puppeteer
                    while (progress.activeForegroundRequests > 0) {
                        if (currentPrefetchRunId !== runId) return;
                        await new Promise(r => setTimeout(r, 1000));
                    }

                    let cached = await getCachedArticle(targetUrl);
                    if (cached && cached.content) {
                        enqueuePrefetchedSummary(targetUrl, art, 1);
                        continue;
                    }
                    try {
                        const policy = await getArticleFetchPolicy(targetUrl, art?.feedUrl || '');
                        const deletionEvidence = new Set();
                        let prefetched = false;
                        for (const strategy of policy.strategyOrder) {
                            try {
                                const parsedPayload = await fetchParsedArticleByStrategy(
                                    strategy,
                                    targetUrl,
                                    policy,
                                    art?.feedUrl || '',
                                    art?.title || ''
                                );
                                if (isDeletedArticlePayload(targetUrl, parsedPayload)) {
                                    deletionEvidence.add(strategy);
                                    if (requiresIndependentDeletionConfirmation(targetUrl)) continue;
                                    await buildDeletedSourceResponse(targetUrl, { fallbackTitle: art?.title || '' });
                                    prefetched = true;
                                    break;
                                }
                                if (parsedPayload && parsedPayload.content) {
                                    const enhancedPayload = enhanceArticleResultForSource(targetUrl, parsedPayload, {
                                        description: art?.description || art?.content || ''
                                    });
                                    await cacheArticleResult(targetUrl, enhancedPayload);
                                    console.log(`[NEXT-5 PREFETCH] Cached ready to serve: ${targetUrl}`);
                                    enqueuePrefetchedSummary(targetUrl, art, 1);
                                    prefetched = true;
                                    break;
                                }
                            } catch(e) {}
                        }
                        if (!prefetched && deletionEvidence.size >= 2) {
                            await buildDeletedSourceResponse(targetUrl, {
                                fallbackTitle: art?.title || '',
                                deletionConfirmedBy: [...deletionEvidence]
                            });
                        }
                    } catch(e) {}
                    await new Promise(r => setTimeout(r, 500));
                }
            } catch (e) {
                console.error(`[NEXT-5 PREFETCH ERROR] ${e.message}`);
            }
        }, 200);
        return list;
    }

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
            const blockedKeywordEntries = normalizeBlockedKeywordEntries(blockedKeywords);
            const articleIsBlocked = article => articleContentFilterMatches(article, blockedKeywordEntries);
            const safeDate = dateVal => { try { const d = new Date(dateVal); return isNaN(d.getTime()) ? 0 : d.getTime(); } catch(e) { return 0; } };
            const smartClustersRaw = await env.RSS_DATA.get('smartClusters', { type: 'json', shared: true }) || [];
            const smartClusters = smartClustersRaw.map(c => cleanStoredCluster(c)).filter(a => a && !articleIsBlocked(a));
            const activeArticles = articles.filter(a => a && !articleIsBlocked(a));

            const topArticlesMap = new Map();
            const addTopFive = (list) => {
                if (!Array.isArray(list)) return;
                for (let i = 0; i < Math.min(5, list.length); i++) {
                    const art = list[i];
                    if (!art) continue;
                    const url = art.link || art.originalLink;
                    if (url && !topArticlesMap.has(url)) {
                        topArticlesMap.set(url, { url, title: art.title, originalLink: art.originalLink, link: art.link });
                    }
                }
            };

            // 1. Smart tabs top 5 each
            const smartCategories = ['news_vietnam', 'news_world', 'finance_vietnam', 'finance_global', 'tech'];
            for (const cat of smartCategories) {
                const catArticles = smartClusters.filter(a => {
                    if (cat === 'news_vietnam' || cat === 'news_world') return ['news_vietnam', 'news_world'].includes(a.smartCategory) && (cat === 'news_vietnam' ? a.smartCategory === 'news_vietnam' : a.smartCategory === 'news_world');
                    if (cat === 'finance_vietnam' || cat === 'finance_global') return ['finance_vietnam', 'finance_global'].includes(a.smartCategory) && (cat === 'finance_vietnam' ? a.smartCategory === 'finance_vietnam' : a.smartCategory === 'finance_global');
                    return a.smartCategory === cat;
                }).sort((a, b) =>
                    (b.hotness || 0) - (a.hotness || 0) ||
                    (b.sourceWeight || 1) - (a.sourceWeight || 1) ||
                    (new Date(b.pubDate || 0).getTime()) - (new Date(a.pubDate || 0).getTime())
                );
                addTopFive(catArticles);
            }

            // 2. Standard main tabs top 5 each
            const todaySorted = [...activeArticles].sort((a, b) => (new Date(b.pubDate || 0).getTime()) - (new Date(a.pubDate || 0).getTime()));
            addTopFive(todaySorted);

            const now = Date.now();
            const hotToday = activeArticles.filter(a => safeDate(a.pubDate) > now - 24 * 60 * 60 * 1000)
                .sort((a, b) => ((b.views || 0) + (b.clicks || 0) * 3) - ((a.views || 0) + (a.clicks || 0) * 3));
            addTopFive(hotToday);

            const hotWeek = activeArticles.filter(a => safeDate(a.pubDate) > now - 7 * 24 * 60 * 60 * 1000)
                .sort((a, b) => ((b.views || 0) + (b.clicks || 0) * 3) - ((a.views || 0) + (a.clicks || 0) * 3));
            addTopFive(hotWeek);

            const viewsToday = [...activeArticles].filter(a => safeDate(a.pubDate) > now - 24 * 60 * 60 * 1000)
                .sort((a, b) => (b.views || 0) - (a.views || 0));
            addTopFive(viewsToday);

            // 3. Every Category tab top 5 each
            const allCategories = new Set(activeArticles.map(a => a.category).filter(Boolean));
            for (const catName of allCategories) {
                const catList = activeArticles.filter(a => a.category === catName)
                    .sort((a, b) => (new Date(b.pubDate || 0).getTime()) - (new Date(a.pubDate || 0).getTime()));
                addTopFive(catList);
            }

            const toProcess = Array.from(topArticlesMap.values());
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
                if (!url) continue;
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
                    const deletionEvidence = new Set();
                    let prefetched = false;
                    for (const strategy of policy.strategyOrder) {
                        try {
                            const parsedPayload = await fetchParsedArticleByStrategy(
                                strategy,
                                url,
                                policy,
                                art.feedUrl || '',
                                art.title || ''
                            );
                            if (isDeletedArticlePayload(url, parsedPayload)) {
                                deletionEvidence.add(strategy);
                                if (requiresIndependentDeletionConfirmation(url)) continue;
                                await buildDeletedSourceResponse(url, { fallbackTitle: art.title || '' });
                                prefetched = true;
                                break;
                            }
                            if (parsedPayload && parsedPayload.content) {
                                await cacheArticleResult(url, parsedPayload);
                                prefetchedCount++;
                                enqueuePrefetchedSummary(url, art, 2);
                                await new Promise(r => setTimeout(r, 600));
                                prefetched = true;
                                break;
                            }
                        } catch (error) {
                            // Try the next method within this source's allowed policy.
                        }
                    }
                    if (!prefetched && deletionEvidence.size >= 2) {
                        await buildDeletedSourceResponse(url, {
                            fallbackTitle: art.title || '',
                            deletionConfirmedBy: [...deletionEvidence]
                        });
                    }
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
