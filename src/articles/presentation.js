import { createTopStoriesSnapshots } from './top-stories-snapshot.js';
import { createTopStoriesIndex } from './top-stories.js';
import { rankStory, storyMembers } from './story-ranking.js';
import { createStoryBriefings } from './story-briefing.js';
import { generateStoryBriefing } from '../../summary-engine.js';
import { normalizeArticleTitle } from '../../feed-parsers.js';
import { normalizeArticleSourceUrl } from '../article-source-state.js';
import { isGoogleNewsArticleUrl, isGoogleNewsHostedThumbnail } from './search-destination.js';
import { publisherIcon, safeHttpUrl, isInvalidImage, normalizeStateUrl, mapWithConcurrency, NormalizedSet } from '../utils/article-utils.js';
import { enhanceArticleResultForSource } from './source-results.js';
import sourceRegistry from '../sources/index.js';
import { cleanStoredCluster, calculateHotness, buildCluster } from '../../smart-news.js';
import { normalizeBlockedKeywordEntries, articleContentFilterMatches } from '../filters/content-filter.js';

export function createArticlePresentation({
    resolveGoogleNewsUrl,
    getLastKnownCachedArticle,
    getLastKnownCachedArticleImage = async url => (await getLastKnownCachedArticle(url))?.image,
    env,
    generateBriefing = generateStoryBriefing,
    topStoriesConfig = {},
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
            const readerImage = /^\/api\/og-image\?/.test(prepared.image || '');
            const currentImage = readerImage ? prepared.image : safeHttpUrl(prepared.image);
            const needsCachedImage = !currentImage
                || isInvalidImage(currentImage)
                || (cameFromGoogleNews && isGoogleNewsHostedThumbnail(currentImage))
                || sourceHandler?.isInvalidFeedImage?.(currentImage) === true;
            if (needsCachedImage && /^https?:\/\/(?:www\.)?(?:voz\.vn|tinhte\.vn)\//i.test(prepared.link)) {
                prepared.image = `/api/og-image?url=${encodeURIComponent(prepared.link)}`;
            } else if (needsCachedImage && safeHttpUrl(prepared.link) && !isGoogleNewsArticleUrl(prepared.link)) {
                const cachedImage = safeHttpUrl(await getLastKnownCachedArticleImage(prepared.link));
                if (cachedImage
                    && !isInvalidImage(cachedImage)
                    && sourceHandler?.isInvalidFeedImage?.(cachedImage) !== true) {
                    prepared.image = cachedImage;
                } else {
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

    const briefings = createStoryBriefings({ db: env?.RSS_DATA, generate: generateBriefing, loadSource: getLastKnownCachedArticle });
    const topIndex = createTopStoriesIndex({ db: env?.RSS_DATA, config: topStoriesConfig });
    const smartApiViewCache = new Map();
    const storyViews = new Map();
    const filteredTopViews = new Map();
    let storyViewSequence = 0;

    let latestSmartApiVersion = '';
    const freshViewCache = new Map();
    const topSnapshots = createTopStoriesSnapshots({ db: env?.RSS_DATA, config: topIndex.settings });

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

    function smartTechRegion(article) {
        const region = String(article?.region || '').toLowerCase();

        if (region === 'vietnam') return 'vietnam';
        if (['foreign', 'world', 'global'].includes(region)) return 'world';

        // Older stored records may not have region populated.
        return /^vi(?:-|$)/i.test(String(article?.language || ''))
            ? 'vietnam'
            : 'world';
    }

    function smartArticleMatchesSection(
        article,
        filterValue,
        smartRegion = 'world'
    ) {
        if (!filterValue) return true;

        if (filterValue === 'news') {
            return ['news_vietnam', 'news_world']
                .includes(article.smartCategory);
        }

        if (filterValue === 'finance') {
            return ['finance_vietnam', 'finance_global']
                .includes(article.smartCategory);
        }

        if (filterValue === 'tech') {
            return (
                article.smartCategory === 'tech' &&
                !isInvestingSmartArticle(article) &&
                smartTechRegion(article) === smartRegion
            );
        }

        return article.smartCategory === filterValue;
    }

    function buildSmartApiView(
        rawClusters,
        filterValue,
        smartRegion = 'world'
    ) {
        const clusters = [];
        for (const storedArticle of rawClusters) {
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

            const clusterArticles = [article, ...(Array.isArray(article.relatedArticles) ? article.relatedArticles : [])];
            const ranking = rankStory(clusterArticles, filterValue);
            clusters.push({ ...article, hotness: ranking.score, sourceCount: ranking.independentSources, ranking });
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
        const timings = Object.fromEntries(['rank-state-read','cluster-reconciliation','relevance-computation','signal-computation','sorting-ranking','top-cutoff','rank-persistence'].map(name=>[name,0])); let phaseAt = performance.now();
        const mark = name => { const t = performance.now(); timings[name] = t-phaseAt; phaseAt=t; };
        mark("request-received");
        const filterValue = req.query.filterValue || '';
        const smartRegion =
            req.query.smartRegion === 'vietnam'
                ? 'vietnam'
                : 'world';
        const smartRegionKey =
            filterValue === 'tech' ? smartRegion : '';
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

        const storedSmartMode =
            userPreferences?.smartTabModes?.__all ||
            userPreferences?.smartTabModes?.[filterValue];

        const smartTabMode =
            ['top', 'classic'].includes(req.query.smartMode)
                ? req.query.smartMode
                : (storedSmartMode === 'classic' ? 'classic' : 'top');
        const isTop = smartTabMode === 'top' && Boolean(filterValue);
        let smartClusterVersion = '', filteredArticles, publishedArticles, cacheHit = false;
        if (isTop) {
            const snapshot = await topSnapshots.get();
            mark('persisted-read');
            cacheHit = Boolean(snapshot);
            publishedArticles = snapshot?.articles;
            smartClusterVersion = snapshot?.clusterVersion || '';
            const destination =
                filterValue === 'tech'
                    ? `tech_${smartRegion}`
                    : filterValue.replace('_global', '_world');
            filteredArticles = (snapshot?.articles || []).filter(a => a.topStory.feed === destination || (['news','finance'].includes(filterValue) && a.topStory.feed.startsWith(filterValue + '_')));
            mark('candidate-collection');
            // Start only after the response is handed to the transport.
            if (res.once) res.once('finish', () => topSnapshots.schedule());
            else topSnapshots.schedule();
        } else {
            const requestedVersion = !isTop && Number(req.query.page || 1) > 1 ? (req.query.smartVersion || '') : '';
            let rawClusters;
            if (requestedVersion && _smartClustersHistory[requestedVersion]) {
                rawClusters = _smartClustersHistory[requestedVersion];
                smartClusterVersion = requestedVersion;
            } else {
                const [finalVersion, progressiveState] = await Promise.all([
                    env.RSS_DATA.get('smartClusterVersion'),
                    requestedVersion ? Promise.resolve(null) : env.RSS_DATA.get('smartProgressiveClusterState', { type: 'json' })
                ]);
                const progressiveVersion = String(progressiveState?.version || '');
                let progressiveActive = Boolean(
                    !requestedVersion &&
                    progressiveState?.active === true &&
                    progressiveState?.provisional === true &&
                    progressiveVersion
                );
                if (progressiveActive) {
                    const publication = await env.RSS_DATA.get('smartProgressivePublication', { type: 'json', shared: true });
                    if (
                        publication?.version === progressiveVersion &&
                        Array.isArray(publication?.clusters)
                    ) {
                        rawClusters = publication.clusters;
                    } else {
                        progressiveActive = false;
                    }
                }
                smartClusterVersion = requestedVersion || (progressiveActive ? progressiveVersion : (finalVersion || ''));
                if (!progressiveActive) {
                    rawClusters = await env.RSS_DATA.get('smartClusters', { type: 'json', shared: true }) || [];
                }
                if (smartClusterVersion) {
                    // Every progressive revision is a complete Smart cluster graph.
                    // Retaining several revisions can pin multiple huge object graphs
                    // in V8 old space even after Smart verification has completed.
                    for (const key of Object.keys(_smartClustersHistory)) {
                        if (
                            /_progressive_/.test(String(key)) &&
                            key !== smartClusterVersion
                        ) {
                            delete _smartClustersHistory[key];
                        }
                    }

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
                latestSmartApiVersion = smartClusterVersion;
            }

            mark("persisted-read");
            const cacheKey =
                `${smartClusterVersion}:${filterValue}:${smartRegionKey}:${Math.floor(Date.now() / 60000)}`;
            filteredArticles = smartApiViewCache.get(cacheKey);
            cacheHit = Boolean(filteredArticles);
            if (!filteredArticles) {
                filteredArticles = buildSmartApiView(
                    rawClusters,
                    filterValue,
                    smartRegion
                );
                smartApiViewCache.set(cacheKey, filteredArticles);
                while (smartApiViewCache.size > 7) smartApiViewCache.delete(smartApiViewCache.keys().next().value);
            }

            // Fresh headlines must remain visible while embeddings and AI grouping run.
            // Preserve grouped stories and add only articles absent from that snapshot.
            const rawArticles = await env.RSS_DATA.get('smartRawArticles', { type: 'json', shared: true }) || [];
            const freshKey =
                `${smartClusterVersion}:${filterValue}:${smartRegionKey}:${Math.floor(Date.now() / 60000)}`;
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
                const cutoff = Date.now() - 24 * 60 * 60 * 1000;
                const recent = article => Number(new Date(article.pubDate || 0).getTime() > cutoff);
                articles.sort((a, b) => recent(b) - recent(a) || (b.hotness || 0) - (a.hotness || 0)
                    || new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
                freshView = { raw: rawArticles, clusters: rawClusters, articles };
                freshViewCache.set(freshKey, freshView);
                while (freshViewCache.size > 7) freshViewCache.delete(freshViewCache.keys().next().value);
            }
            filteredArticles = freshView.articles;
            mark("candidate-collection");
        }
        mark('ranking-total');
        const readSet = new NormalizedSet(readStates || []);
        const hiddenSet = new NormalizedSet(hiddenStates || []);
        const unavailableSet = new NormalizedSet(unavailableSourceUrls || []);
        const blockedKeywordEntries = normalizeBlockedKeywordEntries(blockedKeywords || []);
        const matchesSearch = value => String(value || '').toLowerCase().includes(searchQuery);

        const filterSignature = JSON.stringify([
            filterValue,
            smartRegionKey,
            hideRead,
            searchQuery,
            hiddenStates,
            hideRead ? readStates : [],
            blockedKeywords,
            unavailableSourceUrls
        ]);
        const cachedFiltered = isTop && filteredTopViews.get(filterSignature);
        if (cachedFiltered && cachedFiltered.input === publishedArticles) filteredArticles = cachedFiltered.articles;
        else {
            const needsMemberFiltering = !isTop || hiddenSet.size > 0 || blockedKeywordEntries.length > 0 || unavailableSet.size > 0;
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

            filteredArticles = filteredArticles.map(article => ({ ...article,
                relatedArticles: (article.relatedArticles || []).filter(a => !hiddenSet.has(a.link) && !articleContentFilterMatches(a, blockedKeywordEntries))
            }));
            if (isTop) {
                filteredTopViews.set(filterSignature, {input:publishedArticles,articles:filteredArticles});
                while (filteredTopViews.size > 12) filteredTopViews.delete(filteredTopViews.keys().next().value);
            }
        }
        // Classic retains its existing ranking. Top Stories is fully scored above.
        const ranked = isTop ? filteredArticles : (await mapWithConcurrency(filteredArticles, 8, async article => {
            const ranking = rankStory(storyMembers(article), filterValue, Date.now(), await briefings.peek(article, filterValue));
            return { ...article, ranking, hotness: ranking.score, sourceCount: ranking.independentSources };
        })).sort((a,b) => b.hotness - a.hotness || b.ranking.updatedAt.localeCompare(a.ranking.updatedAt) || a.link.localeCompare(b.link));
        mark("filtering");
        const viewSignature = JSON.stringify([
            filterValue,
            smartTabMode,
            filterValue === 'tech' ? smartRegion : null,
            hideRead,
            searchQuery,
            hiddenStates,
            hideRead ? readStates : [],
            blockedKeywords
        ]);
        const priorView = storyViews.get(req.query.smartView);
        const reusableView = priorView && priorView.signature === viewSignature && Date.now() - priorView.createdAt < 30 * 60000;
        let smartViewToken = req.query.smartView;
        filteredArticles = reusableView ? priorView.articles : ranked;
        if (!reusableView) {
            smartViewToken = `${Date.now()}-${++storyViewSequence}`;
            storyViews.set(smartViewToken, { signature: viewSignature, articles: filteredArticles, createdAt: Date.now() });
            while (storyViews.size > 8) storyViews.delete(storyViews.keys().next().value);
        }
        const viewReset = Boolean(req.query.smartView && !reusableView);
        const page = viewReset ? 1 : Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 40));
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const currentById = new Map(ranked.map(a => [a.clusterId, a]));
        const currentStory = article => isTop ? currentById.get(article.clusterId) || article : article;
        const pageArticles = filteredArticles.slice(startIndex, endIndex);

        // Briefing generation has a separate notion of the ACTIVE page.
        // Ranking order remains pinned by smartViewToken; this key identifies
        // what the reader is actually viewing right now.
        const briefingViewKey =
            isTop && filterValue
                ? [
                    smartViewToken || 'view',
                    filterValue,
                    req.query.smartRegion || '',
                    `page:${page}`
                ].join(':')
                : null;

        // null when leaving Top Stories, so the previous page
        // immediately loses its active-view priority boost.
        briefings.setActiveView(briefingViewKey);
        mark("snapshot-construction");
        const rankingPending = Boolean(isTop && topSnapshots.pending);
        if (isTop && filterValue) {
            const ahead = filteredArticles.slice(startIndex, endIndex + topIndex.settings.batchSize * topIndex.settings.lookAheadBatches);
            const enqueue = () => {
                const timer = setTimeout(async () => {
                    try {
                        for (let i = 0; i < ahead.length; i++) {
                            await briefings.get(
                                currentStory(ahead[i]),
                                ahead[i].topStory.feed,
                                {
                                    priority:
                                        i < pageArticles.length
                                            ? 2
                                            : 0,
                                    viewKey: briefingViewKey
                                }
                            );
                        }
                    }
                    catch (error) { console.warn('[TOP STORIES] Background briefing queue:', error.message); }
                }, 25);
                timer.unref?.();
            };
            if (res.once) res.once('finish', enqueue); else enqueue();
        }
        const updatesAvailable = Boolean(isTop && reusableView && JSON.stringify(ranked.map(a => [a.clusterId, a.topStory.material_version, a.topStory.isTop])) !== JSON.stringify(priorView.articles.map(a => [a.clusterId, a.topStory.material_version, a.topStory.isTop])));
        const paginatedArticles = await mapWithConcurrency(pageArticles, 6, async article => {
            const current = currentStory(article);
            // A completed story update can replace its card atomically without
            // changing the reader's pinned order or Top/More boundary.
            const display = isTop ? {...current, topStory:{...current.topStory,
                rank:article.topStory.rank,isTop:article.topStory.isTop,cutoff:article.topStory.cutoff}} : article;
            return {
                ...await prepareArticleForClient(display),
                ...(isTop ? {title:display.title,topStory:display.topStory} : {}),
                ...(filterValue ? {briefing:await briefings.get(current, isTop ? current.topStory.feed : filterValue, {generate:false,priority:2})} : {})
            };
        });
        mark('card-preparation');
        res.setHeader('Server-Timing', Object.entries(timings).map(([name,ms])=>`${name};dur=${ms.toFixed(3)}`).join(', '));
        res.setHeader('X-Smart-View-Cache', cacheHit ? 'hit' : 'miss');
        const payload = {
            feeds: feeds || [],
            articles: paginatedArticles,
            topStories: [],
            smartTabMode,
            rankingPending,
            updatesAvailable,
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
        if (!isTop) { res.setHeader('Server-Timing', `smart-data;dur=${Date.now()-startedAt}`); return res.json(payload); }
        const serialized = JSON.stringify(payload); mark("serialization");
        res.setHeader("Server-Timing", Object.entries(timings).map(([name,ms])=>`${name};dur=${ms.toFixed(3)}`).join(", "));
        if (res.send) res.type("json").send(serialized); else res.json(payload);
        mark("response-sent");
        if (process.env.SMART_REFRESH_PROFILE) console.info("[SMART REFRESH]", JSON.stringify(timings));
    }

    return {
        markUnavailableSourceUrl,
        serveSmartData,
        get _smartClustersHistory() { return _smartClustersHistory; },
        prepareArticleForClient,
        clearUnavailableSourceUrl
    };
}
