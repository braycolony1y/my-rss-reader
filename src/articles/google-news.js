import { boundCacheObject, GOOGLE_NEWS_PERMANENT_TTL_MS } from '../database/sqlite/cache-retention.js';
import { createGoogleNewsDecoder, decodeGoogleNewsOffline, cleanGoogleNewsDestination, googleNewsWallError, isRejectedGoogleNewsDestination } from './google-news-decode.js';
import { runGoogleNewsBrowserRedirect, runGoogleNewsBrowserTask } from '../browser/google-news-redirect.js';
import { resolveOpenCliExecutable } from '../browser/opencli-executable.js';
import { applyGoogleNewsDestinations } from './google-news-repair.js';
import { safeHttpUrl, publisherIcon, isInvalidImage } from '../utils/article-utils.js';
import { isGoogleNewsArticleUrl, parseOpenCliSearchDestination, isGoogleNewsHostedThumbnail } from './search-destination.js';
import { decodeHTMLEntities, normalizeArticleTitle } from '../../feed-parsers.js';
import { normalizeArticleSourceUrl } from '../article-source-state.js';
import { isExactGoogleNewsDecode, matchesGoogleNewsPublisher } from '../google-news-destination.js';

const CACHE_KEY = 'googleNewsUrlCache';
const CACHE_LIMIT = 3000;
const SAVE_DELAY_MS = 3000;
const MAX_SAVE_RETRY_MS = 5 * 60 * 1000;

function remember(map, key, entry) {
    map.delete(key);
    map.set(key, entry);
    while (map.size > CACHE_LIMIT) map.delete(map.keys().next().value);
}

