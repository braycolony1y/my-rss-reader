import {prefetchArticleStrategies} from './prefetch-strategies.js';
import { isRedditUrl } from '../utils/article-utils.js';
import { getCurrentArticleFetchLaneContext } from '../articles/fetch-lanes.js';

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
                        await prefetchArticleStrategies(targetUrl, art, policy, {
                            fetchParsedArticleByStrategy, requiresIndependentDeletionConfirmation,
                            buildDeletedSourceResponse, cacheArticleResult, enqueuePrefetchedSummary,
                            lane: 'p2', priority: 1, enhance: true
                        });
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
