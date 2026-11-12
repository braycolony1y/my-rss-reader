import { shouldSkipFeedFetch } from './fetch-scope.js';
import { publishFeedResults } from './publish-results.js';
import { beginFeedPublication } from './publication-order.js';
import { coalesceFeedSync } from './coalescing.js';
import { backgroundPublisherFetch as fetch } from '../articles/background-publisher-fetch.js';
import {createFeedSourceAcquisition} from './source-acquisition.js';
import { parseK, parseBaoMoi, parseMorningstar, parseTechcombank, parseUOB, parseUOBVN } from './source-parsers.js';
import { createCacheObservationBatch } from './cache-observation-batch.js';
import { createFeedFetcher } from './fetch-feed.js';
import {createVozForumMetadataScraper} from './voz-forum-metadata.js';
import { publisherIcon, isInvalidImage, cleanUrl, normalizeStateUrl, isRedditUrl } from '../utils/article-utils.js';
import sourceRegistry from '../sources/index.js';
import { discardResponseBody } from '../fetch-response.js';
import { decodeHTMLEntities } from '../../feed-parsers.js';
import { decodeGoogleNewsIndividually, matchesGoogleNewsPublisher } from '../google-news-destination.js';

export function createFeedSync({
    observeCacheArticles = async () => {},
    CF_PROXY_BASE,
    BROWSER_HEADERS,
    VIETSERVER_PROXY_BASE,
    fetchViaVietserver,
    execFileAsync,
    recordFetch,
    fetchWithCookies,
    runParserWorker,
    googleDecoder,
    fetchPdfCreationDate,
    hasOnlyOpenCliFetchMethod,
    scheduleEagerArticleImage,
    getBestImage,
    prefetchOpenCliOnlyArticles,
    computeUniversalPrefetchList,
    reconcileAllConfiguredSourceFetchMethods,
    waitForHttpIdle,
    env,
    runUniversalTabPrefetch,
    gcAndLogMemory,
    fetchFeedResponse = createFeedFetcher({ CF_PROXY_BASE, VIETSERVER_PROXY_BASE, BROWSER_HEADERS }),
} = {}) {
    // Sync pause/resume control
    let syncPaused = false;

    let lastSyncCompletedAt = null;

    const manualSyncProgress = new Map();

    function setManualSyncProgress(requestId, stage, message, extra = {}) {
        if (!requestId) return;
        manualSyncProgress.set(requestId, {
            stage,
            message,
            done: false,
            ...extra,
            updatedAt: new Date().toISOString()
        });
    }

    function finishManualSyncProgress(requestId, message, extra = {}) {
        if (!requestId) return;
        manualSyncProgress.set(requestId, {
            stage: extra.failed ? 'error' : 'complete',
            message,
            done: true,
            ...extra,
            updatedAt: new Date().toISOString()
        });
        const cleanup = setTimeout(() => manualSyncProgress.delete(requestId), 2 * 60 * 1000);
        if (cleanup.unref) cleanup.unref();
    }

    const scrapeVozViews = createVozForumMetadataScraper({CF_PROXY_BASE, BROWSER_HEADERS});
    const acquireFeedSource = createFeedSourceAcquisition({CF_PROXY_BASE, BROWSER_HEADERS, VIETSERVER_PROXY_BASE,
        fetchViaVietserver, execFileAsync, recordFetch, fetchFeedResponse});

    const syncFeeds = coalesceFeedSync(runFeedSync);

    async function runFeedSync(env, targetFeedUrl = null, onProgress = null, targetCategory = null, {forcedFeedUrls, manualRefreshScopes = []} = {}) {
        const publicationOrder = beginFeedPublication(env.RSS_DATA);
        let rawFeeds = await env.RSS_DATA.get('feeds', { type: 'json' }) || [];
        const feeds = [];
        for (let f of rawFeeds) {
            let feedObj = typeof f === 'string' ? { url: f, title: new URL(f).hostname, category: 'Others' } : f;
            let cleanHostname = new URL(feedObj.url).hostname;
            if (cleanHostname.includes('cnbc')) cleanHostname = 'cnbc.com';
            if (cleanHostname.includes('dowjones') || cleanHostname.includes('dj.com') || cleanHostname.includes('wsj')) cleanHostname = 'wsj.com';
            if (cleanHostname.includes('bbc')) cleanHostname = 'bbc.com';
            feedObj.icon = sourceRegistry.getHandler(feedObj.url)?.publisherIcon?.(cleanHostname) || publisherIcon(cleanHostname);
            if (!feedObj.category) feedObj.category = 'Others';
            feeds.push(feedObj);
        }

        let existingArticles = await env.RSS_DATA.get('articles', { type: 'json' }) || [];
        const historyImageMap = new Map();
        const historyDateMap = new Map();
        const historyStatsMap = new Map();
        for (const article of existingArticles) {
            let historicalImage = article.image;
            if (historicalImage && !historicalImage.includes('/api/og-image') && !isInvalidImage(historicalImage)) {
                try {
                    const articleSource = sourceRegistry.getHandler(article.link);
                    if (articleSource?.isInvalidFeedImage?.(historicalImage)) historicalImage = null;
                } catch (error) { }
                if (historicalImage) historyImageMap.set(article.link, historicalImage);
            }
            if (article.pubDate) historyDateMap.set(article.link, article.pubDate);
            historyStatsMap.set(article.link, {
                replyCount: article.replyCount || 0,
                viewCount: article.viewCount || 0,
                createDate: article.createDate || null
            });
        }

        let newArticles = [];
        const cacheObservations = createCacheObservationBatch(observeCacheArticles);
        let syncLogs = [];
        let feedsToSync = targetFeedUrl ? feeds.filter(f => f.url === targetFeedUrl) : targetCategory ? feeds.filter(f => (f.category || 'Others') === targetCategory) : feeds;

        const CONCURRENCY_LIMIT = 5;
        const activePromises = new Set();

        const processOneFeed = async (feed, feedIndex) => {
            if (onProgress) onProgress({
                stage: 'feeds',
                message: `Refreshing ${feed.title || new URL(feed.url).hostname}…`,
                current: feedIndex + 1,
                total: feedsToSync.length
            });

            if (shouldSkipFeedFetch(feed, targetFeedUrl, forcedFeedUrls)) return;

            const feedFetchStart = Date.now();
            try {
                const {response, feedData: acquiredFeedData, failed, manualRecovery} = await acquireFeedSource(feed, {
                    feedFetchStart, syncLogs, manualRefreshScopes
                });
                if (failed) return;
                let feedData = acquiredFeedData;

                if (response && !response.ok && response.status !== 202) {
                    syncLogs.push({ Feed: feed.title || feed.url, Issue: `HTTP Error ${response.status}` });
                    recordFetch(feed.url, feed.title || feed.url, 'error', `HTTP ${response.status}`, Date.now() - feedFetchStart, { httpStatus: response.status, errorType: 'http' });
                    await discardResponseBody(response);
                    return;
                }

                const xmlData = response ? await response.text() : '';

                if (feedData) {
                    // Structured source handlers already return the common feed shape.
                } else if (feed.url.includes('baomoi.com')) {
                    // [BAO MOI LOGIC REMAINS UNCHANGED]
                    console.log(`[BÁO MỚI DEBUG] Intercepted Request to: ${feed.url} | HTTP Status: ${response.status}`);
                    try {
                        feedData = parseBaoMoi(xmlData);

                        feedData.items = await Promise.all(feedData.items.map(async (item, index) => {
                            try {
                                let fetchUrl = item.link;
                                if (fetchUrl.match(/-c(\d+)\.epi/i)) {
                                    fetchUrl = fetchUrl.replace(/-c(\d+)\.epi/i, '-r$1.epi');
                                }
                                const controller = new AbortController();
                                const timeoutId = setTimeout(() => controller.abort(), 6000);
                                let res;
                                try {
                                    res = await fetch(fetchUrl, {
                                        method: 'GET',
                                        headers: BROWSER_HEADERS,
                                        redirect: 'follow',
                                        signal: controller.signal
                                    });
                                } finally {
                                    clearTimeout(timeoutId);
                                }

                                if (res.url && !res.url.includes('baomoi.com')) {
                                    item.link = res.url;
                                    await discardResponseBody(res);
                                } else {
                                    const html = await res.text();
                                    let finalUrl = null;

                                    const isValidArticleUrl = (urlStr) => {
                                        try {
                                            let u = new URL(urlStr);
                                            let lower = urlStr.toLowerCase();
                                            return u.protocol.startsWith('http') &&
                                                !u.hostname.includes('baomoi.com') &&
                                                !u.hostname.includes('bmcdn.me') &&
                                                !u.hostname.includes('facebook.com') &&
                                                !u.hostname.includes('google.com') &&
                                                !lower.endsWith('.jpg') && !lower.endsWith('.jpeg') &&
                                                !lower.endsWith('.png') && !lower.endsWith('.webp') &&
                                                !lower.endsWith('.gif') && u.pathname.length > 15;
                                        } catch (e) { return false; }
                                    };

                                    const metaMatch = html.match(/url=['"]?(https:\/\/[^'"><\s]+)['"]?/i);
                                    const jsMatch = html.match(/window\.location\.(?:replace|href|assign)\s*=?\s*["']([^"']+)["']/i);

                                    if (metaMatch && isValidArticleUrl(metaMatch[1])) finalUrl = metaMatch[1];
                                    else if (jsMatch && isValidArticleUrl(jsMatch[1])) finalUrl = jsMatch[1];

                                    if (!finalUrl) {
                                        const jsonUrlMatches = html.matchAll(/"(?:originalUrl|url|link|targetUrl|sourceUrl)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi);
                                        for (let match of jsonUrlMatches) {
                                            try {
                                                let parsedUrl = JSON.parse(`"${match[1]}"`);
                                                if (!finalUrl && isValidArticleUrl(parsedUrl)) {
                                                    finalUrl = parsedUrl;
                                                }
                                            } catch (e) { }
                                        }
                                    }

                                    let targetHtml = html;
                                    let targetDomainUrl = item.link;

                                    if (finalUrl) {
                                        item.link = finalUrl;
                                        targetDomainUrl = finalUrl;

                                        try {
                                            const directHtml = await fetchWithCookies(item.link, 6000);
                                            if (directHtml) targetHtml = directHtml;
                                            else throw new Error("HTTP_BLOCK");
                                        } catch (timeErr) {
                                            try {
                                                const proxyController = new AbortController();
                                                const proxyTimeout = setTimeout(() => proxyController.abort(), 8000);
                                                let proxyRes;
                                                try {
                                                    proxyRes = await fetch(CF_PROXY_BASE + encodeURIComponent(item.link), {
                                                        signal: proxyController.signal
                                                    });
                                                } finally {
                                                    clearTimeout(proxyTimeout);
                                                }
                                                if (proxyRes.ok) targetHtml = await proxyRes.text();
                                                else {
                                                    await discardResponseBody(proxyRes);
                                                    console.log("[PROXY DEBUG] CF proxy failed for " + item.link + ", trying Vietserver...");
                                                    targetHtml = await fetchViaVietserver(item.link);
                                                }
                                            } catch (proxyErr) { }
                                        }
                                    }

                                    let pubTime = null;
                                    let publisher = null;
                                    let section = null;
                                    let isFallback = (targetHtml === html);
                                    let domainName = 'baomoi.com';
                                    try { domainName = new URL(targetDomainUrl).hostname.replace('www.', ''); } catch (e) { }

                                    if (!isFallback) {
                                        const metaTags = targetHtml.match(/<meta[^>]+>/ig) || [];
                                        let newTitle = null;
                                        const ogTitleMatch = targetHtml.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i) || targetHtml.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
                                        if (ogTitleMatch && ogTitleMatch[1]) newTitle = ogTitleMatch[1];

                                        if (!newTitle) {
                                            const h1Match = targetHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
                                            if (h1Match) {
                                                let h1Text = h1Match[1].replace(/<[^>]+>/g, '').trim();
                                                if (h1Text && h1Text.length > 10) newTitle = h1Text;
                                            }
                                        }

                                        if (!newTitle) {
                                            const titleMatch = targetHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
                                            if (titleMatch && titleMatch[1]) newTitle = titleMatch[1];
                                        }

                                        if (newTitle) item.title = decodeHTMLEntities(newTitle.trim());

                                        const ldJsonMatches = targetHtml.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/ig) || [];
                                        for (let block of ldJsonMatches) {
                                            try {
                                                const cleanJson = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').replace(/[\n\r\t]+/g, ' ').replace(/\\n/g, ' ').trim();
                                                const parsed = JSON.parse(cleanJson);
                                                const schemas = Array.isArray(parsed) ? parsed : [parsed];
                                                for (let schema of schemas) {
                                                    if (schema.datePublished && !pubTime) pubTime = schema.datePublished;
                                                    if (schema.publisher && schema.publisher.name && !publisher) {
                                                        let cand = schema.publisher.name.trim();
                                                        // Only accept human-readable names, reject raw URLs
                                                        if (!cand.startsWith('http') && !cand.toLowerCase().includes('.com') && !cand.toLowerCase().includes('.vn')) {
                                                            publisher = cand;
                                                        }
                                                    }
                                                    if (schema.articleSection && !section) section = schema.articleSection;

                                                    if (schema['@type'] === 'BreadcrumbList' && schema.itemListElement) {
                                                        for (let breadcrumb of schema.itemListElement) {
                                                            if (breadcrumb.position === 2 && breadcrumb.item && breadcrumb.item.name) {
                                                                let breadText = breadcrumb.item.name.trim();
                                                                if (breadText && !section) section = breadText;
                                                            }
                                                        }
                                                    }
                                                }
                                            } catch (e) { }
                                        }

                                        for (let tag of metaTags) {
                                            let contentMatch = tag.match(/content=["']([^"']+)["']/i);
                                            if (!contentMatch) continue;
                                            let content = contentMatch[1].trim();
                                            if (/(article:published_time|datepublished|pubdate|datecreated)/i.test(tag) && !pubTime) pubTime = content;
                                            if (/(og:site_name|sourceorganization|application-name)/i.test(tag) && !publisher) publisher = content;
                                            if (/(article:section|articlesection)/i.test(tag) && !section) section = content;
                                        }

                                        if (!pubTime) {
                                            const hardRegex = /(?:articlePublishDate|datePublished|publishDate|publish_date|dateCreated|post_date|published_at|created_at|publishedTime|news_date|time|display_time|ngaysuatban|article:published_time)[^>]{0,50}?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:\s*[+-]\d{2}:\d{2}|Z)?)/i;
                                            const hardMatch = targetHtml.match(hardRegex);
                                            if (hardMatch) pubTime = hardMatch[1];
                                        }

                                        if (!pubTime) {
                                            // Specific fallback for text-based DD/MM/YYYY - HH:mm (like hanoimoi.vn)
                                            const dateTextMatch = targetHtml.match(/(\d{2})\/(\d{2})\/(\d{4})\s*[-|]\s*(\d{2}):(\d{2})/i);
                                            if (dateTextMatch) {
                                                // Reformat to MM/DD/YYYY HH:mm+07:00 for reliable parsing
                                                pubTime = `${dateTextMatch[2]}/${dateTextMatch[1]}/${dateTextMatch[3]} ${dateTextMatch[4]}:${dateTextMatch[5]}+07:00`;
                                            }
                                        }

                                        if (!section) {
                                            const sectionMatchJSON = targetHtml.match(/"(?:category_name|articleSection|category|cate_name|cat_name|zone_name|chuyen_muc|cm_name|cate|chuyenmuc|categoryName|primary_category)"\s*:\s*"([^"\\]+)"/i);
                                            if (sectionMatchJSON) section = decodeHTMLEntities(sectionMatchJSON[1]).trim();
                                        }
                                    }

                                    if (pubTime) {
                                        let cleanTime = pubTime.replace(/&#x2B;/ig, '+').replace(/\s+([+-]\d{2}:\d{2})/g, '$1').trim();
                                        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?$/.test(cleanTime)) cleanTime += 'Z';
                                        else if (!cleanTime.includes('+') && !cleanTime.includes('-') && !cleanTime.toLowerCase().includes('z') && !cleanTime.toLowerCase().includes('gmt')) cleanTime += '+07:00';

                                        let parsedDate = new Date(cleanTime);
                                        if (!isNaN(parsedDate.getTime())) {
                                            // Auto-correct Vietnamese timezone bugs (e.g., site provides local time but appends "Z")
                                            if (parsedDate.getTime() > Date.now() + 5 * 60 * 1000) {
                                                parsedDate = new Date(parsedDate.getTime() - 7 * 60 * 60 * 1000);
                                            }

                                            // Allow slight future tolerance (1 hour) for server clock drift
                                            if (parsedDate.getTime() <= Date.now() + 60 * 60 * 1000 && parsedDate.getFullYear() > 2023) {
                                                item.pubDate = parsedDate.toISOString();
                                            }
                                        }
                                    }


                                    // [PATCH] Auto-repair generic baomoi titles
                                    if (item.title && (item.title.includes('Báo Mới') || item.title.includes('Tin tức 24H'))) {
                                        try {
                                            let u = new URL(item.link);
                                            let path = u.pathname.replace('.html', '').replace('.epi', '').replace('.htm', '');
                                            let segments = path.split('/').filter(Boolean);
                                            let slug = segments[segments.length - 1] || '';
                                            slug = slug.replace(/-\d+$/, '');
                                            let betterTitle = slug.replace(/-/g, ' ');
                                            betterTitle = betterTitle.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                                            if (betterTitle.length > 10) {
                                                item.title = betterTitle;
                                                if (item.content === item.title || item.content.includes('Báo Mới')) {
                                                    item.content = betterTitle;
                                                }
                                            }
                                        } catch (e) {}
                                    }

                                    if (publisher) {
                                        // Strip protocols and www
                                        publisher = publisher.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/i, '').trim();

                                        // Reject if it has a domain extension
                                        if (/\.(vn|com|net|org|info|edu)(\.vn)?$/i.test(publisher)) {
                                            publisher = null;
                                        } else if (publisher.toLowerCase() === domainName.split('.')[0].toLowerCase()) {
                                            // Capitalize first letter if it was exactly the domain prefix without extension
                                            publisher = publisher.charAt(0).toUpperCase() + publisher.slice(1);
                                        }
                                    }

                                    // Only fallback to logo alt if we have NO publisher at all
                                    if (!publisher) {
                                        if (domainName.toLowerCase().includes('baotintuc.vn')) {
                                            publisher = 'Báo Tin tức';
                                        } else {
                                            const logoAltMatch = targetHtml.match(/<img[^>]*logo[^>]*alt=["']([^"']+)["']/i) ||
                                                targetHtml.match(/<img[^>]*alt=["']([^"']+)["'][^>]*logo[^>]*>/i) ||
                                                targetHtml.match(/<a[^>]*logo[^>]*title=["']([^"']+)["']/i) ||
                                                targetHtml.match(/<title>.*?[-\|]\s*([^<]+)<\/title>/i);
                                            if (logoAltMatch) {
                                                publisher = decodeHTMLEntities(logoAltMatch[1]).trim();
                                            }
                                        }
                                    }

                                    if (publisher) {
                                        publisher = publisher.replace(/^(Báo điện tử|Báo|Tạp chí|Trang thông tin điện tử)\s+/i, '').trim();
                                        publisher = publisher.replace(/\s+News$/i, '').trim();
                                        if (publisher.includes('- Tin tức')) publisher = publisher.split('-')[0].trim();
                                        if (publisher.includes('|')) publisher = publisher.split('|')[0].trim();
                                        if (publisher === 'Mới' || publisher === 'Báo Mới') publisher = null;
                                    }

                                    let finalPublisher = publisher || domainName;
                                    item.customPublisher = section ? `${finalPublisher} • ${section}` : finalPublisher;
                                    let feedIconDomain = domainName;
                                    if (feedIconDomain.includes('dj.com') || feedIconDomain.includes('wsj')) feedIconDomain = 'wsj.com';
                                    if (feedIconDomain.includes('bbc')) feedIconDomain = 'bbc.com';
                                    item.customIcon = publisherIcon(feedIconDomain);

                                    // Explicitly define category
                                    if (section) {
                                        item.categories = [section];
                                    }
                                }
                            } catch (e) { }
                            return item;
                        }));

                    } catch (parseErr) {
                        syncLogs.push({ Feed: feed.title || feed.url, Issue: `Báo Mới Scraper crashed: ${parseErr.message}` });
                        recordFetch(feed.url, feed.title || feed.url, 'error', `Scraper crash: ${parseErr.message}`, Date.now() - feedFetchStart, { errorType: 'scraper' });
                        return;
                    }
                } else if (feed.url.includes('morningstar.com')) {
                    console.log(`[MORNINGSTAR DEBUG] Intercepted Request to: ${feed.url} | HTTP Status: ${response.status}`);
                    feedData = parseMorningstar(xmlData);
                } else if (feed.url.includes('techcombank.com')) {
                    console.log(`[TECHCOMBANK DEBUG] Intercepted Request to: ${feed.url} | HTTP Status: ${response.status}`);
                    feedData = parseTechcombank(xmlData);
                } else if (feed.url.includes('uobgroup.com')) {
                    console.log(`[UOB DEBUG] Intercepted Request to: ${feed.url} | HTTP Status: ${response.status}`);
                    feedData = parseUOB(xmlData);
                } else if (feed.url.includes('uob.com.vn')) {
                    console.log(`[UOB VN DEBUG] Intercepted Request to: ${feed.url} | HTTP Status: ${response.status}`);
                    feedData = parseUOBVN(xmlData);
                } else {
                    if (xmlData.trim().toLowerCase().startsWith('<!doctype html') || xmlData.trim().toLowerCase().startsWith('<html')) {
                        syncLogs.push({ Feed: feed.title || feed.url, Issue: 'Received HTML instead of XML.' });
                        recordFetch(feed.url, feed.title || feed.url, 'error', 'Received HTML instead of XML', Date.now() - feedFetchStart, { errorType: 'format' });
                        return;
                    }
                    try {
                        feedData = await runParserWorker('fastParseRSS', xmlData);
                    } catch (parseErr) {
                        syncLogs.push({ Feed: feed.title || feed.url, Issue: `XML Parser crashed: ${parseErr.message}` });
                        recordFetch(feed.url, feed.title || feed.url, 'error', `XML parse: ${parseErr.message}`, Date.now() - feedFetchStart, { errorType: 'parse' });
                        return;
                    }
                }

                try {
                    const isVoz = feed.url.includes('voz.vn');
                    if (feedData.feedTitle && (!feed.title || feed.title === new URL(feed.url).hostname || feed.title.startsWith('http'))) {
                        feed.title = feedData.feedTitle;
                    }

                    let scrapedViewsMap = new Map();
                    if (isVoz) {
                        // Try to scrape forum pages to get views since RSS lacks them
                        // We deduce forum URL from RSS URL: voz.vn/f/diem-bao.33/index.rss -> voz.vn/f/diem-bao.33/
                        let forumUrl = feed.url.replace('/index.rss', '/');
                        scrapedViewsMap = await scrapeVozViews(forumUrl);
                    }

                    if (!global.lastFetchTimeByUrl) global.lastFetchTimeByUrl = {};
                    global.lastFetchTimeByUrl[feed.url] = Date.now();

                    let decodedGoogleNewsLinks = new Map();
                    let googleNewsUrlsToDecode = [];
                    if (feed.url.includes('news.google.com')) {
                        googleNewsUrlsToDecode = feedData.items.map(i => i.link).filter(l => l && l.includes('news.google.com/rss/articles/'));
                        if (googleNewsUrlsToDecode.length > 0) {
                            try {
                                const results = await decodeGoogleNewsIndividually(googleDecoder, googleNewsUrlsToDecode);
                                results.forEach((res, idx) => {
                                    if (res.status && googleNewsUrlsToDecode.includes(res.source_url) && matchesGoogleNewsPublisher(res.decoded_url, { feedUrl: feed.url })) {
                                        decodedGoogleNewsLinks.set(res.source_url, res.decoded_url);
                                    }
                                });
                            } catch (e) {
                                console.error('[GOOGLE NEWS DECODE ERROR]', e.message);
                            }
                        }
                    }

                    const cacheArticles = [];
                    const eagerImageTasks = [];
                    const openCliOnlyArticlesToPrefetch = [];
                    for (const item of feedData.items) {
                        let safeLink = cleanUrl(item.link);
                        if (decodedGoogleNewsLinks.has(item.link)) {
                            safeLink = cleanUrl(decodedGoogleNewsLinks.get(item.link));
                            item.link = safeLink;
                        }
                        let threadIdMatch = safeLink.match(/\.(\d+)\//);
                        let threadId = threadIdMatch ? threadIdMatch[1] : null;

                        if (isVoz && threadId && scrapedViewsMap.has(threadId)) {
                            const stats = scrapedViewsMap.get(threadId);
                            if (stats.views != null) item.viewCount = stats.views;
                            if (stats.createDate) item.createDate = stats.createDate;
                            if (stats.replies != null && stats.replies > (item.replyCount || 0)) {
                                item.replyCount = stats.replies;
                            }
                        }
                        let articleSource = null;
                        try { articleSource = sourceRegistry.getHandler(safeLink); } catch (error) { }
                        let rssImageUrl = item.imageUrl;
                        if (rssImageUrl && rssImageUrl.startsWith('/')) {
                            try { rssImageUrl = new URL(rssImageUrl, feed.url).href; } catch (e) { }
                        }
                        if (isInvalidImage(rssImageUrl)) rssImageUrl = null;
                        if (rssImageUrl) {
                            try {
                                if (articleSource?.isInvalidFeedImage?.(rssImageUrl)) rssImageUrl = null;
                            } catch (error) { }
                        }
                        let finalImage = null;
                        if (!isVoz && rssImageUrl) finalImage = rssImageUrl;
                        if (!finalImage && historyImageMap.has(safeLink)) finalImage = historyImageMap.get(safeLink);

                        let finalTitle = item.customPublisher || feed.title;
                        if (finalTitle && finalTitle.startsWith('http')) {
                            finalTitle = feedData.feedTitle || new URL(feed.url).hostname;
                        }
                        let finalIcon = item.customIcon || feed.icon;

                        let normalizedPubDate = new Date().toISOString();
                        let parsedNewDate = null;
                        if (item.pubDate) {
                            let parsedDate = new Date(item.pubDate);
                            if (!isNaN(parsedDate.getTime())) {
                                // If it's more than 5 mins in the future, it might be a Vietnamese local time parsed as UTC
                                if (parsedDate.getTime() > Date.now() + 5 * 60 * 1000) {
                                    parsedDate = new Date(parsedDate.getTime() - 7 * 60 * 60 * 1000);
                                }
                                // Allow slight future tolerance (1 hour) for server clock drift
                                if (parsedDate.getTime() <= Date.now() + 60 * 60 * 1000) {
                                    parsedNewDate = parsedDate.toISOString();
                                }
                            }
                        }

                        if (historyDateMap.has(safeLink)) {
                            normalizedPubDate = historyDateMap.get(safeLink);
                            // For forums like Voz, bump the thread if there's a new reply (pubDate is newer)
                            if (isVoz && parsedNewDate && parsedNewDate > normalizedPubDate) {
                                normalizedPubDate = parsedNewDate;
                            }
                        } else if (parsedNewDate) {
                            normalizedPubDate = parsedNewDate;
                        }

                        // Backup: Use title as timeline for Macroeconomics
                        if (feed.category === 'Macroeconomics') {
                            let pdfDate = await fetchPdfCreationDate(safeLink);
                            if (pdfDate) {
                                normalizedPubDate = pdfDate;
                            } else {
                                let dateMatch = item.title.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
                                if (dateMatch) {
                                    try {
                                        let extDate = new Date(`${dateMatch[1]} 1, ${dateMatch[2]}`);
                                        if (!isNaN(extDate.getTime())) normalizedPubDate = extDate.toISOString();
                                    } catch(e) {}
                                } else {
                                    dateMatch = item.title.match(/(1H|2H|Q1|Q2|Q3|Q4)\s+(\d{4})/i);
                                    if (dateMatch) {
                                        try {
                                            let month = 1;
                                            let q = dateMatch[1].toUpperCase();
                                            if (q === '2H' || q === 'Q3') month = 7;
                                            else if (q === 'Q2') month = 4;
                                            else if (q === 'Q4') month = 10;
                                            let extDate = new Date(`${dateMatch[2]}-${month.toString().padStart(2, '0')}-01`);
                                            if (!isNaN(extDate.getTime())) normalizedPubDate = extDate.toISOString();
                                        } catch(e) {}
                                    }
                                }
                            }
                        }

                        // Restore previous stats as fallback
                        let finalReplyCount = item.replyCount || 0;
                        let finalViewCount = item.viewCount || 0;
                        let finalCreateDate = item.createDate || null;

                        if (historyStatsMap.has(safeLink)) {
                            const histStats = historyStatsMap.get(safeLink);
                            if (!finalReplyCount && histStats.replyCount) finalReplyCount = histStats.replyCount;
                            if (!finalViewCount && histStats.viewCount) finalViewCount = histStats.viewCount;
                            if (!finalCreateDate && histStats.createDate) finalCreateDate = histStats.createDate;
                        }

                        const articleRecord = {
                            feedUrl: feed.url,
                            feedTitle: finalTitle,
                            feedIcon: finalIcon,
                            feedCategory: feed.category,
                            title: item.title,
                            link: safeLink,
                            image: finalImage,
                            rssFallbackMap: rssImageUrl,
                            pubDate: normalizedPubDate,
                            createDate: finalCreateDate,
                            content: isRedditUrl(safeLink) ? '' : item.content,
                            replyCount: finalReplyCount,
                            viewCount: finalViewCount,
                            ...(item.guid ? { id: item.id || item.guid, guid: item.guid } : {}),
                            ...(item.groundNews ? { groundNews: item.groundNews, description: item.description, publishedAt: item.publishedAt, url: item.url } : {})
                        };
                        newArticles.push(articleRecord);
                        if (!isRedditUrl(safeLink)) cacheArticles.push(articleRecord);

                        if (!isRedditUrl(safeLink) && hasOnlyOpenCliFetchMethod(feed.fetchMethods)) {
                            openCliOnlyArticlesToPrefetch.push(articleRecord);
                        }

                        if (!finalImage && articleSource?.shouldResolveImageOnIngest?.()) {
                            eagerImageTasks.push(scheduleEagerArticleImage(async () => {
                                const resolvedImage = await getBestImage(
                                    safeLink,
                                    (imageUrl, options = {}) => fetch(imageUrl, { headers: BROWSER_HEADERS, ...options }),
                                    rssImageUrl
                                );
                                if (resolvedImage) articleRecord.image = resolvedImage;
                            }).catch(error => {
                                console.warn(`[IMAGE INGEST] Could not resolve ${safeLink}: ${error.message}`);
                            }));
                        }
                    }
                    cacheObservations.add(cacheArticles);
                    await Promise.all(eagerImageTasks);
                    await prefetchOpenCliOnlyArticles(openCliOnlyArticlesToPrefetch, feed.url);
                    await manualRecovery?.accept();
                    recordFetch(feed.url, feed.title || feed.url, 'success', `${feedData.items.length} articles`, Date.now() - feedFetchStart);
                } catch (parseErr) {
                    syncLogs.push({ Feed: feed.title || feed.url, Issue: `XML Parser crashed: ${parseErr.message}` });
                    recordFetch(feed.url, feed.title || feed.url, 'error', `Post-parse crash: ${parseErr.message}`, Date.now() - feedFetchStart, { errorType: 'post-parse' });
                }
            } catch (err) {
                syncLogs.push({ Feed: feed.title || feed.url, Issue: `Network Crash: ${err.message}` });
                recordFetch(feed.url, feed.title || feed.url, 'error', `Network: ${err.message}`, Date.now() - feedFetchStart, { errorType: 'network' });
            }
        };

        for (let feedIndex = 0; feedIndex < feedsToSync.length; feedIndex++) {
            const feed = feedsToSync[feedIndex];
            const p = processOneFeed(feed, feedIndex).finally(() => activePromises.delete(p));
            activePromises.add(p);

            if (activePromises.size >= CONCURRENCY_LIMIT) {
                await Promise.race(activePromises);
            }
            await new Promise(r => setTimeout(r, 500));
        }
        await Promise.all(activePromises);
        await cacheObservations.flush().catch(error => console.error('[RSS CACHE OBSERVATION]', error.message));

        await publishFeedResults(env.RSS_DATA, newArticles, feeds, !targetFeedUrl, publicationOrder);
        if (!targetFeedUrl) {
            await reconcileAllConfiguredSourceFetchMethods();
        }

        return { success: true, logs: syncLogs };
    }

    async function startSequentialSyncLoop() {
        console.log('🚀 [SYNC QUEUE] Sequential sync engine initialized.');

        while (true) {
            if (syncPaused) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                continue;
            }

            await waitForHttpIdle();

            const cycleStart = Date.now();

            try {
                let feeds = await env.RSS_DATA.get('feeds', { type: 'json' }) || [];

                if (feeds.length === 0) {
                    console.log('[SYNC QUEUE] No feeds found. Waiting before next check...');
                } else {
                    console.log(`\n[SYNC QUEUE] Starting batched cycle for ${feeds.length} feeds...`);

                    // syncFeeds already applies a bounded network concurrency limit.
                    // Running one coordinated cycle lets it merge, prune, back up,
                    // and persist the article database once instead of once per feed.
                    await syncFeeds(env);
                    lastSyncCompletedAt = Date.now();
                    runUniversalTabPrefetch(env).catch(e => console.error('[PREFETCH ENGINE] Error:', e.message));
                }
            } catch (err) {
                console.error('[SYNC QUEUE] Cycle encountered a fatal error:', err.message);
            }

            // Reclaim fetch buffers only when it will not pause a foreground request.
            gcAndLogMemory('Post-cycle');

            const cycleDuration = Date.now() - cycleStart;
            const MINIMUM_TIME = 10 * 60 * 1000;

            if (cycleDuration < MINIMUM_TIME) {
                const waitTime = MINIMUM_TIME - cycleDuration;
                console.log(`[SYNC QUEUE] Cycle finished in ${Math.round(cycleDuration / 1000)}s. Sleeping for ${Math.round(waitTime / 1000)}s to enforce 10-minute minimum...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
                // An overrun usually means the process is already under heavy
                // CPU/GC/I/O pressure. Starting another full feed cycle
                // immediately compounds queued board/database work.
                const recoveryDelay = 60 * 1000;
                console.log(
                    `[SYNC QUEUE] Cycle took ${Math.round(cycleDuration / 1000)}s. ` +
                    `Cooling down for ${Math.round(recoveryDelay / 1000)}s before the next cycle...`
                );
                await new Promise(resolve => setTimeout(resolve, recoveryDelay));
            }
        }
    }

    return {
        get syncPaused() { return syncPaused; },
        set syncPaused(value) { syncPaused = value; },
        get lastSyncCompletedAt() { return lastSyncCompletedAt; },
        manualSyncProgress,
        setManualSyncProgress,
        finishManualSyncProgress,
        syncFeeds,
        startSequentialSyncLoop
    };
}