export function createGoogleNewsResolver({
    env,
    BROWSER_HEADERS,
    execFileAsync,
    getLastKnownCachedArticle,
    decoder,
    browserRedirect = url => runGoogleNewsBrowserRedirect(url, execFileAsync),
    now = Date.now,
    fetchImpl = (...args) => fetch(...args),
} = {}) {
    const networkDecoder = decoder || createGoogleNewsDecoder({ headers: BROWSER_HEADERS, now, fetchImpl });
    // Feed sync uses this same cached, paced decoder rather than a second npm instance.
    const googleDecoder = {
        async decode(url) {
            const decoded_url = await resolveGoogleNewsUrl(url, {}, { decodersOnly: true });
            return { status: Boolean(cleanGoogleNewsDestination(decoded_url)), decoded_url,
                source: googleNewsUrlCache.get(normalizeArticleSourceUrl(url))?.source };
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

    const googleNewsUrlCache = new Map();
    let googleNewsUrlCacheSaveTimer = null;
    let cacheLoading;
    const decoderPending = new Map();
    const backgroundPending = new Map();
    const HOUR_MS = 60 * 60 * 1000;
    const repairQueue = new Map();
    const repairedUrls = new Map();

    // Patch changed rows so local retention does not delete persisted mappings.
    const dirtyEntries = new Map();
    let saveDelay = SAVE_DELAY_MS;
    let legacyCacheHasEvictions = false;

    async function loadLegacyCache() {
        const stored = await env.RSS_DATA.get(CACHE_KEY, { type: 'json' }) || {};
        return boundCacheObject(CACHE_KEY, stored, now());
    }

    async function lookupCacheEntry(original) {
        const db = env.RSS_DATA;
        if (!db.getEntries) {
            cacheLoading ||= loadLegacyCache().then(stored => {
                const entries = Object.entries(stored);
                legacyCacheHasEvictions = entries.length > CACHE_LIMIT;
                for (const [url, entry] of entries.slice(-CACHE_LIMIT)) googleNewsUrlCache.set(url, entry);
            }).catch(error => { cacheLoading = null; throw error; });
            await cacheLoading;
        }
        let entry = dirtyEntries.get(original) || googleNewsUrlCache.get(original);
        if (!entry && !googleNewsUrlCache.has(original)) {
            if (db.getEntries) entry = (await db.getEntries(CACHE_KEY, [original]))[original];
            else if (legacyCacheHasEvictions) entry = (await loadLegacyCache())[original];
            // A concurrent request may have already installed a newer result.
            entry = dirtyEntries.get(original) || googleNewsUrlCache.get(original) || entry;
        }
        if (googleNewsUrlCache.size >= CACHE_LIMIT && !googleNewsUrlCache.has(original)) legacyCacheHasEvictions = true;
        remember(googleNewsUrlCache, original, entry);
        return entry;
    }

    const isPermanent = entry => entry?.permanentFailure && now() - entry.cachedAt < GOOGLE_NEWS_PERMANENT_TTL_MS;

    function scheduleGoogleNewsUrlCacheSave() {
        if (googleNewsUrlCacheSaveTimer) return;
        googleNewsUrlCacheSaveTimer = setTimeout(async () => {
            const batch = new Map(dirtyEntries);
            try {
                if (env.RSS_DATA.patchEntries) {
                    await env.RSS_DATA.patchEntries(CACHE_KEY, Object.fromEntries(batch));
                } else {
                    const stored = await loadLegacyCache();
                    await env.RSS_DATA.put(CACHE_KEY, JSON.stringify(
                        boundCacheObject(CACHE_KEY, { ...stored, ...Object.fromEntries(batch) }, now())
                    ));
                }
                saveDelay = SAVE_DELAY_MS;
                for (const [url, entry] of batch) {
                    if (dirtyEntries.get(url) === entry) dirtyEntries.delete(url);
                }
            } catch (error) {
                saveDelay = Math.min(MAX_SAVE_RETRY_MS, saveDelay * 2);
                console.error('[GOOGLE NEWS] Could not persist destination cache:', error.message);
            } finally {
                googleNewsUrlCacheSaveTimer = null;
                if (dirtyEntries.size) scheduleGoogleNewsUrlCacheSave();
            }
        }, saveDelay);
        googleNewsUrlCacheSaveTimer.unref?.();
    }

    let repairTimer;
    function scheduleRepair(wrapper, resolution) {
        const previous = repairedUrls.get(wrapper);
        if (previous && previous.url === resolution.resolvedUrl && previous.source === resolution.source && now() - previous.at < 60000) return;
        remember(repairQueue, wrapper, { resolvedUrl: resolution.resolvedUrl, source: resolution.source });
        if (repairTimer) return;
        repairTimer = setTimeout(async () => {
            repairTimer = null;
            const entries = Object.fromEntries(repairQueue);
            repairQueue.clear();
            try {
                await env.RSS_DATA.repairGoogleNewsUrls?.(entries);
                for (const [wrapper, entry] of Object.entries(entries)) {
                    remember(repairedUrls, wrapper, { url: entry.resolvedUrl, source: entry.source, at: now() });
                }
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
        const response = await fetchImpl('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
            headers: BROWSER_HEADERS,
            signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error('Publisher destination search returned HTTP ' + response.status); }
        const html = await response.text();
        for (const match of html.matchAll(/(?:[?&]|&amp;)uddg=([^&"']+)/gi)) {
            let candidate = match[1];
            try { candidate = decodeURIComponent(decodeHTMLEntities(candidate)); } catch (e) { }
            const safe = cleanGoogleNewsDestination(candidate);
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

    function cachedDestination(entry, hints) {
        const destination = cleanGoogleNewsDestination(entry?.resolvedUrl);
        if (!destination || isPermanent(entry) || !Number.isFinite(entry.cachedAt) ||
            now() - entry.cachedAt >= GOOGLE_NEWS_URL_CACHE_TTL_MS) return '';
        return (isExactGoogleNewsDecode(entry.source) || matchesGoogleNewsPublisher(destination, hints)) ? destination : '';
    }

    function saveResolution(original, fields) {
        const entry = { ...(dirtyEntries.get(original) || googleNewsUrlCache.get(original)), individuallyDecoded: true, ...fields };
        remember(googleNewsUrlCache, original, entry);
        remember(dirtyEntries, original, entry);
        scheduleGoogleNewsUrlCacheSave();
        return entry;
    }

    function saveSuccess(original, resolvedUrl, source) {
        const entry = saveResolution(original, {
            resolvedUrl, source, cachedAt: now(), error: '', permanentFailure: false,
            browserAttempts: 0, browserRetryAt: 0, decoderRetryAt: 0
        });
        scheduleRepair(original, entry);
        return entry;
    }

    function savePermanentFailure(original) {
        return saveResolution(original, {
            resolvedUrl: '', cachedAt: now(), permanentFailure: true,
            browserAttempts: 0, browserRetryAt: 0, decoderRetryAt: 0, error: ''
        });
    }

    async function decodeDestination(original, force) {
        const offline = decodeGoogleNewsOffline(original, { raw: true });
        const destination = cleanGoogleNewsDestination(offline);
        if (destination) return saveSuccess(original, destination, 'offline');
        if (isRejectedGoogleNewsDestination(offline)) {
            return savePermanentFailure(original);
        }

        const pending = decoderPending.get(original);
        if (pending) return pending;
        const entry = googleNewsUrlCache.get(original);
        const attemptedAt = entry?.decoderAttemptedAt ?? (entry?.decodersOnly ? entry.cachedAt : -Infinity);
        // A wall's deadline takes precedence over the normal miss interval,
        // including after a restart or a reader cache bypass.
        const wallRetryAt = entry?.decoderRetryAt || 0;
        const retryAt = wallRetryAt || attemptedAt + GOOGLE_NEWS_URL_FAILURE_TTL_MS;
        if (now() < Math.max(wallRetryAt, networkDecoder.blockedUntil || 0) ||
            (!force && now() < retryAt) || decoderPending.size >= 16) return entry;

        const work = Promise.resolve().then(async () => {
            let result;
            try { result = await networkDecoder.decode(original); }
            catch (error) { result = { message: error.message, status: error.status, retryAfter: error.retryAfter }; }
            const wall = googleNewsWallError(result?.decoded_url, result?.status);
            if (wall) networkDecoder.blockRequests?.(result.retryAfter);
            const destination = wall ? '' : cleanGoogleNewsDestination(result?.decoded_url);
            if (destination) return saveSuccess(original, destination, 'batchexecute');
            const current = googleNewsUrlCache.get(original) || entry;
            if (isExactGoogleNewsDecode(current?.source) && cachedDestination(current, {})) return current;
            if (!wall && (result?.permanentFailure || isRejectedGoogleNewsDestination(result?.decoded_url))) {
                return savePermanentFailure(original);
            }
            const decoderRetryAt = now() < networkDecoder.blockedUntil ? networkDecoder.blockedUntil : 0;
            if (isPermanent(current)) return decoderRetryAt ? saveResolution(original, { decoderRetryAt }) : current;
            return saveResolution(original, {
                decoderAttemptedAt: now(), cachedAt: current?.resolvedUrl ? current.cachedAt : now(),
                decoderRetryAt,
                permanentFailure: false,
                error: wall || result?.message || 'Google News decoding failed'
            });
        }).finally(() => decoderPending.delete(original));
        decoderPending.set(original, work);
        return work;
    }

    function scheduleBackground(original, hints) {
        const entry = googleNewsUrlCache.get(original);
        if (isPermanent(entry) || now() < entry?.browserRetryAt ||
            backgroundPending.has(original) || backgroundPending.size >= 16) return;

        const job = { browserStarted: false, foregroundRetried: false };
        backgroundPending.set(original, job);
        setImmediate(async () => {
            try {
                const decoded = await decodeDestination(original, false);
                if (!decoded) return;
                const blocked = () => {
                    const current = googleNewsUrlCache.get(original) || decoded;
                    return isPermanent(current) || now() < current?.browserRetryAt || cachedDestination(current, hints);
                };
                if (blocked()) return;
                const search = async task => {
                    try { return cleanGoogleNewsDestination(await task(hints)); }
                    catch { return ''; }
                };
                let guessed = await search(resolveGoogleNewsViaPublisherSearch);
                if (blocked()) return;
                if (guessed && matchesGoogleNewsPublisher(guessed, hints)) {
                    saveSuccess(original, guessed, 'search');
                    return;
                }

                if (now() < networkDecoder.blockedUntil) return;
                job.browserStarted = true;
                guessed = await search(resolveGoogleNewsViaOpenCliSearch);
                if (blocked()) return;
                if (guessed && matchesGoogleNewsPublisher(guessed, hints)) {
                    saveSuccess(original, guessed, 'search');
                    return;
                }
                let result;
                try { result = await browserRedirect(original); }
                catch (error) {
                    result = { message: error.message, wall: error.code === 'GOOGLE_NEWS_WALL',
                        status: error.status, retryAfter: error.retryAfter };
                }
                const proposed = typeof result === 'string' ? result : result?.url;
                const wall = googleNewsWallError(proposed, result?.status) || (result?.wall && result.message);
                if (wall) networkDecoder.blockRequests?.(result?.retryAfter);
                if (blocked()) return;
                const destination = wall ? '' : cleanGoogleNewsDestination(proposed);
                if (destination) {
                    saveSuccess(original, destination, 'browser');
                } else if (!wall && (result?.permanentFailure || isRejectedGoogleNewsDestination(proposed))) {
                    savePermanentFailure(original);
                } else {
                    const current = googleNewsUrlCache.get(original) || decoded;
                    const browserAttempts = (current?.browserAttempts || 0) + 1;
                    saveResolution(original, {
                        browserAttempts, browserRetryAt: now() + HOUR_MS * Math.min(48, 2 ** (browserAttempts - 1)),
                        ...(wall && { decoderRetryAt: Math.max(current?.decoderRetryAt || 0, networkDecoder.blockedUntil || 0) }),
                        cachedAt: current?.resolvedUrl ? current.cachedAt : now(),
                        error: wall || result?.message || 'Google News browser redirect did not resolve'
                    });
                }
            } catch (error) {
                console.error('[GOOGLE NEWS] Background resolution failed:', error.message);
            } finally {
                backgroundPending.delete(original);
            }
        });
    }

    async function resolveGoogleNewsUrl(sourceUrl, hints = {}, options = {}) {
        if (!isGoogleNewsArticleUrl(sourceUrl) || !safeHttpUrl(sourceUrl)) return sourceUrl;
        const original = normalizeArticleSourceUrl(sourceUrl);
        const entry = await lookupCacheEntry(original);
        const destination = cachedDestination(entry, hints);
        if (destination) {
            scheduleRepair(original, { ...entry, resolvedUrl: destination });
            return destination;
        }
        const permanent = isPermanent(entry);
        if ((permanent && !options.force) || options.cacheOnly) return original;
        if (options.backgroundResolve) {
            scheduleBackground(original, hints);
            return original;
        }

        // The browser job can wait for an earlier cheap miss. A foreground
        // request arriving during that job can try the cheap lane independently.
        const job = backgroundPending.get(original);
        const retryDuringBrowser = job?.browserStarted && !job.foregroundRetried;
        if (retryDuringBrowser) job.foregroundRetried = true;
        const decoded = await decodeDestination(original, options.force || retryDuringBrowser);
        const resolved = cachedDestination(decoded, hints);
        if (!resolved && !permanent && !options.decodersOnly) scheduleBackground(original, hints);
        return resolved || original;
    }

    async function resolveArticleSourceUrl(url, hints = {}) {
        return isGoogleNewsArticleUrl(url) ? resolveGoogleNewsUrl(url, hints) : url;
    }

    async function resolveSmartArticleDestinations(sourceResults = []) {
        const articles = [];
        const collect = article => { if (!article) return; articles.push(article); for (const member of article.relatedArticles || []) collect(member); };
        for (const result of sourceResults) for (const article of result?.articles || []) collect(article);
        const wrappers = [...new Set(articles.map(article => article?.link).filter(isGoogleNewsArticleUrl))];
        if (!wrappers.length) return { attempted: 0, resolved: 0 };

        // Concurrent submissions coalesce into RPC batches; actual Google IO
        // remains serial. Failure-cache entries are respected here as on cards.
        await googleDecoder.decodeBatch(wrappers);

        let resolvedCount = 0;
        for (const article of articles) {
            const wrapper = article?.link;
            if (!isGoogleNewsArticleUrl(wrapper)) continue;
            const original = normalizeArticleSourceUrl(wrapper);
            const resolution = await lookupCacheEntry(original);
            const destination = cachedDestination(resolution, article);
            if (!destination) {
                scheduleBackground(original, article);
                continue;
            }

            applyGoogleNewsDestinations(article, { [wrapper]: { resolvedUrl: destination, source: resolution.source } }, { recursive: false });
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
