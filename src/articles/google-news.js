import GoogleDecoderPkg from 'google-news-url-decoder';
import { safeHttpUrl, publisherIcon, isInvalidImage } from '../utils/article-utils.js';
import { isGoogleNewsArticleUrl, parseOpenCliSearchDestination, isGoogleNewsHostedThumbnail } from './search-destination.js';
import { decodeHTMLEntities, normalizeArticleTitle } from '../../feed-parsers.js';
import path from 'path';
import { normalizeArticleSourceUrl } from '../article-source-state.js';
import { matchesGoogleNewsPublisher, decodeGoogleNewsIndividually } from '../google-news-destination.js';

export function createGoogleNewsResolver({
    env,
    BROWSER_HEADERS,
    execFileAsync,
    getLastKnownCachedArticle,
} = {}) {
    const { GoogleDecoder } = GoogleDecoderPkg;

    const googleDecoder = new GoogleDecoder();

    async function decodeGoogleNews(url) {
        if (url && typeof url === 'string' && url.includes('news.google.com/rss/articles/')) {
            try {
                const result = await googleDecoder.decode(url);
                if (result && result.decoded_url) {
                    return result.decoded_url;
                }
            } catch (e) { }
        }
        return url;
    }

    const GOOGLE_NEWS_URL_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

    const GOOGLE_NEWS_URL_FAILURE_TTL_MS = 5 * 60 * 1000;

    let googleNewsUrlCache = null;

    let googleNewsUrlCacheSaveTimer = null;

    const googleNewsUrlPending = new Map();

    let googleNewsResolveStartQueue = Promise.resolve();

    let googleNewsLastResolveStart = 0;

    let _googleNewsCircuitBreakerUntil = 0;

    async function scheduleGoogleNewsLookup(task) {
        if (Date.now() < _googleNewsCircuitBreakerUntil) {
            throw new Error('Google News rate limit (HTTP 429) active; circuit open');
        }
        const previous = googleNewsResolveStartQueue.catch(() => {});
        let release;
        googleNewsResolveStartQueue = new Promise(resolve => { release = resolve; });
        await previous;
        if (Date.now() < _googleNewsCircuitBreakerUntil) {
            release();
            throw new Error('Google News rate limit (HTTP 429) active; circuit open');
        }
        const waitMs = Math.max(0, 700 - (Date.now() - googleNewsLastResolveStart));
        if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
        googleNewsLastResolveStart = Date.now();
        release();
        try {
            return await task();
        } catch (e) {
            if (e && (e.message?.includes('429') || e.status === 429)) {
                _googleNewsCircuitBreakerUntil = Date.now() + 120000;
            }
            throw e;
        }
    }

    async function ensureGoogleNewsUrlCache() {
        if (!googleNewsUrlCache) {
            const obj = await env.RSS_DATA.get('googleNewsUrlCache', { type: 'json' }) || {};
            googleNewsUrlCache = new Map(Object.entries(obj));
        }
        return googleNewsUrlCache;
    }

    function scheduleGoogleNewsUrlCacheSave() {
        if (googleNewsUrlCacheSaveTimer) return;
        googleNewsUrlCacheSaveTimer = setTimeout(async () => {
            googleNewsUrlCacheSaveTimer = null;
            try {
                if (!googleNewsUrlCache) return;
                const obj = Object.fromEntries(googleNewsUrlCache);
                await env.RSS_DATA.put('googleNewsUrlCache', JSON.stringify(obj));
            } catch (error) {
                console.error('[GOOGLE NEWS] Could not persist destination cache:', error.message);
            }
        }, 3000);
        if (googleNewsUrlCacheSaveTimer.unref) googleNewsUrlCacheSaveTimer.unref();
    }

    function findGoogleNewsResolvedUrl(node) {
        if (typeof node === 'string') {
            if (!node.includes('garturlres')) return '';
            try { return findGoogleNewsResolvedUrl(JSON.parse(node)); } catch (e) { return ''; }
        }
        if (!Array.isArray(node)) return '';
        if (node[0] === 'garturlres') return safeHttpUrl(node[1]);
        for (const child of node) {
            const found = findGoogleNewsResolvedUrl(child);
            if (found) return found;
        }
        return '';
    }

    async function decodeGoogleNewsArticleUrl(sourceUrl) {
        const articlePageUrl = sourceUrl.replace('/rss/articles/', '/articles/');
        const pageResponse = await fetch(articlePageUrl, { headers: BROWSER_HEADERS, redirect: 'follow' });
        if (!pageResponse.ok) throw new Error('Google News wrapper returned HTTP ' + pageResponse.status);
        if (pageResponse.url && !isGoogleNewsArticleUrl(pageResponse.url) && !/google\.com\/sorry\//i.test(pageResponse.url)) {
            return safeHttpUrl(pageResponse.url);
        }
        if (/google\.com\/sorry\//i.test(pageResponse.url || '')) throw new Error('Google News temporarily rate-limited destination lookup');
        const pageHtml = await pageResponse.text();
        const declaredUrl = decodeHTMLEntities(pageHtml.match(/<(?:link|meta)\b[^>]*(?:rel=(?:["'])canonical(?:["'])|property=(?:["'])og:url(?:["']))[^>]*(?:href|content)=(?:["'])(https?:\/\/[^"']+)(?:["'])/i)?.[1] || '');
        if (declaredUrl && !isGoogleNewsArticleUrl(declaredUrl) && !/google\.com\/sorry\//i.test(declaredUrl)) return safeHttpUrl(declaredUrl);
        const attribute = name => decodeHTMLEntities(pageHtml.match(new RegExp('\\s' + name + '=(?:"([^"]+)"|\'([^\']+)\')', 'i'))?.slice(1).find(Boolean) || '');
        const articleId = attribute('data-n-a-id') || sourceUrl.match(/\/(?:rss\/)?articles\/([^?]+)/)?.[1] || '';
        const timestamp = attribute('data-n-a-ts');
        const signature = attribute('data-n-a-sg');
        if (!articleId || !timestamp || !signature) throw new Error('Google News destination metadata was unavailable');

        const context = [
            ['en-US', 'US', ['FINANCE_TOP_INDICES', 'WEB_TEST_1_0_0'], null, null, 1, 1, 'US:en', null, 180, null, null, null, null, null, 0, null, null, [1608992183, 723341000]],
            'en-US', 'US', 1, [2, 3, 4, 8], 1, 0, '655000234', 0, 0, null, 0
        ];
        const innerRequest = JSON.stringify(['garturlreq', context, articleId, Number(timestamp), signature]);
        const form = new URLSearchParams({
            'f.req': JSON.stringify([[['Fbv4je', innerRequest, null, 'generic']]])
        });
        const rpcResponse = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
            method: 'POST',
            headers: {
                ...BROWSER_HEADERS,
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: form
        });
        if (!rpcResponse.ok) throw new Error('Google News destination lookup returned HTTP ' + rpcResponse.status);
        const rpcText = await rpcResponse.text();
        for (const line of rpcText.split(/\r?\n/).map(value => value.trim()).filter(value => value.startsWith('['))) {
            try {
                const resolved = findGoogleNewsResolvedUrl(JSON.parse(line));
                if (resolved && !isGoogleNewsArticleUrl(resolved)) return resolved;
            } catch (e) { }
        }
        throw new Error('Google News did not return a publisher destination');
    }

    function googleNewsPublisherDomain(hints = {}) {
        const candidates = [hints.domain, hints.sourceDomain];
        try {
            const feedUrl = new URL(hints.feedUrl || '');
            const query = feedUrl.searchParams.get('q') || '';
            const site = query.match(/(?:^|\s)site:([^\s)]+)/i)?.[1];
            if (site) candidates.unshift(site);
        } catch (e) { }
        const iconDomain = String(hints.feedIcon || '').match(/\/ip3\/([^/]+)\.ico/i)?.[1];
        if (iconDomain) candidates.push(iconDomain);
        for (const candidate of candidates) {
            let hostname = String(candidate || '').trim().toLowerCase().replace(/^www\./, '');
            try { hostname = new URL(hostname.includes('://') ? hostname : 'https://' + hostname).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { }
            if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(hostname) && hostname !== 'news.google.com' && hostname !== 'google.com') return hostname;
        }
        return '';
    }

    async function resolveGoogleNewsViaPublisherSearch(hints = {}) {
        const domain = googleNewsPublisherDomain(hints);
        let title = normalizeArticleTitle(hints.title || '').replace(/\s+-\s+[^-]{2,80}$/i, '').trim();
        if (!domain || title.length < 12) return '';
        const query = 'site:' + domain + ' "' + title.replace(/["\r\n]+/g, ' ') + '"';
        const response = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
            headers: BROWSER_HEADERS,
            signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) throw new Error('Publisher destination search returned HTTP ' + response.status);
        const html = await response.text();
        for (const match of html.matchAll(/(?:[?&]|&amp;)uddg=([^&"']+)/gi)) {
            let candidate = match[1];
            try { candidate = decodeURIComponent(decodeHTMLEntities(candidate)); } catch (e) { }
            const safe = safeHttpUrl(candidate);
            if (!safe) continue;
            const hostname = new URL(safe).hostname.toLowerCase().replace(/^www\./, '');
            if (hostname === domain || hostname.endsWith('.' + domain)) return safe;
        }
        return '';
    }

    async function resolveGoogleNewsViaOpenCliSearch(hints = {}) {
        const domain = googleNewsPublisherDomain(hints);
        const title = normalizeArticleTitle(hints.title || '').replace(/\s+-\s+[^-]{2,80}$/i, '').trim();
        if (!domain || title.length < 12) return '';
        const executable = path.resolve('./node_modules/.bin/opencli');
        const query = 'site:' + domain + ' "' + title.replace(/["\r\n]+/g, ' ') + '"';
        const { stdout } = await execFileAsync(executable, [
            'duckduckgo', 'search', query,
            '--limit', '5',
            '--window', 'background',
            '-f', 'json'
        ], {
            timeout: 45000,
            maxBuffer: 2 * 1024 * 1024
        });
        return parseOpenCliSearchDestination(stdout, domain);
    }

    async function resolveGoogleNewsUrl(sourceUrl, hints = {}, options = {}) {
        const original = safeHttpUrl(normalizeArticleSourceUrl(sourceUrl));
        if (!original || !isGoogleNewsArticleUrl(original)) return original || sourceUrl;
        const cache = await ensureGoogleNewsUrlCache();
        let cached = cache.get(original);
        if (cached?.resolvedUrl && !matchesGoogleNewsPublisher(cached.resolvedUrl, hints)) {
            cache.delete(original);
            cached = undefined;
        }
        if (cached) {
            // LRU bump
            cache.delete(original);
            cache.set(original, cached);
        }
        const ttl = cached?.resolvedUrl ? GOOGLE_NEWS_URL_CACHE_TTL_MS : GOOGLE_NEWS_URL_FAILURE_TTL_MS;
        if (cached?.cachedAt && Date.now() - cached.cachedAt < ttl && (cached.resolvedUrl || !options.force)) return cached.resolvedUrl || original;
        if (googleNewsUrlPending.has(original)) {
            return options.backgroundResolve ? (cached?.resolvedUrl || original) : googleNewsUrlPending.get(original);
        }
        if (options.isSubItem && !cached?.resolvedUrl) {
            return cached?.resolvedUrl || original;
        }
        if (options.backgroundResolve && (Date.now() < _googleNewsCircuitBreakerUntil || googleNewsUrlPending.size > 15)) {
            return cached?.resolvedUrl || original;
        }

        const pending = (async () => {
            let resolvedUrl = '';
            let resolutionError = '';
            try {
                const result = await googleDecoder.decode(original);
                if (result && result.decoded_url) {
                    resolvedUrl = result.decoded_url;
                }
            } catch (error) {
                resolutionError = error.message;
            }
            if (resolvedUrl && !matchesGoogleNewsPublisher(resolvedUrl, hints)) resolvedUrl = '';
            if (!resolvedUrl) {
                try {
                    resolvedUrl = await decodeGoogleNewsArticleUrl(original);
                } catch (error) {
                    resolutionError += (resolutionError ? '; ' : '') + error.message;
                }
            }
            if (resolvedUrl && !matchesGoogleNewsPublisher(resolvedUrl, hints)) resolvedUrl = '';
            if (!resolvedUrl) {
                try {
                    resolvedUrl = await decodeGoogleNewsOriginalUrl(original, hints);
                } catch (error) {
                    resolutionError += (resolutionError ? '; ' : '') + error.message;
                }
            }
            if (resolvedUrl && !matchesGoogleNewsPublisher(resolvedUrl, hints)) resolvedUrl = '';
            if (!resolvedUrl) {
                try {
                    resolvedUrl = await resolveGoogleNewsViaPublisherSearch(hints);
                } catch (error) {
                    resolutionError += (resolutionError ? '; ' : '') + error.message;
                }
            }
            if (resolvedUrl && !matchesGoogleNewsPublisher(resolvedUrl, hints)) resolvedUrl = '';
            if (!resolvedUrl) {
                try {
                    resolvedUrl = await resolveGoogleNewsViaOpenCliSearch(hints);
                } catch (error) {
                    resolutionError += (resolutionError ? '; ' : '') + 'OpenCLI search: ' + error.message;
                }
            }
            if (resolvedUrl && !matchesGoogleNewsPublisher(resolvedUrl, hints)) resolvedUrl = '';
            if (!resolvedUrl && resolutionError) console.error('[GOOGLE NEWS] Destination resolution failed:', resolutionError);
            cache.set(original, { resolvedUrl, individuallyDecoded: true, cachedAt: Date.now(), error: resolvedUrl ? '' : resolutionError });
            if (cache.size > 3000) cache.delete(cache.keys().next().value);
            scheduleGoogleNewsUrlCacheSave();
            return resolvedUrl || original;
        })().finally(() => googleNewsUrlPending.delete(original));
        googleNewsUrlPending.set(original, pending);
        if (options.backgroundResolve) {
            return cached?.resolvedUrl || original;
        }
        return pending;
    }

    async function resolveSmartArticleDestinations(sourceResults = []) {
        const articles = sourceResults.flatMap(result => Array.isArray(result?.articles) ? result.articles : []);
        const wrappers = [...new Set(articles.map(article => article?.link).filter(isGoogleNewsArticleUrl))];
        if (!wrappers.length) return { attempted: 0, resolved: 0 };

        const cache = await ensureGoogleNewsUrlCache();
        const now = Date.now();
        const uncached = wrappers.filter(url => {
            const entry = cache.get(url);
            return !entry?.resolvedUrl || now - Number(entry.cachedAt || 0) >= GOOGLE_NEWS_URL_CACHE_TTL_MS;
        });

        if (uncached.length) {
            try {
                const decoded = await decodeGoogleNewsIndividually(googleDecoder, uncached);
                for (const result of decoded || []) {
                    const sourceUrl = safeHttpUrl(result?.source_url);
                    const destination = safeHttpUrl(result?.decoded_url);
                    if (!sourceUrl || !destination || isGoogleNewsArticleUrl(destination)) continue;
                    cache.set(sourceUrl, { resolvedUrl: destination, individuallyDecoded: true, cachedAt: Date.now(), error: '' });
                }
                scheduleGoogleNewsUrlCacheSave();
            } catch (error) {
                console.warn('[SMART NEWS] Could not batch-resolve Google News destinations:', error.message);
            }
        }

        let resolvedCount = 0;
        for (const article of articles) {
            const wrapper = article?.link;
            if (!isGoogleNewsArticleUrl(wrapper)) continue;
            let destination = cache.get(wrapper)?.resolvedUrl || '';
            if (destination && !matchesGoogleNewsPublisher(destination, article)) {
                cache.delete(wrapper);
                destination = '';
            }
            if (!destination) {
                // Start the more expensive publisher-search fallbacks without
                // delaying the Smart sync. A later card request or sync reuses it.
                destination = await resolveGoogleNewsUrl(wrapper, article, { backgroundResolve: true });
            }
            if (!destination || isGoogleNewsArticleUrl(destination) || !matchesGoogleNewsPublisher(destination, article)) continue;

            article.originalLink = wrapper;
            article.link = normalizeArticleSourceUrl(destination);
            article.domain = new URL(article.link).hostname.replace(/^www\./, '');
            article.feedIcon = publisherIcon(article.link);
            if (!article.image || isInvalidImage(article.image) || isGoogleNewsHostedThumbnail(article.image)) {
                const cachedArticle = await getLastKnownCachedArticle(article.link);
                const cachedImage = safeHttpUrl(cachedArticle?.image);
                article.image = cachedImage && !isInvalidImage(cachedImage)
                    ? cachedImage
                    : `/api/og-image?url=${encodeURIComponent(article.link)}`;
            }
            resolvedCount++;
        }
        return { attempted: wrappers.length, resolved: resolvedCount };
    }

    return {
        googleDecoder,
        resolveGoogleNewsUrl,
        get googleNewsUrlCache() { return googleNewsUrlCache; },
        decodeGoogleNews,
        resolveSmartArticleDestinations
    };
}
