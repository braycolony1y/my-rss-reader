import { createTrackedFetch } from '../fetch-response.js';
import sourceRegistry from '../sources/index.js';
import { isInvalidImage, extractImageFromHtml, isRedditUrl } from '../utils/article-utils.js';
import { enhanceArticleResultForSource } from './source-results.js';

export function createArticleImages({
    getLastKnownCachedArticle,
    fetchWithCookies,
    fetchViaOpenCli,
    cacheArticleResult,
    CF_PROXY_BASE,
} = {}) {
    async function getBestImage(targetUrl, fetchFn, rssFallback = null) {
        if (isRedditUrl(targetUrl)) return rssFallback || '';
        const trackedFetch = createTrackedFetch(fetchFn);
        try {
            try {
                const sourceHandler = sourceRegistry.getHandler(targetUrl);
                const cachedArticle = await getLastKnownCachedArticle(targetUrl);
                const cachedImage = cachedArticle?.image;
                if (cachedImage && !isInvalidImage(cachedImage) && !sourceHandler?.isInvalidFeedImage?.(cachedImage)) {
                    return cachedImage;
                }
                if (sourceHandler && sourceHandler.getBestImage) {
                    let handledImg = await sourceHandler.getBestImage(targetUrl, trackedFetch.fetch, rssFallback, {
                        extractImageFromHtml,
                        fetchWithCookies,
                        fetchArticleWithBrowser: async browserUrl => {
                            const browserArticle = enhanceArticleResultForSource(
                                browserUrl,
                                await fetchViaOpenCli(browserUrl)
                            );
                            await cacheArticleResult(browserUrl, {
                                url: browserUrl,
                                ...browserArticle,
                                fetchStrategy: 'opencli'
                            });
                            return browserArticle;
                        },
                        isInvalidImage,
                        CF_PROXY_BASE
                    });
                    if (handledImg === 'NO_FALLBACK') return null;
                    if (handledImg) return handledImg;
                }

                // Metadata endpoints and documentation sites often allow the
                // original HTML while proxy mirrors omit or rewrite og:image.
                // Prefer that canonical metadata before trying the proxy.
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 8000);
                    try {
                        const directResponse = await trackedFetch.fetch(targetUrl, { signal: controller.signal });
                        if (directResponse.ok) {
                            const directHtml = await directResponse.text();
                            const directImage = extractImageFromHtml(directHtml, targetUrl);
                            if (directImage) {
                                return directImage.startsWith('/') ? new URL(directImage, targetUrl).href : directImage;
                            }
                        }
                    } finally {
                        clearTimeout(timeout);
                    }
                } catch (error) { }

                let fetchUrl = CF_PROXY_BASE + encodeURIComponent(targetUrl);
                const res = await trackedFetch.fetch(fetchUrl);
                if (!res.ok) {
                    if (rssFallback && !isInvalidImage(rssFallback)) return rssFallback;
                    return null;
                }
                let html = await res.text();
                let scopeHtml = html;


                let img = extractImageFromHtml(scopeHtml, targetUrl);
                if (img) return img.startsWith('/') ? new URL(img, targetUrl).href : img;

            } catch (e) {
                if (rssFallback && !isInvalidImage(rssFallback)) return rssFallback;
            }

            if (rssFallback && !isInvalidImage(rssFallback)) return rssFallback;
            return null;
        } finally {
            await trackedFetch.discardUnread();
        }
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
