import { boundCacheObject } from '../database/sqlite/cache-retention.js';
import { createGoogleNewsDecoder, decodeGoogleNewsOffline, cleanGoogleNewsDestination } from './google-news-decode.js';
import { runGoogleNewsBrowserRedirect, runGoogleNewsBrowserTask } from '../browser/google-news-redirect.js';
import { resolveOpenCliExecutable } from '../browser/opencli-executable.js';
import { applyGoogleNewsDestinations } from './google-news-repair.js';
import { safeHttpUrl, publisherIcon, isInvalidImage } from '../utils/article-utils.js';
import { isGoogleNewsArticleUrl, parseOpenCliSearchDestination, isGoogleNewsHostedThumbnail } from './search-destination.js';
import { decodeHTMLEntities, normalizeArticleTitle } from '../../feed-parsers.js';
import { normalizeArticleSourceUrl } from '../article-source-state.js';
import { matchesGoogleNewsPublisher } from '../google-news-destination.js';

export function createGoogleNewsResolver({
    env,
    BROWSER_HEADERS,
    execFileAsync,
    getLastKnownCachedArticle,
    decoder,
    browserRedirect = url => runGoogleNewsBrowserRedirect(url, execFileAsync),
    now = Date.now,
} = {}) {
    const networkDecoder = decoder || createGoogleNewsDecoder({ headers: BROWSER_HEADERS });
    // Feed sync uses this same cached, paced decoder rather than a second npm instance.
    const googleDecoder = {
        async decode(url) {
            const decoded_url = await resolveGoogleNewsUrl(url, {}, { decodersOnly: true });
            return { status: Boolean(cleanGoogleNewsDestination(decoded_url)), decoded_url };
        },
        async decodeBatch(urls) {
            const results = [];
            for (let i = 0; i < urls.length; i += 8) {
                results.push(...await Promise.all(urls.slice(i, i + 8).map(async source_url => ({ ...await googleDecoder.decode(source_url), source_url }))));
            }
            return results;
        }
    };
    const decodeGoogleNews = url => resolveArticleSourceUrl(url);

    const GOOGLE_NEWS_URL_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

    const GOOGLE_NEWS_URL_FAILURE_TTL_MS = 5 * 60 * 1000;

    let googleNewsUrlCache = null;
    let googleNewsUrlCacheSaveTimer = null;
    let cacheLoading;
    const googleNewsUrlPending = new Map();
    const repairQueue = new Map();
    const repairedUrls = new Map();

    async function ensureGoogleNewsUrlCache() {
        if (!googleNewsUrlCache && !cacheLoading) cacheLoading = (async () => {
            const obj = await env.RSS_DATA.get('googleNewsUrlCache', { type: 'json' }) || {};
            googleNewsUrlCache = new Map(Object.entries(boundCacheObject('googleNewsUrlCache',obj)));
            persistedGoogleNewsUrls = new Map(googleNewsUrlCache);
        })().finally(() => { cacheLoading = null; });
        await cacheLoading;
        return googleNewsUrlCache;
    }
    // Entries persist as row patches: the in-memory 3000-entry trim is a memory
    // bound only and must not delete mappings that saved/Board stories still use.
    // Only an explicit publisher mismatch removes a persisted mapping.
    let persistedGoogleNewsUrls = new Map();
    const removedGoogleNewsUrls = new Set();
    function forgetGoogleNewsUrl(cache, url) {
        cache.delete(url);
        removedGoogleNewsUrls.add(url);
    }

    function scheduleGoogleNewsUrlCacheSave() {
        if (googleNewsUrlCacheSaveTimer) return;
        googleNewsUrlCacheSaveTimer = setTimeout(async () => {
            googleNewsUrlCacheSaveTimer = null;
            try {
                if (!googleNewsUrlCache) return;
                if (env.RSS_DATA.patchEntries) {
                    const changed = {};
                    for (const [url, entry] of googleNewsUrlCache) if (persistedGoogleNewsUrls.get(url) !== entry) changed[url] = entry;
                    const removed = [...removedGoogleNewsUrls].filter(url => !googleNewsUrlCache.has(url));
                    if (!Object.keys(changed).length && !removed.length) return;
                    await env.RSS_DATA.patchEntries('googleNewsUrlCache', changed, removed);
                    for (const url of removed) removedGoogleNewsUrls.delete(url);
                    for (const [url, entry] of Object.entries(changed)) persistedGoogleNewsUrls.set(url, entry);
                    for (const url of removed) persistedGoogleNewsUrls.delete(url);
                } else {
                    const obj = boundCacheObject('googleNewsUrlCache',Object.fromEntries(googleNewsUrlCache));
                    googleNewsUrlCache = new Map(Object.entries(obj));
                    await env.RSS_DATA.put('googleNewsUrlCache', JSON.stringify(obj));
                }
            } catch (error) {
                console.error('[GOOGLE NEWS] Could not persist destination cache:', error.message);
            }
        }, 3000);
        if (googleNewsUrlCacheSaveTimer.unref) googleNewsUrlCacheSaveTimer.unref();
    }

    let repairTimer;
    function scheduleRepair(source, destination) {
        if (now() - (repairedUrls.get(source) || 0) < 60000) return;
        repairQueue.set(source, destination);
        if (repairTimer) return;
        repairTimer = setTimeout(async () => {
            repairTimer = null;
            const entries = Object.fromEntries(repairQueue);
            repairQueue.clear();
            try {
                await env.RSS_DATA.repairGoogleNewsUrls?.(entries);
                for (const source of Object.keys(entries)) repairedUrls.set(source, now());
                if (repairedUrls.size > 3000) repairedUrls.delete(repairedUrls.keys().next().value);
            } catch (error) {
                console.error('[GOOGLE NEWS] Stored URL repair failed:', error.message);
            }
        }, 3000);
        repairTimer.unref?.();
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
        if (!response.ok) { await response.body?.cancel(); throw new Error('Publisher destination search returned HTTP ' + response.status); }
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
        const executable = resolveOpenCliExecutable();
        const query = 'site:' + domain + ' "' + title.replace(/["\r\n]+/g, ' ') + '"';
        // Each search is a separate OpenCLI Node process driving a browser
        // tab. Up to 16 background resolutions may run, so serialize only this
        // expensive last-resort step instead of launching them all together.
        const { stdout } = await runGoogleNewsBrowserTask(() => execFileAsync(executable, [
            'duckduckgo', 'search', query,
            '--limit', '5',
            '--window', 'background',
            '-f', 'json'
        ], {
            timeout: 45000,
            maxBuffer: 2 * 1024 * 1024
        }));
        return parseOpenCliSearchDestination(stdout, domain);
    }

    async function resolveGoogleNewsUrl(sourceUrl, hints = {}, options = {}) {
        const original = safeHttpUrl(normalizeArticleSourceUrl(sourceUrl));
        if (!original || !isGoogleNewsArticleUrl(original)) return original || sourceUrl;
        const cache = await ensureGoogleNewsUrlCache();
        const accepted = value => {
            const clean = cleanGoogleNewsDestination(value);
            return clean && matchesGoogleNewsPublisher(clean, hints) ? clean : '';
        };
        let cached = cache.get(original);
        if (cached?.resolvedUrl && !accepted(cached.resolvedUrl)) {
            forgetGoogleNewsUrl(cache, original);
            scheduleGoogleNewsUrlCacheSave();
            cached = undefined;
        }
        if (cached?.resolvedUrl && accepted(cached.resolvedUrl) !== cached.resolvedUrl) {
            cached = { ...cached, resolvedUrl: accepted(cached.resolvedUrl) };
            cache.set(original, cached);
            scheduleGoogleNewsUrlCacheSave();
        }
        const recentDecoderFailure = cached?.decodersOnly && !cached.resolvedUrl && now() - cached.cachedAt < GOOGLE_NEWS_URL_FAILURE_TTL_MS;
        if (recentDecoderFailure && !options.decodersOnly) cached = undefined;
        const ttl = cached?.resolvedUrl ? GOOGLE_NEWS_URL_CACHE_TTL_MS : GOOGLE_NEWS_URL_FAILURE_TTL_MS;
        if (cached?.cachedAt && now() - cached.cachedAt < ttl && !options.force) {
            if (cached.resolvedUrl) scheduleRepair(original, accepted(cached.resolvedUrl));
            return accepted(cached.resolvedUrl) || original;
        }
        if (googleNewsUrlPending.has(original)) {
            const existing = googleNewsUrlPending.get(original);
            if (options.backgroundResolve || existing.backgroundResolve) return accepted(cached?.resolvedUrl) || original;
            return accepted(await existing.promise) || original;
        }
        // Bound card-triggered work. Related members use the same deduplicated
        // queue; they must also eventually get repaired.
        if (googleNewsUrlPending.size >= 16) return accepted(cached?.resolvedUrl) || original;

        const work = async () => {
            let resolvedUrl = accepted(decodeGoogleNewsOffline(original));
            let resolutionError = '';
            const attempt = async task => {
                try { resolvedUrl = accepted(await task()); }
                catch (error) { resolutionError += (resolutionError ? '; ' : '') + error.message; }
            };
            if (!resolvedUrl && !(recentDecoderFailure && !options.force) && !options.skipDecode) await attempt(async () => {
                const result = await networkDecoder.decode(original);
                if (!result?.decoded_url) throw Error(result?.message || 'Google News decoding failed');
                return result.decoded_url;
            });
            if (!resolvedUrl && !options.decodersOnly && !options.skipSearch) await attempt(() => resolveGoogleNewsViaPublisherSearch(hints));
            // OpenCLI search itself drives a browser too, so both browser
            // fallbacks are strictly background work, after network decoding.
            if (!resolvedUrl && options.backgroundResolve && !options.decodersOnly && !(now() < networkDecoder.blockedUntil)) {
                if (!options.decodersOnly) await attempt(() => resolveGoogleNewsViaOpenCliSearch(hints));
                await (!resolvedUrl ? attempt(() => browserRedirect(original)) : Promise.resolve());
            }
            cache.set(original, { resolvedUrl, individuallyDecoded: true, cachedAt: now(),
                decodersOnly: Boolean(options.decodersOnly), error: resolvedUrl ? '' : resolutionError });
            if (cache.size > 3000) cache.delete(cache.keys().next().value);
            scheduleGoogleNewsUrlCacheSave();
            if (resolvedUrl) scheduleRepair(original, resolvedUrl);
            return resolvedUrl || original;
        };
        // Defer all decoder/search/browser activity until after the card call
        // returns. A cold cache load is local storage IO only.
        const pending = (options.backgroundResolve ? new Promise(resolve => setImmediate(resolve)).then(work) : Promise.resolve().then(work))
            .finally(() => googleNewsUrlPending.delete(original));
        googleNewsUrlPending.set(original, { promise: pending, backgroundResolve: Boolean(options.backgroundResolve) });
        if (options.backgroundResolve) {
            pending.catch(error => console.error('[GOOGLE NEWS] Background resolution failed:', error.message));
            return accepted(cached?.resolvedUrl) || original;
        }
        const destination = await pending;
        // Reader and feed sync never await browser work. Bypass the fresh
        // decoder-only failure once so the background job can try fallbacks.
        if (destination === original && !options.decodersOnly) {
            setImmediate(() => resolveGoogleNewsUrl(original, hints, { backgroundResolve: true, force: true, skipDecode: true, skipSearch: true }).catch(() => {}));
        }
        return destination;
    }

    async function resolveArticleSourceUrl(url, hints = {}) {
        const destination = await resolveGoogleNewsUrl(url, hints);
        if (isGoogleNewsArticleUrl(destination)) {
            throw Object.assign(Error('Google News destination is resolving in the background; please retry shortly'), { code: 'GOOGLE_NEWS_PENDING', status: 503 });
        }
        return normalizeArticleSourceUrl(destination);
    }

    async function resolveSmartArticleDestinations(sourceResults = []) {
        const articles = [];
        const collect = article => { if (!article) return; articles.push(article); for (const member of article.relatedArticles || []) collect(member); };
        for (const result of sourceResults) for (const article of result?.articles || []) collect(article);
        const wrappers = [...new Set(articles.map(article => article?.link).filter(isGoogleNewsArticleUrl))];
        if (!wrappers.length) return { attempted: 0, resolved: 0 };

        const cache = await ensureGoogleNewsUrlCache();
        // Concurrent submissions coalesce into RPC batches; actual Google IO
        // remains serial. Failure-cache entries are respected here as on cards.
        await googleDecoder.decodeBatch(wrappers);

        let resolvedCount = 0;
        for (const article of articles) {
            const wrapper = article?.link;
            if (!isGoogleNewsArticleUrl(wrapper)) continue;
            let destination = cache.get(wrapper)?.resolvedUrl || '';
            if (destination && !matchesGoogleNewsPublisher(destination, article)) {
                forgetGoogleNewsUrl(cache, wrapper);
                destination = '';
            }
            if (!destination) {
                // Start the more expensive publisher-search fallbacks without
                // delaying the Smart sync. A later card request or sync reuses it.
                destination = await resolveGoogleNewsUrl(wrapper, article, { backgroundResolve: true });
            }
            if (!destination || isGoogleNewsArticleUrl(destination) || !matchesGoogleNewsPublisher(destination, article)) continue;

            applyGoogleNewsDestinations(article, { [wrapper]: destination });
            article.domain = new URL(article.link).hostname.replace(/^www\./, '');
            article.feedIcon = publisherIcon(article.link);
            if (!article.image || isInvalidImage(article.image) || isGoogleNewsHostedThumbnail(article.image)) {
                const cachedArticle = await getLastKnownCachedArticle?.(article.link);
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
        resolveArticleSourceUrl,
        get googleNewsUrlCache() { return googleNewsUrlCache; },
        decodeGoogleNews,
        resolveSmartArticleDestinations
    };
}
