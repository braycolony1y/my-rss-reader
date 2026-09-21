import { authMiddleware } from '../middleware/auth.js';
import { decodeHTMLEntities, normalizeArticleTitle } from '../../feed-parsers.js';
import { isInvalidImage, extractImageFromHtml, normalizeStateUrl, isRedditUrl } from '../utils/article-utils.js';
import { normalizeArticleSourceUrl, deletedSourceKind, isDeletedArticlePayload } from '../article-source-state.js';
import fs from 'fs/promises';
import path from 'path';
import { isVozThreadUrl, isUnsafeVozThreadPayload, getCachedVozResumePage, getVozThreadPageNumber, buildVozThreadPageUrl, alignVozPaginationToRequestedPage } from '../voz-thread-state.js';
import sourceRegistry from '../sources/index.js';
import { isGoogleNewsArticleUrl } from '../articles/search-destination.js';
import { enhanceArticleResultForSource, assertArticleResultAcceptedBySource } from '../articles/source-results.js';
import { cleanArticleMarkup, isUsableArticlePage } from '../articles/markup.js';
import { articleFetchLaneMiddleware, withArticleFetchLane } from '../articles/fetch-lanes.js';

export function registerArticleRoutes({
    app,
    getArticleFetchPolicy,
    fetchArticleHtmlByStrategy,
    articleReaderSessions,
    articleFetchProgress,
    ARTICLE_FETCH_BASE_POINTS,
    resolveGoogleNewsUrl,
    setArticleFetchPreference,
    rankArticleFetchStrategies,
    isProtectedDeletedSourceSnapshot,
    deleteCachedArticle,
    ARTICLE_CACHE_DIR,
    updateArticleFetchProgress,
    getLastKnownCachedArticle,
    clearUnavailableSourceUrl,
    finishArticleFetchProgress,
    buildDeletedSourceResponse,
    getCachedArticle,
    shouldRevalidateUnderfilledVozPage,
    getArticleFetchPreferences,
    cacheArticleResult,
    deletedVozThreads,
    DELETED_SOURCE_TOMBSTONE,
    triggerVozNextPagePrefetch,
    triggerVozCurrentPageBackgroundUpdate,
    triggerNextFiveArticlesPrefetch,
    recordArticleFetchOutcome,
    requiresIndependentDeletionConfirmation,
    fetchViaJina,
    expandArticleResultForSource,
    fetchViaOpenCli,
    parseArticleHtmlContent,
    cache,
    progress,
    googleNews,
} = {}) {
    app.get('/api/debug-article', authMiddleware, async (req, res) => {
        const url = req.query.url;
        if (!url) return res.status(400).json({ error: 'URL required' });

        try {
            let html = '';
            let fetchMethod = '';
            const fetchAttempts = [];
            const policy = await getArticleFetchPolicy(url, String(req.query.feedUrl || ''));
            const htmlStrategies = policy.strategyOrder.filter(strategy =>
                ['direct', 'cloudflare', 'vietserver', 'allorigins'].includes(strategy)
            );
            for (const strategy of htmlStrategies) {
                try {
                    html = await fetchArticleHtmlByStrategy(strategy, url);
                    if (html) {
                        fetchMethod = strategy;
                        fetchAttempts.push({ method: strategy, status: 'ok', length: html.length });
                        break;
                    } else {
                        fetchAttempts.push({ method: strategy, status: 'empty' });
                    }
                } catch (e) {
                    fetchAttempts.push({ method: strategy, status: 'error', detail: e.cause?.message || e.message });
                }
            }

            if (!html) return res.json({
                error: policy.hasStrictConfiguredMethods && htmlStrategies.length === 0
                    ? 'The selected source methods do not provide raw HTML debugging.'
                    : 'Failed to fetch page',
                url,
                fetchAttempts,
                availableStrategies: policy.availableStrategies
            });

            const result = {
                url,
                htmlLength: html.length,
                fetchMethod,
                fetchAttempts,
                availableStrategies: policy.availableStrategies
            };

            // Meta tags
            const metaTags = html.match(/<meta[^>]+>/ig) || [];
            for (const tag of metaTags) {
                const contentMatch = tag.match(/content=["']([^"']+)["']/i);
                if (!contentMatch) continue;
                const c = contentMatch[1].trim();
                if (/og:title/i.test(tag) && !result.ogTitle) result.ogTitle = decodeHTMLEntities(c);
                if (/og:image/i.test(tag) && !tag.match(/og:image:(width|height|type|alt)/i) && !result.ogImage && !isInvalidImage(c)) result.ogImage = c;
                if (/og:site_name/i.test(tag) && !result.ogSiteName) result.ogSiteName = decodeHTMLEntities(c);
                if (/article:section/i.test(tag) && !result.articleSection) result.articleSection = decodeHTMLEntities(c);
                if (/(article:published_time|datepublished)/i.test(tag) && !result.metaDate) result.metaDate = decodeHTMLEntities(c);
            }

            // Title & H1
            const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            if (titleMatch) result.htmlTitle = decodeHTMLEntities(titleMatch[1].trim());
            const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
            if (h1Match) result.h1 = decodeHTMLEntities(h1Match[1].replace(/<[^>]+>/g, '').trim());

            // JSON-LD extraction
            const ldJsonMatches = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/ig) || [];
            result.jsonLdSummary = [];
            for (const block of ldJsonMatches) {
                try {
                    const cleanJson = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').replace(/[\n\r\t]+/g, ' ').trim();
                    const parsed = JSON.parse(cleanJson);
                    const schemas = Array.isArray(parsed) ? parsed : [parsed];
                    for (const schema of schemas) {
                        const entry = { type: schema['@type'] };
                        if (schema.headline) entry.headline = decodeHTMLEntities(schema.headline);
                        if (schema.datePublished) { entry.datePublished = schema.datePublished; result.ldDatePublished = schema.datePublished; }
                        if (schema.publisher?.name) { entry.publisher = decodeHTMLEntities(schema.publisher.name); result.ldPublisher = entry.publisher; }
                        if (schema.articleSection) { entry.articleSection = decodeHTMLEntities(schema.articleSection); result.ldArticleSection = entry.articleSection; }
                        if (schema['@type'] === 'BreadcrumbList' && schema.itemListElement) {
                            entry.breadcrumbs = schema.itemListElement.map(bc => ({ position: bc.position, name: decodeHTMLEntities(bc.item?.name || bc.name) }));
                            const cat = schema.itemListElement.find(bc => bc.position === 2);
                            if (cat?.item?.name) result.breadcrumbCategory = decodeHTMLEntities(cat.item.name);
                        }
                        if (schema.image) {
                            entry.image = typeof schema.image === 'string' ? schema.image : (schema.image.url || (Array.isArray(schema.image) ? schema.image[0] : null));
                        }
                        result.jsonLdSummary.push(entry);
                    }
                } catch (e) { }
            }

            // Image via extractImageFromHtml
            result.extractedImage = extractImageFromHtml(html, url);

            // Logo alt or Title fallback
            const logoAltMatch = html.match(/<img[^>]*logo[^>]*alt=["']([^"']+)["']/i) ||
                html.match(/<img[^>]*alt=["']([^"']+)["'][^>]*logo[^>]*>/i) ||
                html.match(/<a[^>]*logo[^>]*title=["']([^"']+)["']/i) ||
                html.match(/<title>.*?[-\|]\s*([^<]+)<\/title>/i);
            if (logoAltMatch) {
                let extracted = decodeHTMLEntities(logoAltMatch[1]).trim();
                extracted = extracted.replace(/^(Báo điện tử|Báo|Tạp chí|Trang thông tin điện tử)\s+/i, '').trim();
                extracted = extracted.replace(/\s+News$/i, '').trim();
                if (extracted.includes('- Tin tức')) extracted = extracted.split('-')[0].trim();
                if (extracted.includes('|')) extracted = extracted.split('|')[0].trim();
                result.logoAlt = extracted;
            }

            res.json(result);
        } catch (e) {
            res.json({ error: e.message, url });
        }
    });

    app.get('/api/article-content-progress', authMiddleware, (req, res) => {
        const requestId = String(req.query.id || '');
        const session = articleReaderSessions.get(requestId);
        if (session && session.url === normalizeArticleSourceUrl(req.query.url || '')) session.lastSeen = Date.now();
        res.json(articleFetchProgress.get(requestId) || {
            stage: 'waiting',
            message: 'Preparing article reader…',
            done: false
        });
    });

    app.post('/api/article-reader-session/close', authMiddleware, (req, res) => {
        articleReaderSessions.delete(String(req.body?.requestId || ''));
        res.json({ ok: true });
    });

    app.post('/api/article-fetch-preference', authMiddleware, async (req, res) => {
        try {
            const strategy = String(req.body?.strategy || '');
            const preference = String(req.body?.preference || '');
            if (!(strategy in ARTICLE_FETCH_BASE_POINTS)) return res.status(400).json({ error: 'Unknown fetch method' });
            if (!['like', 'dislike', ''].includes(preference)) return res.status(400).json({ error: 'Preference must be like, dislike, or empty' });
            const resolvedUrl = await resolveGoogleNewsUrl(req.body?.url);
            const hostname = new URL(resolvedUrl).hostname.toLowerCase();
            const preferences = await setArticleFetchPreference(hostname, strategy, preference);
            res.json({ ok: true, hostname, preferences, ranking: await rankArticleFetchStrategies(hostname) });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/clear-article-cache', authMiddleware, async (req, res) => {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL required' });
        try {
            if (await isProtectedDeletedSourceSnapshot(url)) {
                return res.status(403).json({ error: 'Deleted-source snapshots are protected from cache clearing.' });
            }
            await deleteCachedArticle(url);
            if (url.includes('voz.vn/t/')) {
                const baseUrl = url.split('?')[0];
                const isSpecificPostOrPage = baseUrl.match(/\/(page-\d+|post-\d+|unread|latest)/i);
                if (!isSpecificPostOrPage) {
                    const threadMatch = url.match(/\/t\/.*?\.(\d+)/);
                    if (threadMatch) {
                        const threadId = threadMatch[1];
                        if (cache._articleCacheIndex !== null) {
                            for (const [filename, meta] of cache._articleCacheIndex.entries()) {
                                if (meta.url && meta.url.includes(`voz.vn/t/`) && meta.url.includes(`.${threadId}`)) {
                                    await fs.unlink(path.join(ARTICLE_CACHE_DIR, filename)).catch(() => {});
                                    cache._articleCacheIndex.delete(filename);
                                }
                            }
                        }
                    }
                }
            }
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to clear cache' });
        }
    });

    app.get('/api/article-content', authMiddleware, articleFetchLaneMiddleware, async (req, res) => {
        const requestedUrl = req.query.url;
        if (!requestedUrl) return res.status(400).json({ error: 'URL required' });
        if (isRedditUrl(requestedUrl)) return res.json({ url: requestedUrl, externalUrl: requestedUrl, openExternally: true, content: '' });
        progress.activeForegroundRequests++;
        let url = normalizeArticleSourceUrl(requestedUrl);
        let prefetchTargets = [];
        try { if (req.query.prefetchTargets) prefetchTargets = JSON.parse(req.query.prefetchTargets); } catch(e) {}

        const requestId = String(req.query.requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
        if (requestId && req.query.interactive === '1') {
            articleReaderSessions.set(requestId, { url, lastSeen: Date.now() });
            res.on('close', () => articleReaderSessions.delete(requestId));
        }
        updateArticleFetchProgress(requestId, 'starting', 'Identifying source and loading its fetch history…');

        try {
            const hasMethodRejection = Object.prototype.hasOwnProperty.call(req.query, 'reject')
                || Object.prototype.hasOwnProperty.call(req.query, 'exclude');
            const hasProtectedDeletedSnapshot = await isProtectedDeletedSourceSnapshot(requestedUrl);
            const protectedDeletedSnapshot = hasProtectedDeletedSnapshot
                ? await getLastKnownCachedArticle(requestedUrl)
                : null;
            const shouldRevalidateUnconfirmedArticle = Boolean(
                hasProtectedDeletedSnapshot
                && !isVozThreadUrl(requestedUrl)
                && (protectedDeletedSnapshot?.deletionConfirmationVersion !== 2
                    || !Array.isArray(protectedDeletedSnapshot?.deletionConfirmedBy)
                    || protectedDeletedSnapshot.deletionConfirmedBy.length < 2)
            );
            const shouldRevalidateProtectedSnapshot = Boolean(
                hasProtectedDeletedSnapshot
                && (shouldRevalidateUnconfirmedArticle
                    || sourceRegistry.getHandler(requestedUrl)?.shouldRevalidateDeletedSnapshot?.(protectedDeletedSnapshot))
            );
            if (shouldRevalidateProtectedSnapshot) {
                await deleteCachedArticle(requestedUrl);
                await clearUnavailableSourceUrl(requestedUrl);
            }
            if (hasMethodRejection && hasProtectedDeletedSnapshot && !shouldRevalidateProtectedSnapshot) {
                return res.status(403).json({ error: 'Deleted-source snapshots are protected from reader-method rejection.' });
            }
            if (hasProtectedDeletedSnapshot && !shouldRevalidateProtectedSnapshot) {
                finishArticleFetchProgress(requestId, 'Source deleted. Serving the protected snapshot without contacting the publisher.', { method: 'cache' });
                return res.json(await buildDeletedSourceResponse(requestedUrl));
            }
            if (url.match(/\.pdf(\?|$)/i)) {
                finishArticleFetchProgress(requestId, 'PDF Document loaded.', { method: 'pdf' });
                return res.json({
                    url,
                    title: 'PDF Document',
                    content: `<iframe src="https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true" style="width: 100%; aspect-ratio: 1/1.414; min-height: 800px; border: none; border-radius: 8px;" frameborder="0"></iframe>`,
                    fetchStrategy: 'pdf',
                    attemptedStrategies: ['pdf'],
                    availableStrategies: [],
                    methodPreferences: {}
                });
            }
            const requestedStrategy = String(req.query.strategy || '').trim();
            const rejectedStrategy = String(req.query.reject || '').trim();
            const requestedFeedUrl = String(req.query.feedUrl || '').trim();
            const requestedDescription = String(req.query.description || '').slice(0, 2000);
            const excludedStrategies = new Set(String(req.query.exclude || '').split(',').map(value => value.trim()).filter(Boolean));
            if (requestedStrategy && requestedStrategy !== 'refresh' && !(requestedStrategy in ARTICLE_FETCH_BASE_POINTS)) {
                return res.status(400).json({ error: 'Unknown fetch method' });
            }
            const bypassCache = Boolean(req.query.bypassCache === 'true' || req.query.bypassCache === '1' || requestedStrategy || rejectedStrategy || excludedStrategies.size);
            // Bypass means skip the cache read, not destroy the last-known-good
            // value before the replacement has been fetched and validated.

            if (isGoogleNewsArticleUrl(requestedUrl)) {
                url = await resolveGoogleNewsUrl(requestedUrl, {
                    title: req.query.title,
                    feedTitle: req.query.feedTitle,
                    feedUrl: req.query.feedUrl,
                    feedIcon: req.query.feedIcon,
                    domain: req.query.domain
                }, { force: bypassCache, backgroundResolve: false });
            }

            if (!bypassCache) {
                const resume = await getCachedVozResumePage(requestedUrl, req.query.resumePage, getCachedArticle);
                if (resume) url = resume.url;
                let directCached = resume?.cached || await getCachedArticle(requestedUrl);
                if (!directCached && googleNews.googleNewsUrlCache && googleNews.googleNewsUrlCache.has(requestedUrl) && googleNews.googleNewsUrlCache.get(requestedUrl).resolvedUrl) {
                    url = googleNews.googleNewsUrlCache.get(requestedUrl).resolvedUrl;
                    directCached = await getCachedArticle(url);
                } else if (directCached && isGoogleNewsArticleUrl(directCached.url || requestedUrl)) {
                    if (googleNews.googleNewsUrlCache && googleNews.googleNewsUrlCache.has(requestedUrl) && googleNews.googleNewsUrlCache.get(requestedUrl).resolvedUrl) {
                        url = googleNews.googleNewsUrlCache.get(requestedUrl).resolvedUrl;
                        directCached = await getCachedArticle(url);
                    } else {
                        directCached = null;
                    }
                }
                if (directCached && !isGoogleNewsArticleUrl(directCached.url || '')) {
                    let hostname = '';
                    try { hostname = new URL(url).hostname.toLowerCase(); } catch (e) { }
                    if ((hostname === 'voz.vn' || hostname.endsWith('.voz.vn'))
                        && await shouldRevalidateUnderfilledVozPage(url, directCached)) {
                        console.log(`[VOZ CACHE] Revalidating underfilled page ${url} before serving it.`);
                        directCached = null;
                    }
                    const effectiveFeedUrl = requestedFeedUrl || directCached?.feedUrl || '';
                    const policy = await getArticleFetchPolicy(url, effectiveFeedUrl);
                    const availableStrategies = policy.availableStrategies;
                    const methodPreferences = await getArticleFetchPreferences(hostname);
                    if (directCached && policy.hasStrictConfiguredMethods && !availableStrategies.includes(directCached.fetchStrategy)) {
                        // Preserve the old file as last-known-good, but do not
                        // serve a cache created through a method the user has now
                        // excluded for this source.
                        directCached = null;
                    }
                    if (!directCached) {
                        // Continue below and fetch only through the selected policy.
                    } else {
                    const cachedBeforeEnhancement = directCached;
                    directCached = enhanceArticleResultForSource(url, directCached, {
                        description: requestedDescription
                    });
                    if (directCached.content !== cachedBeforeEnhancement.content
                        || directCached.author !== cachedBeforeEnhancement.author) {
                        await cacheArticleResult(url, directCached);
                    }
                    const cachedSourceIsDeleted = directCached.sourceDeleted === true
                        || deletedVozThreads.has(normalizeStateUrl(url));
                    const cachedSourceHasContent = cachedSourceIsDeleted
                        ? directCached.sourceDeletedHasCache !== false && !directCached.content.includes(DELETED_SOURCE_TOMBSTONE)
                        : true;
                    finishArticleFetchProgress(
                        requestId,
                        cachedSourceIsDeleted
                            ? (cachedSourceHasContent ? 'Source deleted. Serving the last cached version.' : 'Source deleted. No cached copy is available.')
                            : 'Article loaded from cache.',
                        { method: 'cache', cached: cachedSourceHasContent }
                    );
                    let prefetchPromise = null;
                    if (req.query.threadPage !== '1' && req.query.prefetch !== '1' && directCached.pagination?.nextUrl && (hostname === 'voz.vn' || hostname.endsWith('.voz.vn'))) {
                        prefetchPromise = withArticleFetchLane('p1', () => triggerVozNextPagePrefetch(directCached.pagination.nextUrl, 1, effectiveFeedUrl));
                    }
                    if (!cachedSourceIsDeleted && (hostname === 'voz.vn' || hostname.endsWith('.voz.vn'))) {
                        withArticleFetchLane('p3', () => triggerVozCurrentPageBackgroundUpdate(url, directCached, effectiveFeedUrl));
                    }
                    const prefetchQueue = (req.query.threadPage === '1' ? [] : await triggerNextFiveArticlesPrefetch(url, false, prefetchTargets, prefetchPromise));
                    return res.json({
                        url,
                        prefetchQueue,
                        ...directCached,
                        content: cachedSourceHasContent ? cleanArticleMarkup(directCached.content) : '',
                        sourceDeleted: cachedSourceIsDeleted,
                        sourceDeletedHasCache: cachedSourceHasContent,
                        sourceDeletedKind: directCached.sourceDeletedKind || deletedSourceKind(url),
                        title: normalizeArticleTitle(directCached.title),
                        cached: cachedSourceIsDeleted ? cachedSourceHasContent : true,
                        attemptedStrategies: [directCached.fetchStrategy].filter(Boolean),
                        availableStrategies,
                        configuredFetchMethods: policy.hasStrictConfiguredMethods ? policy.configuredMethods : [],
                        methodPreferences
                    });
                    }
                }
            }

            // Non-Google URLs must retain their canonicalized form. Previously
            // this block passed the raw request through the Google resolver and
            // accidentally restored copied trailing punctuation such as `.tpo)`.
            if (!isGoogleNewsArticleUrl(requestedUrl)) {
                url = normalizeArticleSourceUrl(requestedUrl);
            }
            let hostname = '';
            try { hostname = new URL(url).hostname.toLowerCase(); } catch (e) { }
            if (rejectedStrategy && rejectedStrategy in ARTICLE_FETCH_BASE_POINTS) {
                excludedStrategies.add(rejectedStrategy);
                await recordArticleFetchOutcome(hostname, rejectedStrategy, false, 'Rejected by user');
                // Keep the old entry until a different validated strategy has
                // produced an atomic replacement.
            }
            const policy = await getArticleFetchPolicy(url, requestedFeedUrl);
            const availableStrategies = policy.availableStrategies;
            const methodPreferences = await getArticleFetchPreferences(hostname);

            let html = '';
            let htmlStrategy = '';
            const attemptedStrategies = new Set();
            const feedConfiguredMethods = policy.hasStrictConfiguredMethods ? policy.configuredMethods : null;
            let rankedStrategies = [...policy.strategyOrder];

            if (requestedStrategy && requestedStrategy !== 'refresh'
                && policy.hasStrictConfiguredMethods
                && !availableStrategies.includes(requestedStrategy)) {
                finishArticleFetchProgress(requestId, 'Method blocked by source settings.', { failed: true });
                return res.status(400).json({
                    error: `Fetch method "${requestedStrategy}" is not allowed for this source.`,
                    url,
                    attemptedStrategies: [],
                    availableStrategies,
                    configuredFetchMethods: policy.configuredMethods,
                    methodPreferences
                });
            }

            const allowedDefaultStrategies = (requestedStrategy && requestedStrategy !== 'refresh')
                ? [requestedStrategy]
                : rankedStrategies;
            if (policy.hasStrictConfiguredMethods || req.query.fallback !== 'true') {
                for (const strategy of policy.allAvailableStrategies) {
                    if (!allowedDefaultStrategies.includes(strategy)) excludedStrategies.add(strategy);
                }
            }

            const strategyOrder = ((requestedStrategy && requestedStrategy !== 'refresh') ? [requestedStrategy] : rankedStrategies)
                .filter(strategy => !excludedStrategies.has(strategy));
            const strategyLabels = {
                direct: 'publisher website',
                cloudflare: 'reader proxy',
                vietserver: 'Vietnam reader proxy',
                'opencli-fetch': 'OpenCLI browser fetch',
                allorigins: 'backup reader proxy',
                jina: 'text reader backup',
                opencli: 'browser reader backup'
            };
            updateArticleFetchProgress(requestId, 'ranking', 'Choosing the best reader method for this source…', {
                methods: strategyOrder.length
            });

            const strategyErrors = [];
            const deletionEvidence = new Set();
            const recordDeletedResponse = strategy => {
                deletionEvidence.add(strategy || 'unknown');
                return !requiresIndependentDeletionConfirmation(url);
            };

            for (let strategyIndex = 0; strategyIndex < strategyOrder.length; strategyIndex++) {
                const strategy = strategyOrder[strategyIndex];
                attemptedStrategies.add(strategy);
                updateArticleFetchProgress(requestId, 'fetching', `Trying ${strategyLabels[strategy] || strategy}…`, {
                    current: strategyIndex + 1,
                    total: strategyOrder.length
                });
                try {
                    if (strategy === 'jina') {
                        const jinaResult = await fetchViaJina(url);
                        if (isDeletedArticlePayload(url, jinaResult)) {
                            if (!recordDeletedResponse(strategy)) {
                                throw new Error('This reader reported the article missing, but the publisher requires independent confirmation');
                            }
                            finishArticleFetchProgress(requestId, 'Source deleted. Preserving the last cached version.', { method: 'cache' });
                            return res.json(await buildDeletedSourceResponse(url, {
                                attemptedStrategies: [...attemptedStrategies],
                                availableStrategies,
                                configuredFetchMethods: feedConfiguredMethods || [],
                                methodPreferences,
                                deletionConfirmedBy: [...deletionEvidence],
                                fallbackTitle: req.query.title
                            }));
                        }
                        let payload = enhanceArticleResultForSource(url, {
                            url,
                            feedUrl: requestedFeedUrl,
                            ...jinaResult,
                            fetchStrategy: strategy,
                            attemptedStrategies: [...attemptedStrategies],
                            availableStrategies,
                            configuredFetchMethods: feedConfiguredMethods || [],
                            methodPreferences
                        }, { description: requestedDescription });
                        payload = await expandArticleResultForSource(url, payload, { description: requestedDescription });
                        assertArticleResultAcceptedBySource(url, payload);
                        await recordArticleFetchOutcome(hostname, strategy, true);
                        finishArticleFetchProgress(requestId, 'Article is ready.', { method: strategy });
                        await cacheArticleResult(url, payload);
                        payload.prefetchQueue = (req.query.threadPage === '1' ? [] : await triggerNextFiveArticlesPrefetch(url, false, prefetchTargets));
                        return res.json(payload);
                    }

                    if (strategy === 'opencli') {
                        const openCliResult = await fetchViaOpenCli(url, requestId);
                        if (isDeletedArticlePayload(url, openCliResult)) {
                            if (!recordDeletedResponse(strategy)) {
                                throw new Error('This reader reported the article missing, but the publisher requires independent confirmation');
                            }
                            finishArticleFetchProgress(requestId, 'Source deleted. Preserving the last cached version.', { method: 'cache' });
                            return res.json(await buildDeletedSourceResponse(url, {
                                attemptedStrategies: [...attemptedStrategies],
                                availableStrategies,
                                configuredFetchMethods: feedConfiguredMethods || [],
                                methodPreferences,
                                deletionConfirmedBy: [...deletionEvidence],
                                fallbackTitle: req.query.title
                            }));
                        }
                        if (isUnsafeVozThreadPayload(url, openCliResult)) throw new Error('OpenCLI returned a VOZ error page');
                        assertArticleResultAcceptedBySource(url, openCliResult);
                        await recordArticleFetchOutcome(hostname, strategy, true);
                        finishArticleFetchProgress(requestId, 'Article is ready.', { method: strategy });
                        let payload = enhanceArticleResultForSource(url, {
                            url,
                            feedUrl: requestedFeedUrl,
                            ...openCliResult,
                            fetchStrategy: strategy,
                            attemptedStrategies: [...attemptedStrategies],
                            availableStrategies,
                            configuredFetchMethods: feedConfiguredMethods || [],
                            methodPreferences
                        }, { description: requestedDescription });
                        payload = await expandArticleResultForSource(url, payload, { description: requestedDescription });
                        let prefetchPromise = null;
                        if (req.query.threadPage !== '1' && req.query.prefetch !== '1' && payload.pagination?.nextUrl && (hostname === 'voz.vn' || hostname.endsWith('.voz.vn'))) {
                            prefetchPromise = withArticleFetchLane('p1', () => triggerVozNextPagePrefetch(payload.pagination.nextUrl, 1, requestedFeedUrl));
                        }
                        await cacheArticleResult(url, payload);
                        payload.prefetchQueue = (req.query.threadPage === '1' ? [] : await triggerNextFiveArticlesPrefetch(url, false, prefetchTargets, prefetchPromise));
                        return res.json(payload);
                    }

                    const candidateHtml = await fetchArticleHtmlByStrategy(strategy, url);

                    if (isDeletedArticlePayload(url, candidateHtml)) {
                        if (!recordDeletedResponse(strategy)) {
                            throw new Error('This reader reported the article missing, but the publisher requires independent confirmation');
                        }
                        finishArticleFetchProgress(requestId, 'Source deleted. Preserving the last cached version.', { method: 'cache' });
                        return res.json(await buildDeletedSourceResponse(url, {
                            attemptedStrategies: [...attemptedStrategies],
                            availableStrategies,
                            configuredFetchMethods: feedConfiguredMethods || [],
                            methodPreferences,
                            deletionConfirmedBy: [...deletionEvidence],
                            fallbackTitle: req.query.title
                        }));
                    }
                    if (!isUsableArticlePage(candidateHtml)) throw new Error('Fetched page did not contain usable article HTML');
                    html = candidateHtml;
                    htmlStrategy = strategy;
                    break;
                } catch (error) {
                    await recordArticleFetchOutcome(hostname, strategy, false, error.message);

                    const strategyError =
                        `[${strategy}]: ${error.message}`;

                    strategyErrors.push(strategyError);

                    console.warn(
                        '[ARTICLE FETCH FAILED]',
                        JSON.stringify({
                            url,
                            hostname,
                            strategy,
                            error: error.message,
                            configuredFetchMethods:
                                feedConfiguredMethods || null,
                            availableStrategies,
                            attemptedStrategies: [
                                ...attemptedStrategies
                            ]
                        })
                    );
                }
            }

            if (!html) {
                // VOZ_LAST_KNOWN_GOOD_OPEN_FALLBACK_V2
                //
                // A dead/stale OpenCLI browser target must not turn a thread
                // that we already have into a blank reader. This is only a
                // display fallback after every configured live reader failed;
                // live frontier requests can detect `liveRefreshFailed` and
                // must NOT treat this stale snapshot as proof that page N+1
                // exists live.
                if (isVozThreadUrl(url)) {
                    const hintedPage = Number.parseInt(req.query.resumePage, 10);
                    const requestedPage =
                        getVozThreadPageNumber(url)
                        || (Number.isSafeInteger(hintedPage) && hintedPage > 0 ? hintedPage : 1);
                    const baseUrl = normalizeStateUrl(url);
                    const fallbackCandidates = [
                        url,
                        buildVozThreadPageUrl(baseUrl, requestedPage, { preferQuery: true }),
                        buildVozThreadPageUrl(baseUrl, requestedPage, { preferQuery: false })
                    ];

                    let fallback = null;
                    let fallbackUrl = '';

                    for (const candidate of [...new Set(fallbackCandidates)]) {
                        const cached = await getLastKnownCachedArticle(candidate);
                        if (
                            cached?.content
                            && cached.sourceDeleted !== true
                            && !isUnsafeVozThreadPayload(candidate, cached)
                        ) {
                            fallback = cached;
                            fallbackUrl = candidate;
                            break;
                        }
                    }

                    if (fallback) {
                        let payload = enhanceArticleResultForSource(
                            fallbackUrl,
                            {
                                ...fallback,
                                url: fallbackUrl,
                                cached: true,
                                liveRefreshFailed: true,
                                liveRefreshError: strategyErrors.join('\n')
                            },
                            { description: requestedDescription }
                        );

                        payload.pagination = alignVozPaginationToRequestedPage(
                            payload.pagination,
                            fallbackUrl,
                            baseUrl
                        );

                        finishArticleFetchProgress(
                            requestId,
                            'Live VOZ fetch failed. Serving the last cached page.',
                            { method: 'cache', cached: true }
                        );

                        return res.json({
                            ...payload,
                            content: cleanArticleMarkup(payload.content),
                            title: normalizeArticleTitle(payload.title),
                            cached: true,
                            liveRefreshFailed: true,
                            liveRefreshError: strategyErrors.join('\n'),
                            attemptedStrategies: [...attemptedStrategies],
                            availableStrategies,
                            configuredFetchMethods: feedConfiguredMethods || [],
                            methodPreferences
                        });
                    }
                }

                if (requiresIndependentDeletionConfirmation(url) && deletionEvidence.size >= 2) {
                    finishArticleFetchProgress(requestId, 'Source deletion confirmed by independent readers.', { method: 'cache' });
                    return res.json(await buildDeletedSourceResponse(url, {
                        attemptedStrategies: [...attemptedStrategies],
                        availableStrategies,
                        configuredFetchMethods: feedConfiguredMethods || [],
                        methodPreferences,
                        deletionConfirmedBy: [...deletionEvidence],
                        fallbackTitle: req.query.title
                    }));
                }
                if (feedConfiguredMethods) {
                    finishArticleFetchProgress(requestId, 'Selected source methods failed.', { failed: true });
                    return res.json({
                        error: 'Failed to fetch article using the methods selected for this source.',
                        remainingAvailable: false,
                        url,
                        attemptedStrategies: [...attemptedStrategies],
                        availableStrategies,
                        configuredFetchMethods: feedConfiguredMethods,
                        methodPreferences
                    });
                }

                finishArticleFetchProgress(requestId, 'No reader method could load this article.', { failed: true });

                let errorMessage = 'Failed to fetch article';
                if (strategyErrors.length > 0) {
                    errorMessage += ':\n' + strategyErrors.join('\n');
                }

                return res.json({
                    error: errorMessage,
                    url,
                    attemptedStrategies: [...attemptedStrategies],
                    availableStrategies,
                    methodPreferences
                });
            }

            let result = await parseArticleHtmlContent(html, url, htmlStrategy, [...attemptedStrategies], availableStrategies, methodPreferences, requestId, excludedStrategies);
            if (result) {
                result.feedUrl = requestedFeedUrl || result.feedUrl || '';
                result.configuredFetchMethods = feedConfiguredMethods || [];
                result = enhanceArticleResultForSource(url, result, {
                    description: requestedDescription
                });
                result = await expandArticleResultForSource(url, result, {
                    description: requestedDescription
                });
            }
            if (result && !isDeletedArticlePayload(url, result)) {
                assertArticleResultAcceptedBySource(url, result);
            }

            if (result && isDeletedArticlePayload(url, result)) {
                recordDeletedResponse(result.fetchStrategy || htmlStrategy || 'extraction');
                if (requiresIndependentDeletionConfirmation(url)) {
                    finishArticleFetchProgress(requestId, 'A reader returned an unconfirmed missing-page response.', { failed: true });
                    return res.json({
                        error: 'The selected reader could not confirm this article. Try another reader method.',
                        url,
                        attemptedStrategies: [...attemptedStrategies],
                        availableStrategies,
                        methodPreferences
                    });
                }
                finishArticleFetchProgress(requestId, 'Source deleted. Preserving the last cached version.', { method: 'cache' });
                return res.json(await buildDeletedSourceResponse(url, {
                    attemptedStrategies: [...attemptedStrategies],
                    availableStrategies,
                    configuredFetchMethods: feedConfiguredMethods || [],
                    methodPreferences,
                    deletionConfirmedBy: [...deletionEvidence],
                    fallbackTitle: req.query.title
                }));
            }

            const extractedTextLength = (result.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
            const extractionSucceeded = extractedTextLength >= 200 || /<(?:video|audio|img)\b/i.test(result.content || '');

            finishArticleFetchProgress(requestId, extractionSucceeded ? 'Article is ready.' : 'Only part of the article could be recovered.', {
                method: result.fetchStrategy,
                partial: !extractionSucceeded
            });
            if (extractionSucceeded) await cacheArticleResult(url, result);
            let prefetchPromise = null;
            if (req.query.threadPage !== '1' && req.query.prefetch !== '1' && result.pagination?.nextUrl && (hostname === 'voz.vn' || hostname.endsWith('.voz.vn'))) {
                prefetchPromise = withArticleFetchLane('p1', () => triggerVozNextPagePrefetch(result.pagination.nextUrl, 1, requestedFeedUrl));
            }
            result.prefetchQueue = (req.query.threadPage === '1' ? [] : await triggerNextFiveArticlesPrefetch(url, false, prefetchTargets, prefetchPromise));
            res.json(result);
        } catch (e) {
            finishArticleFetchProgress(requestId, 'Article loading failed.', { failed: true });
            res.json({ error: e.message, url });
        } finally {
            articleReaderSessions.delete(requestId);
            progress.activeForegroundRequests = Math.max(0, progress.activeForegroundRequests - 1);
        }
    });

}
