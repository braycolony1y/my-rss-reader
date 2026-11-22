import { createClientArticlePreparer } from './client-preparer.js';
import { personalSignature } from '../smart/feedback/store.js';
import { createPersonalViewCache } from './personal-view-cache.js';
import { smartDestination } from '../utils/smart-destinations.js';
import { rankStory, storyMembers } from './story-ranking.js';
import { rankClassicStories } from '../ranking/classic.js';
import { classicRankingMode, vectorWaitMs } from '../ranking/config.js';
import { createVectorStore } from '../ranking/vector-store.js';
import { normalizeStateUrl, mapWithConcurrency, NormalizedSet } from '../utils/article-utils.js';
import { cleanStoredCluster, calculateHotness, buildCluster } from '../../smart-news.js';
import { normalizeBlockedKeywordEntries, articleContentFilterMatches } from '../filters/content-filter.js';

export function createArticlePresentation({
    resolveGoogleNewsUrl,
    getLastKnownCachedArticle,
    getLastKnownCachedArticleImage = async url => (await getLastKnownCachedArticle(url))?.image,
    getCachedThreadCreationTime,
    env,
    rankingVectors = createVectorStore(),
} = {}) {
    // Cache for parsed JSON strings (e.g. smartClusters) to avoid CPU-heavy parsing on tab clicks
    let _smartClustersHistory = {};
    const filterNavigationView = createPersonalViewCache();

    const prepareArticleForClient = createClientArticlePreparer({ resolveGoogleNewsUrl,
        getLastKnownCachedArticle, getLastKnownCachedArticleImage, getCachedThreadCreationTime });

    const smartApiViewCache = new Map();
    const storyViews = new Map();
    let storyViewSequence = 0;

    let latestSmartApiVersion = '';
    const freshViewCache = new Map();
    const classicRankedViews = new Map();

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

    // TOP_STORIES_GLOBAL_CANONICAL_V1
    function canonicalSmartCategory(value) {
        return String(value || '')
            .replace(/_world$/, '_global')
            .replace(/_foreign$/, '_global');
    }

    function smartTechRegion(article) {
        const region = String(article?.region || '').toLowerCase();

        if (region === 'vietnam') return 'vietnam';

        if (['foreign', 'world', 'global'].includes(region)) {
            return 'global';
        }

        // Older stored records may not have region populated.
        return /^vi(?:-|$)/i.test(String(article?.language || ''))
            ? 'vietnam'
            : 'global';
    }

    function smartArticleMatchesSection(
        article,
        filterValue,
        smartRegion = 'global'
    ) {
        if (!filterValue) return true;

        const category =
            canonicalSmartCategory(
                article?.smartCategory
            );

        if (filterValue === 'news') {
            return category === `news_${smartRegion}`;
        }

        if (filterValue === 'finance') {
            return category === `finance_${smartRegion}`;
        }

        if (filterValue === 'tech') {
            return (
                category === 'tech' &&
                !isInvestingSmartArticle(article) &&
                smartTechRegion(article) === smartRegion
            );
        }

        return (
            category ===
            canonicalSmartCategory(filterValue)
        );
    }

    function buildSmartApiView(
        rawClusters,
        filterValue,
        smartRegion = 'global'
    ) {
        const clusters = [];
        for (const storedArticle of rawClusters) {
            if (storedArticle.smartCategory && !smartArticleMatchesSection(storedArticle, filterValue, smartRegion)) continue;
            const cleaned = cleanStoredCluster((storedArticle.isCluster || storedArticle.clusterId) ? { ...storedArticle, isCluster: true } : buildCluster([storedArticle]));
            if (
                !cleaned ||
                !smartArticleMatchesSection(
                    cleaned,
                    filterValue,
                    smartRegion
                )
            ) continue;

            let article = cleaned;
            if (filterValue === 'tech' && Array.isArray(cleaned.relatedArticles)) {
                const cleanRelated = cleaned.relatedArticles.filter(
                    related =>
                        smartArticleMatchesSection(
                            related,
                            'tech',
                            smartRegion
                        )
                );
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

            // CLASSIC_SINGLE_RANK_FAST_PATH_V1
            //
            // Do NOT rank here. This function prepares the current Smart
            // candidate graph only.
            //
            // New Classic views perform the authoritative rank later, after
            // user filters are applied. Reusable Classic
            // smartViews use their already-pinned ranked array.
            //
            // Ranking here therefore duplicated the full Classic ranking pass
            // on every fresh candidate-view build.
            clusters.push(article);
        }

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

    // CLASSIC_RANKING=legacy: the original rule-only ordering (rankStory).
    function legacyClassicRank(articles, filterValue) {
        const now = Date.now();
        return articles.map(article => {
            const ranking = rankStory(storyMembers(article), filterValue, now, null);
            return { ...article, ranking, hotness: ranking.score, sourceCount: ranking.independentSources };
        }).sort((a, b) => b.hotness - a.hotness || b.ranking.updatedAt.localeCompare(a.ranking.updatedAt) || a.link.localeCompare(b.link));
    }

    async function serveSmartData(req, res) {
        const startedAt = Date.now();
        const timings = {}; let phaseAt = performance.now();
        const mark = name => { const t = performance.now(); timings[name] = t-phaseAt; phaseAt=t; };
        mark("request-received");
        const destination = smartDestination(req.query.filterValue, req.query.smartRegion);
        const filterValue = destination.startsWith('tech_') ? 'tech' : destination;
        const smartRegion = destination.endsWith('_vietnam') ? 'vietnam' : 'global';
        const smartRegionKey =
            filterValue === 'tech' ? smartRegion : '';
        const hideRead = req.query.hideRead === 'true';
        const searchQuery = req.query.searchQuery ? req.query.searchQuery.toLowerCase() : '';

        // SMART_RAM_REQUEST_FAST_PATH_V1
        //
        // All of these values are read-only in this request. Reuse the
        // already-parsed global DB values rather than structuredClone()
        // arrays/objects on every Stories request.
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
            env.RSS_DATA.get('feeds', { type: 'json', shared: true }),
            env.RSS_DATA.get('readStates', { type: 'json', shared: true }),
            env.RSS_DATA.get('savedStates', { type: 'json', shared: true }),
            env.RSS_DATA.get('boardStates', { type: 'json', shared: true }),
            env.RSS_DATA.get('hiddenStates', { type: 'json', shared: true }),
            env.RSS_DATA.get('categoryOrder', { type: 'json', shared: true }),
            env.RSS_DATA.get('userPreferences', { type: 'json', shared: true }),
            env.RSS_DATA.get('blockedArticleKeywords', { type: 'json', shared: true }),
            env.RSS_DATA.get('unavailableSourceUrls', { type: 'json', shared: true })
        ]);

        // Stories is the only view. Legacy smartMode query values and any stored
        // userPreferences.smartTabModes ('top' or 'classic') are accepted and ignored.

        // Expired pinned views otherwise remain in memory indefinitely until
        // enough new view tokens happen to evict them.
        const viewNow = Date.now();
        for (const [key, view] of storyViews) {
            if (
                !view?.createdAt ||
                viewNow - view.createdAt >= 30 * 60000
            ) {
                storyViews.delete(key);
            }
        }

        let smartClusterVersion = '', filteredArticles, classicInput, cacheHit = false;
        {
            const requestedVersion = Number(req.query.page || 1) > 1 ? (req.query.smartVersion || '') : '';
            let rawClusters;
            if (requestedVersion && _smartClustersHistory[requestedVersion]) {
                rawClusters = _smartClustersHistory[requestedVersion];
                smartClusterVersion = requestedVersion;
            } else {
                const finalVersion = await env.RSS_DATA.get('smartClusterVersion');
                smartClusterVersion = requestedVersion || finalVersion || '';
                rawClusters = await env.RSS_DATA.get('smartClusters', { type: 'json', shared: true }) || [];
                if (smartClusterVersion) {
                    _smartClustersHistory[smartClusterVersion] = rawClusters;

                    // Keep current + at most one older version for pagination.
                    const staleKeys = Object.keys(_smartClustersHistory)
                        .filter(key => key !== smartClusterVersion);

                    while (
                        Object.keys(_smartClustersHistory).length > 2 &&
                        staleKeys.length
                    ) {
                        delete _smartClustersHistory[staleKeys.shift()];
                    }
                }
            }

            if (!requestedVersion && smartClusterVersion !== latestSmartApiVersion) {
                smartApiViewCache.clear();

                // Each fresh view stores references to the complete raw article
                // and cluster graphs. Keeping entries from prior Smart versions
                // can therefore pin multiple huge object graphs.
                freshViewCache.clear();
                classicRankedViews.clear();

                latestSmartApiVersion = smartClusterVersion;
            }

            mark("persisted-read");
            const cacheKey =
                `${smartClusterVersion}:${filterValue}:${smartRegionKey}`;
            const candidateView = smartApiViewCache.get(cacheKey);
            filteredArticles = candidateView?.raw === rawClusters ? candidateView.articles : null;
            cacheHit = Boolean(filteredArticles);
            if (!filteredArticles) {
                filteredArticles = buildSmartApiView(
                    rawClusters,
                    filterValue,
                    smartRegion
                );
                smartApiViewCache.set(cacheKey, { raw: rawClusters, articles: filteredArticles });
                while (smartApiViewCache.size > 7) smartApiViewCache.delete(smartApiViewCache.keys().next().value);
            }

            // Fresh headlines must remain visible while embeddings and AI grouping run.
            // Preserve grouped stories and add only articles absent from that snapshot.
            const rawArticles = await env.RSS_DATA.get('smartRawArticles', { type: 'json', shared: true }) || [];
            const freshKey =
                `${smartClusterVersion}:${filterValue}:${smartRegionKey}`;
            let freshView = freshViewCache.get(freshKey);
            if (!freshView || freshView.raw !== rawArticles || freshView.clusters !== rawClusters) {
                const represented = new NormalizedSet(rawClusters.flatMap(article =>
                    [article.link, ...(article.relatedArticles || []).map(related => related.link)]));
                const freshArticles = rawArticles.filter(article => !represented.has(article.link)
                    && smartArticleMatchesSection(
                        article,
                        filterValue,
                        smartRegion
                    ));
                const articles = [
                    ...filteredArticles,
                    ...buildSmartApiView(
                        freshArticles,
                        filterValue,
                        smartRegion
                    )
                ];
                freshView = { raw: rawArticles, clusters: rawClusters, articles };
                freshViewCache.set(freshKey, freshView);
                while (freshViewCache.size > 7) freshViewCache.delete(freshViewCache.keys().next().value);
            }
            filteredArticles = freshView.articles;
            classicInput = freshView;
            mark("candidate-collection");
        }
        mark('ranking-total');
        const readSet = new NormalizedSet(readStates || []);
        const hiddenSet = new NormalizedSet(hiddenStates || []);
        const unavailableSet = new NormalizedSet(unavailableSourceUrls || []);
        const blockedKeywordEntries = normalizeBlockedKeywordEntries(blockedKeywords || []);
        const matchesSearch = value => String(value || '').toLowerCase().includes(searchQuery);

        const personalFilterSignature = await personalSignature(env.RSS_DATA);
        const filterSignature = JSON.stringify([
            personalFilterSignature,
            filterValue,
            smartRegionKey,
            hideRead,
            searchQuery,
            hiddenStates,
            hideRead ? readStates : [],
            blockedKeywords,
            unavailableSourceUrls
        ]);
        const classicMode = classicRankingMode();
        const classicKey = JSON.stringify([filterSignature, Math.floor(Date.now() / 60000), classicMode, rankingVectors.revision]);
        const classicEntry = classicRankedViews.get(classicKey);
        const cachedClassic = classicEntry?.input === classicInput ? classicEntry : null;
        if (cachedClassic) {
            filteredArticles = cachedClassic.articles;
        }
        else {
            const needsMemberFiltering =
                hiddenSet.size > 0 ||
                blockedKeywordEntries.length > 0 ||
                unavailableSet.size > 0;
            filteredArticles = filteredArticles
                .map(article => {
                    if (!needsMemberFiltering) return article;
                    const members = storyMembers(article).filter(a => !hiddenSet.has(a.link) && !articleContentFilterMatches(a, blockedKeywordEntries));
                    if (!members.length) return null;
                    const representative = members[0];
                    return markUnavailableSmartSources({ ...article, ...representative, isCluster: true, clusterId: article.clusterId,
                        relatedArticles: members.slice(1), clusterCount: members.length }, unavailableSet);
                })
                .filter(Boolean)
                .filter(article => {
                if (hiddenSet.has(article.link) || articleContentFilterMatches(article, blockedKeywordEntries)) return false;
                if (hideRead && storyMembers(article).every(member => readSet.has(member.link))) return false;
                if (!searchQuery) return true;
                return matchesSearch(article.title) ||
                    matchesSearch(article.feedTitle) ||
                    matchesSearch(article.content) ||
                    (Array.isArray(article.relatedArticles) && article.relatedArticles.some(related =>
                        matchesSearch(related.title) || matchesSearch(related.feedTitle)
                    ));
                });

            // In the normal path there is nothing to mutate. Avoid
            // shallow-copying thousands of full article/cluster objects merely
            // to recreate an identical relatedArticles array.
            if (needsMemberFiltering) {
                filteredArticles = filteredArticles.map(article => ({
                    ...article,
                    relatedArticles: (article.relatedArticles || []).filter(
                        a =>
                            !hiddenSet.has(a.link) &&
                            !articleContentFilterMatches(a, blockedKeywordEntries)
                    )
                }));
            }

        }
        const viewSignature = JSON.stringify([
            personalFilterSignature,
            filterValue,
            filterValue === 'tech' ? smartRegion : null,
            hideRead,
            searchQuery,
            hiddenStates,
            hideRead ? readStates : [],
            blockedKeywords
        ]);

        const priorView = storyViews.get(req.query.smartView);

        const reusableView =
            priorView &&
            priorView.signature === viewSignature &&
            Date.now() - priorView.createdAt < 30 * 60000;

        // Classic ranking (Stories): the deterministic ranker in src/ranking (rules, source weights,
        // corroboration and the existing e5 vectors; no generative AI). CLASSIC_RANKING=legacy
        // restores the old rankStory() ordering.
        //
        // When there is a reusable smartView the pinned ranked array is used and nothing is
        // ranked at all.
        filteredArticles = await filterNavigationView(env.RSS_DATA, filteredArticles, filterValue, 'pre_classic_ranking');
        const needsClassicRanking = !reusableView && !cachedClassic;
        if (needsClassicRanking && classicMode !== 'legacy') {
            // Vectors come from the clustering's cache. Wait briefly for a cold start; after that
            // missing vectors only degrade the e5 features of those stories.
            const loading = rankingVectors.warm(filteredArticles.flatMap(storyMembers));
            if (loading) await Promise.race([loading, new Promise(resolve => setTimeout(resolve, vectorWaitMs()).unref?.())]);
        }
        const ranked =
            reusableView
                ? priorView.articles
                : cachedClassic
                    ? cachedClassic.articles
                    : classicMode === 'legacy'
                        ? legacyClassicRank(filteredArticles, filterValue)
                        : rankClassicStories(filteredArticles, { destination, now: Date.now(), vectorOf: article => rankingVectors.get(article) });

        if (!cachedClassic && !reusableView) {
            classicRankedViews.set(classicKey, { input: classicInput, articles: ranked });
            while (classicRankedViews.size > 6) classicRankedViews.delete(classicRankedViews.keys().next().value);
        }
        mark("filtering");

        let smartViewToken = req.query.smartView;
        filteredArticles = await filterNavigationView(env.RSS_DATA, reusableView ? priorView.articles : ranked, filterValue, 'cached_smart_view');
        if (!reusableView) {
            smartViewToken = `${Date.now()}-${++storyViewSequence}`;
            storyViews.set(smartViewToken, {
                signature: viewSignature,
                articles: filteredArticles,
                createdAt: Date.now()
            });
            while (storyViews.size > 8) storyViews.delete(storyViews.keys().next().value);
        }
        const viewReset = Boolean(req.query.smartView && !reusableView);
        const page = viewReset ? 1 : Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 40));
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const pageArticles = filteredArticles.slice(startIndex, endIndex);
        mark("snapshot-construction");
        const paginatedArticles = await mapWithConcurrency(pageArticles, 6, article => prepareArticleForClient(article));
        mark('card-preparation');
        res.setHeader('X-Smart-View-Cache', cacheHit ? 'hit' : 'miss');
        const payload = {
            feeds: feeds || [],
            articles: paginatedArticles,
            smartViewToken,
            viewReset,
            readStates: readStates || [],
            savedStates: savedStates || [],
            boardStates: boardStates || [],
            hiddenStates: hiddenStates || [],
            categoryOrder: categoryOrder || [],
            userPreferences: userPreferences || {},
            hasMore: endIndex < filteredArticles.length,
            currentPage: page,
            smartClusterVersion
        };
        const serialized = JSON.stringify(payload);
        mark("serialization");

        timings["smart-data"] = Date.now() - startedAt;

        res.setHeader(
            "Server-Timing",
            Object.entries(timings)
                .map(([name, ms]) => `${name};dur=${Number(ms || 0).toFixed(3)}`)
                .join(", ")
        );

        if (process.env.SMART_REFRESH_PROFILE) console.info("[SMART REFRESH]", JSON.stringify(timings));
        if (res.send) {
            return res.type("json").send(serialized);
        }

        return res.json(payload);
    }

    return {
        releaseTransientCaches() {
            _smartClustersHistory = {};
            smartApiViewCache.clear();
            freshViewCache.clear();
            classicRankedViews.clear();
            storyViews.clear();
        },
        markUnavailableSourceUrl,
        serveSmartData,
        get _smartClustersHistory() { return _smartClustersHistory; },
        prepareArticleForClient,
        clearUnavailableSourceUrl
    };
}
