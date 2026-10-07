import { isInvalidImage, isRedditUrl } from '../utils/article-utils.js';
import { getArticleThumbnail } from './thumbnail.js';
import { withArticleFetchLane } from './fetch-lanes.js';

export function createArticleImages({
    getLastKnownCachedArticle,
    getLastKnownCachedArticleImage = async url => getArticleThumbnail(url, await getLastKnownCachedArticle(url)),
    getArticleFetchPolicy,
    fetchParsedArticleByStrategy,
    cacheArticleResult,
} = {}) {
    const pending = new Map();

    async function resolveImage(targetUrl, rssFallback) {
        const cachedImage = await getLastKnownCachedArticleImage(targetUrl);
        if (cachedImage) return cachedImage;
        if (rssFallback && !isInvalidImage(rssFallback)) return rssFallback;

        // Share the article reader's source policy, ordering, and fetch pipeline.
        // Source-specific image scrapers must not introduce unconfigured methods.
        const policy = await getArticleFetchPolicy(targetUrl);
        for (const strategy of policy.strategyOrder) {
            try {
                const result = await withArticleFetchLane('p2',
                    () => fetchParsedArticleByStrategy(strategy, targetUrl, policy),
                    { source: 'card-thumbnail' });
                if (!result?.content || result.isDeletedSource || result.sourceDeleted) continue;
                const image = getArticleThumbnail(targetUrl, result);
                await cacheArticleResult(targetUrl, { ...result, ...(image ? { image } : {}) });
                if (image) return image;
            } catch { /* Try only the next method allowed by the source policy. */ }
        }
        return null;
    }

    async function getBestImage(targetUrl, _fetchFn, rssFallback = null) {
        if (isRedditUrl(targetUrl)) return rssFallback || '';
        targetUrl = targetUrl.replace(/\/unread\/?$/, '');
        const key = JSON.stringify([targetUrl, rssFallback]);
        if (!pending.has(key)) {
            pending.set(key, resolveImage(targetUrl, rssFallback).finally(() => pending.delete(key)));
        }
        return pending.get(key);
    }

    const EAGER_ARTICLE_IMAGE_CONCURRENCY = 2;

    let activeEagerArticleImages = 0;

    const eagerArticleImageQueue = [];

    function scheduleEagerArticleImage(task) {
        return new Promise((resolve, reject) => {
            eagerArticleImageQueue.push({ task, resolve, reject });
            const drain = () => {
                while (activeEagerArticleImages < EAGER_ARTICLE_IMAGE_CONCURRENCY && eagerArticleImageQueue.length) {
                    const job = eagerArticleImageQueue.shift();
                    activeEagerArticleImages++;
                    Promise.resolve()
                        .then(job.task)
                        .then(job.resolve, job.reject)
                        .finally(() => {
                            activeEagerArticleImages--;
                            drain();
                        });
                }
            };
            drain();
        });
    }

    async function fetchPdfCreationDate(url) {
        if (!url || !url.toLowerCase().includes('.pdf')) return null;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(url, { headers: { "Range": "bytes=-32768" }, signal: controller.signal });
            let text = "";
            let bytesRead = 0;
            if (res.body && typeof res.body.getReader === "function") {
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    text += decoder.decode(value, { stream: true });
                    bytesRead += value.length;
                    const match = text.match(/CreationDate\s*\(\s*D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([-+\d'"Z]*)/);
                    if (match) {
                        controller.abort();
                        clearTimeout(timeout);
                        let iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
                        let tz = match[7];
                        if (tz) {
                            if (tz.includes("Z")) iso += "Z";
                            else {
                                let signMatch = tz.match(/([-+])(\d{2})'?(\d{2})?'?/);
                                if (signMatch) iso += `${signMatch[1]}${signMatch[2]}:${signMatch[3] || "00"}`;
                                else iso += "Z";
                            }
                        } else iso += "Z";
                        let d = new Date(iso);
                        if (!isNaN(d.getTime())) return d.toISOString();
                        break;
                    }
                    if (bytesRead > 5 * 1024 * 1024) { // abort if more than 5MB downloaded to save time
                        controller.abort();
                        break;
                    }
                }
            }
            clearTimeout(timeout);
        } catch(e) {}
        return null;
    }

    return {
        fetchPdfCreationDate,
        scheduleEagerArticleImage,
        getBestImage
    };
}
