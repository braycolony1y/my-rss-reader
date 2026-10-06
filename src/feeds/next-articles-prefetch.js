import { isRedditUrl } from '../utils/article-utils.js';
import { isDeletedArticlePayload } from '../article-source-state.js';
import { enhanceArticleResultForSource } from '../articles/source-results.js';
import { withArticleFetchLane, getCurrentArticleFetchLaneContext } from '../articles/fetch-lanes.js';

export function createNextArticlesPrefetch({ env, getCachedArticleMetadata, getCachedArticle, enqueuePrefetchedSummary, progress, getArticleFetchPolicy, fetchParsedArticleByStrategy, requiresIndependentDeletionConfirmation, buildDeletedSourceResponse, cacheArticleResult }) {
    let currentPrefetchRunId = 0;

    async function triggerNextFiveArticlesPrefetch(currentUrl, dryRun = false, prefetchTargets = null, waitPromise = null) {
        if (isRedditUrl(currentUrl) || getCurrentArticleFetchLaneContext().lane !== 'p0') return [];
        const runId = ++currentPrefetchRunId;
        const urlsToPrefetch = new Map();
        try {
            const articles = await env.RSS_DATA.get('articles', { type: 'json', shared: true }) || [];

            if (prefetchTargets && prefetchTargets.length > 0) {
                for (const target of prefetchTargets) {
                    const targetUrl = typeof target === 'string' ? target : (target?.url || target?.originalLink || target?.link);
                    if (!targetUrl || isRedditUrl(targetUrl) || urlsToPrefetch.size >= 5) continue;
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
                        if (u && !isRedditUrl(u) && u !== currentUrl && urlsToPrefetch.size < 5) urlsToPrefetch.set(u, art);
                    }
                }
            }
        } catch (e) {}

        const list = await Promise.all([...urlsToPrefetch.keys()].map(async u => {
            try {
                // The open article only needs status badges for upcoming cards.
                // Preparing five full thread bodies here delayed its response.
                if (getCachedArticleMetadata) {
                    const metadata = await getCachedArticleMetadata(u);
                    return { url: u, isCached: metadata?.fresh === true };
                }
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
                                const parsedPayload = await withArticleFetchLane('p2', () => fetchParsedArticleByStrategy(
                                    strategy,
                                    targetUrl,
                                    policy,
                                    art?.feedUrl || '',
                                    art?.title || ''
                                ));
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

    return triggerNextFiveArticlesPrefetch;
}
