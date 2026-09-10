import { normalizeArticleTitle } from '../../feed-parsers.js';
import { normalizeArticleSourceUrl } from '../article-source-state.js';
import { isGoogleNewsArticleUrl, isGoogleNewsHostedThumbnail } from './search-destination.js';
import { publisherIcon, safeHttpUrl, isInvalidImage, normalizeStateUrl, mapWithConcurrency, NormalizedSet } from '../utils/article-utils.js';
import { enhanceArticleResultForSource } from './source-results.js';
import sourceRegistry from '../sources/index.js';
import { cleanStoredCluster, calculateHotness } from '../../smart-news.js';
import { normalizeBlockedKeywordEntries, articleContentFilterMatches } from '../filters/content-filter.js';

export function createArticlePresentation({
    resolveGoogleNewsUrl,
    getLastKnownCachedArticle,
    getLastKnownCachedArticleImage = async url => (await getLastKnownCachedArticle(url))?.image,
    env,
} = {}) {
    // Cache for parsed JSON strings (e.g. smartClusters) to avoid CPU-heavy parsing on tab clicks
    let _smartClustersHistory = {};

    async function prepareArticleForClient(article, isSubItem = false) {
        const prepared = { ...article, title: normalizeArticleTitle(article.title) };
        prepared.link = normalizeArticleSourceUrl(prepared.link);
        if (prepared.originalLink) prepared.originalLink = normalizeArticleSourceUrl(prepared.originalLink);
        const cameFromGoogleNews = isGoogleNewsArticleUrl(prepared.link)
            || isGoogleNewsArticleUrl(prepared.originalLink);
        if (isGoogleNewsArticleUrl(prepared.link)) {
            prepared.originalLink = prepared.link;
            prepared.link = await resolveGoogleNewsUrl(prepared.link, prepared, { backgroundResolve: true, isSubItem });
            if (!isGoogleNewsArticleUrl(prepared.link)) prepared.feedIcon = publisherIcon(prepared.link);
        }
        if (safeHttpUrl(prepared.link) && (!prepared.feedIcon || /icons\.duckduckgo\.com\/ip3\//i.test(prepared.feedIcon))) {
            prepared.feedIcon = publisherIcon(prepared.link);
        }

        // Techmeme's RSS entry points to the Techmeme discussion page, while the
        // cached expanded article knows the original publisher. Surface that
        // metadata on list cards without re-fetching anything during tab open.
        try {
            const hostname = new URL(prepared.link).hostname.replace(/^www\./, '');
            if (hostname === 'techmeme.com' && !prepared.primarySource) {
                let cached = await getLastKnownCachedArticle(prepared.link);
                if (!cached && new URL(prepared.link).hash) {
                    const unfragmented = new URL(prepared.link);
                    unfragmented.hash = '';
                    cached = await getLastKnownCachedArticle(unfragmented.href);
                }
                if (cached) cached = enhanceArticleResultForSource(prepared.link, cached, { cacheMigration: true });
                if (cached?.primarySource) {
                    prepared.primarySource = cached.primarySource;
                    prepared.primaryArticleUrl = cached.primaryArticleUrl || cached.primarySource.url || '';
                    prepared.primaryArticleFetched = cached.primaryArticleFetched === true;
                    if (safeHttpUrl(cached.image) && !isInvalidImage(cached.image)) {
                        prepared.image = cached.image;
                    } else if (safeHttpUrl(prepared.primaryArticleUrl)) {
                        prepared.image = `/api/og-image?url=${encodeURIComponent(prepared.primaryArticleUrl)}`;
                    }
                }
            }
        } catch (error) { }

        // Google News entries often omit the publisher image. Reuse the real
        // image already stored with the prefetched publisher article instead of
        // making the browser show a generated placeholder and fetching again.
        try {
            const sourceHandler = sourceRegistry.getHandler(prepared.link);
            const currentImage = safeHttpUrl(prepared.image);
            const needsCachedImage = !currentImage
                || isInvalidImage(currentImage)
                || (cameFromGoogleNews && isGoogleNewsHostedThumbnail(currentImage))
                || sourceHandler?.isInvalidFeedImage?.(currentImage) === true;
            if (needsCachedImage && /^https?:\/\/(?:www\.)?(?:voz\.vn|tinhte\.vn)\//i.test(prepared.link)) {
                prepared.image = `/api/cached-card-image?url=${encodeURIComponent(prepared.link)}`;
            } else if (needsCachedImage && safeHttpUrl(prepared.link) && !isGoogleNewsArticleUrl(prepared.link)) {
                const cachedImage = safeHttpUrl(await getLastKnownCachedArticleImage(prepared.link));
                if (cachedImage
                    && !isInvalidImage(cachedImage)
                    && sourceHandler?.isInvalidFeedImage?.(cachedImage) !== true) {
                    prepared.image = cachedImage;
                } else if (cameFromGoogleNews) {
                    prepared.image = `/api/og-image?url=${encodeURIComponent(prepared.link)}`;
                }
            }
        } catch (error) { }

        if (!prepared.originalLink) prepared.originalLink = prepared.link;
        prepared.link = normalizeStateUrl(prepared.link);

        if (Array.isArray(prepared.relatedArticles)) {
            prepared.relatedArticles = await mapWithConcurrency(prepared.relatedArticles, 4, a => prepareArticleForClient(a, true));
        }
        return prepared;
    }

    const smartApiViewCache = new Map();

    let latestSmartApiVersion = '';
    const freshViewCache = new Map();

    let unavailableSourceMutation = Promise.resolve();

    function markUnavailableSourceUrl(url) {
        const normalizedUrl = normalizeStateUrl(url);
        if (!normalizedUrl) return Promise.resolve();
        unavailableSourceMutation = unavailableSourceMutation.catch(() => {}).then(async () => {
            const urls = await env.RSS_DATA.get('unavailableSourceUrls', { type: 'json' }) || [];
            const unavailable = new NormalizedSet(urls);
            if (unavailable.has(normalizedUrl)) return;
            urls.push(normalizedUrl);
            await env.RSS_DATA.put('unavailableSourceUrls', JSON.stringify(urls));
            smartApiViewCache.clear();
        });
        return unavailableSourceMutation;
    }

    function clearUnavailableSourceUrl(url) {
        const normalizedUrl = normalizeStateUrl(url);
        if (!normalizedUrl) return Promise.resolve();
        unavailableSourceMutation = unavailableSourceMutation.catch(() => {}).then(async () => {
            const urls = await env.RSS_DATA.get('unavailableSourceUrls', { type: 'json' }) || [];
            const nextUrls = urls.filter(value => normalizeStateUrl(value) !== normalizedUrl);
            if (nextUrls.length === urls.length) return;
            await env.RSS_DATA.put('unavailableSourceUrls', JSON.stringify(nextUrls));
            smartApiViewCache.clear();
        });
        return unavailableSourceMutation;
    }

    function isInvestingSmartArticle(article) {
        if (!article) return false;
        const text = [
            article.link,
            article.feedUrl,
            article.url,
            article.feedTitle,
            article.sourceName,
            article.source,
            ...(Array.isArray(article.sources) ? article.sources : [])
        ].filter(Boolean).join(' ').toLowerCase();
        return text.includes('investing.com');
    }

    function smartArticleMatchesSection(article, filterValue) {
        if (!filterValue) return true;
        if (filterValue === 'news') return ['news_vietnam', 'news_world'].includes(article.smartCategory);
        if (filterValue === 'finance') return ['finance_vietnam', 'finance_global'].includes(article.smartCategory);
        if (filterValue === 'tech') return article.smartCategory === 'tech' && !isInvestingSmartArticle(article);
        return article.smartCategory === filterValue;
    }

    function buildSmartApiView(rawClusters, filterValue) {
        const clusters = [];
        for (const storedArticle of rawClusters) {
            const cleaned = cleanStoredCluster(storedArticle);
            if (!cleaned || !smartArticleMatchesSection(cleaned, filterValue)) continue;

            let article = cleaned;
            if (filterValue === 'tech' && Array.isArray(cleaned.relatedArticles)) {
                const cleanRelated = cleaned.relatedArticles.filter(related => !isInvestingSmartArticle(related));
                if (cleanRelated.length !== cleaned.relatedArticles.length) {
                    const sources = [...new Set([cleaned.feedTitle, ...cleanRelated.map(related => related.feedTitle)].filter(Boolean))];
                    article = {
                        ...cleaned,
                        relatedArticles: cleanRelated,
                        clusterCount: cleanRelated.length + 1,
                        sourceCount: sources.length,
                        sources
                    };
                }
            }

            const clusterArticles = [article, ...(Array.isArray(article.relatedArticles) ? article.relatedArticles : [])];
            clusters.push({ ...article, hotness: calculateHotness(clusterArticles) });
        }

        clusters.sort((left, right) =>
            (right.hotness || 0) - (left.hotness || 0) ||
            (right.sourceWeight || 1) - (left.sourceWeight || 1) ||
            (new Date(right.pubDate || 0).getTime()) - (new Date(left.pubDate || 0).getTime())
        );
        return clusters;
    }

    function markUnavailableSmartSources(article, unavailableSet) {
        const annotate = candidate => unavailableSet.has(candidate?.link)
            ? { ...candidate, sourceDeleted: true, sourceDeletedHasCache: false }
            : candidate;
        return {
            ...annotate(article),
            ...(Array.isArray(article.relatedArticles)
                ? { relatedArticles: article.relatedArticles.map(annotate) }
                : {})
        };
    }

    async function serveSmartData(req, res) {
        const startedAt = Date.now();
        const filterValue = req.query.filterValue || '';
        const hideRead = req.query.hideRead === 'true';
        const searchQuery = req.query.searchQuery ? req.query.searchQuery.toLowerCase() : '';

        const [
            feeds,
            readStates,
            savedStates,
            boardStates,
            hiddenStates,
            categoryOrder,
            userPreferences,
            blockedKeywords,
            unavailableSourceUrls
        ] = await Promise.all([
            env.RSS_DATA.get('feeds', { type: 'json' }),
            env.RSS_DATA.get('readStates', { type: 'json' }),
            env.RSS_DATA.get('savedStates', { type: 'json' }),
            env.RSS_DATA.get('boardStates', { type: 'json' }),
            env.RSS_DATA.get('hiddenStates', { type: 'json' }),
            env.RSS_DATA.get('categoryOrder', { type: 'json' }),
            env.RSS_DATA.get('userPreferences', { type: 'json' }),
            env.RSS_DATA.get('blockedArticleKeywords', { type: 'json' }),
            env.RSS_DATA.get('unavailableSourceUrls', { type: 'json' })
        ]);

        let smartClusterVersion = await env.RSS_DATA.get('smartClusterVersion') || '';
        const requestedVersion = Number(req.query.page || 1) > 1 ? (req.query.smartVersion || '') : '';
        let rawClusters;
        if (requestedVersion && _smartClustersHistory[requestedVersion]) {
            rawClusters = _smartClustersHistory[requestedVersion];
            smartClusterVersion = requestedVersion;
        } else {
            rawClusters = await env.RSS_DATA.get('smartClusters', { type: 'json', shared: true }) || [];
            if (smartClusterVersion) {
                _smartClustersHistory[smartClusterVersion] = rawClusters;
                const historyKeys = Object.keys(_smartClustersHistory);
                if (historyKeys.length > 6) delete _smartClustersHistory[historyKeys[0]];
            }
        }

        if (!requestedVersion && smartClusterVersion !== latestSmartApiVersion) {
            smartApiViewCache.clear();
            latestSmartApiVersion = smartClusterVersion;
        }

        const cacheKey = `${smartClusterVersion}:${filterValue}`;
        let filteredArticles = smartApiViewCache.get(cacheKey);
        const cacheHit = Boolean(filteredArticles);
        if (!filteredArticles) {
            filteredArticles = buildSmartApiView(rawClusters, filterValue);
            smartApiViewCache.set(cacheKey, filteredArticles);
            while (smartApiViewCache.size > 7) smartApiViewCache.delete(smartApiViewCache.keys().next().value);
        }

        // Fresh headlines must remain visible while embeddings and AI grouping run.
        // Preserve grouped stories and add only articles absent from that snapshot.
        const rawArticles = await env.RSS_DATA.get('smartRawArticles', { type: 'json', shared: true }) || [];
        const freshKey = `${smartClusterVersion}:${filterValue}:${Math.floor(Date.now() / 60000)}`;
        let freshView = freshViewCache.get(freshKey);
        if (!freshView || freshView.raw !== rawArticles || freshView.clusters !== rawClusters) {
            const represented = new NormalizedSet(rawClusters.flatMap(article =>
                [article.link, ...(article.relatedArticles || []).map(related => related.link)]));
            const freshArticles = rawArticles.filter(article => !represented.has(article.link)
                && smartArticleMatchesSection(article, filterValue));
            const articles = [...filteredArticles, ...buildSmartApiView(freshArticles, filterValue)];
            const cutoff = Date.now() - 24 * 60 * 60 * 1000;
            const recent = article => Number(new Date(article.pubDate || 0).getTime() > cutoff);
            articles.sort((a, b) => recent(b) - recent(a) || (b.hotness || 0) - (a.hotness || 0)
                || new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
            freshView = { raw: rawArticles, clusters: rawClusters, articles };
            freshViewCache.set(freshKey, freshView);
            while (freshViewCache.size > 7) freshViewCache.delete(freshViewCache.keys().next().value);
        }
        filteredArticles = freshView.articles;

        const readSet = new NormalizedSet(readStates || []);
        const hiddenSet = new NormalizedSet(hiddenStates || []);
        const unavailableSet = new NormalizedSet(unavailableSourceUrls || []);
        const blockedKeywordEntries = normalizeBlockedKeywordEntries(blockedKeywords || []);
        const matchesSearch = value => String(value || '').toLowerCase().includes(searchQuery);

        filteredArticles = filteredArticles
            .map(article => markUnavailableSmartSources(article, unavailableSet))
            .filter(Boolean)
            .filter(article => {
            if (hiddenSet.has(article.link) || articleContentFilterMatches(article, blockedKeywordEntries)) return false;
            if (hideRead && readSet.has(article.link)) return false;
            if (!searchQuery) return true;
            return matchesSearch(article.title) ||
                matchesSearch(article.feedTitle) ||
                matchesSearch(article.content) ||
                (Array.isArray(article.relatedArticles) && article.relatedArticles.some(related =>
                    matchesSearch(related.title) || matchesSearch(related.feedTitle)
                ));
            });

        if (hideRead) {
            filteredArticles = filteredArticles.map(article => {
                if (!Array.isArray(article.relatedArticles) || !article.relatedArticles.length) return article;
                const unreadRelated = article.relatedArticles.filter(related => !readSet.has(related.link));
                if (unreadRelated.length === article.relatedArticles.length) return article;
                const sources = [...new Set([article.feedTitle, ...unreadRelated.map(related => related.feedTitle)].filter(Boolean))];
                return {
                    ...article,
                    relatedArticles: unreadRelated,
                    clusterCount: unreadRelated.length + 1,
                    sourceCount: sources.length,
                    sources
                };
            });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 40;
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const paginatedArticles = await mapWithConcurrency(
            filteredArticles.slice(startIndex, endIndex),
            6,
            article => prepareArticleForClient(article)
        );

        res.setHeader('Server-Timing', `smart-data;dur=${Date.now() - startedAt}`);
        res.setHeader('X-Smart-View-Cache', cacheHit ? 'hit' : 'miss');
        res.json({
            feeds: feeds || [],
            articles: paginatedArticles,
            readStates: readStates || [],
            savedStates: savedStates || [],
            boardStates: boardStates || [],
            hiddenStates: hiddenStates || [],
            categoryOrder: categoryOrder || [],
            userPreferences: userPreferences || {},
            hasMore: endIndex < filteredArticles.length,
            currentPage: page,
            smartClusterVersion
        });
    }

    return {
        markUnavailableSourceUrl,
        serveSmartData,
        get _smartClustersHistory() { return _smartClustersHistory; },
        prepareArticleForClient,
        clearUnavailableSourceUrl
    };
}
