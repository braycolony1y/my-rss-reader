import { canonicalIdentity } from '../board/thread-model.js';
import { authMiddleware } from '../middleware/auth.js';
import { normalizeBlockedKeywordEntries, articleContentFilterMatches } from '../filters/content-filter.js';
import { NormalizedSet, NormalizedMap, mapWithConcurrency } from '../utils/article-utils.js';
import { cleanStoredCluster, calculateHotness } from '../../smart-news.js';

export function registerDataRoutes({
    app,
    serveSmartData,
    env,
    prepareArticleForClient,
    presentation,
    progress = { activeForegroundRequests: 0 },
} = {}) {
    let visibleSnapshot;
    let visibleKeywordSignature;
    let visibleSnapshotArticles;
    app.get('/api/data', authMiddleware, async (req, res) => {
        progress.activeForegroundRequests++;
        try {
        const startedAt = performance.now();
        const filterType = req.query.filterType || 'today';
        if (filterType === 'smart') return await serveSmartData(req, res);

        let feeds = await env.RSS_DATA.get('feeds', { type: 'json' }) || [];
        // This route treats the article snapshot as immutable and derives new
        // filtered arrays from it, so avoid cloning the full multi-megabyte list
        // on every tab click.
        let allArticles = await env.RSS_DATA.get('articles', { type: 'json', shared: true }) || [];
        const readStates = await env.RSS_DATA.get('readStates', { type: 'json' }) || [];
        const savedStates = await env.RSS_DATA.get('savedStates', { type: 'json' }) || [];
        const boardStates = await env.RSS_DATA.get('boardStates', { type: 'json' }) || [];
        const hiddenStates = await env.RSS_DATA.get('hiddenStates', { type: 'json' }) || [];
        const categoryOrder = await env.RSS_DATA.get('categoryOrder', { type: 'json' }) || [];
        const userPreferences = await env.RSS_DATA.get('userPreferences', { type: 'json' }) || {};

        const blockedKeywords = await env.RSS_DATA.get('blockedArticleKeywords', { type: 'json' }) || [];
        const loadedAt = performance.now();
        const blockedKeywordEntries = normalizeBlockedKeywordEntries(blockedKeywords);
        const articleIsBlocked = article => articleContentFilterMatches(article, blockedKeywordEntries);
        // The database replaces immutable article snapshots on updates. Reuse
        // keyword filtering across tab clicks, but refresh on either input change.
        const keywordSignature = JSON.stringify(blockedKeywordEntries);
        if (visibleSnapshot !== allArticles || visibleKeywordSignature !== keywordSignature) {
            visibleSnapshotArticles = allArticles.filter(article => !articleIsBlocked(article));
            visibleSnapshot = allArticles;
            visibleKeywordSignature = keywordSignature;
        }
        const visibleArticles = visibleSnapshotArticles;

        const readSet = new NormalizedSet(readStates);
        const savedSet = new NormalizedSet(savedStates);
        const boardSet = new NormalizedSet(boardStates);
        const hiddenSet = new NormalizedSet(hiddenStates);

        const readIndex = new NormalizedMap(readStates.map((link, i) => [link, i]));
        const savedIndex = new NormalizedMap(savedStates.map((link, i) => [link, i]));
        const boardIndex = new NormalizedMap(boardStates.map((link, i) => [link, i]));
        const hiddenIndex = new NormalizedMap(hiddenStates.map((link, i) => [link, i]));

        const unreadCounts = { feeds: {}, categories: {}, total: 0 };
        visibleArticles.forEach(a => {
            if (!readSet.has(a.link) && !hiddenSet.has(a.link)) {
                unreadCounts.total++;
                unreadCounts.feeds[a.feedUrl] = (unreadCounts.feeds[a.feedUrl] || 0) + 1;
                let cat = a.feedCategory || 'Others';
                unreadCounts.categories[cat] = (unreadCounts.categories[cat] || 0) + 1;
            }
        });

        const filterValue = req.query.filterValue || '';
        const hideRead = req.query.hideRead === 'true';
        const searchQuery = req.query.searchQuery ? req.query.searchQuery.toLowerCase() : '';

        let filteredArticles = visibleArticles;

        let smartClusterVersion = await env.RSS_DATA.get('smartClusterVersion') || '';
        if (filterType === 'smart') {
            const requestedVersion = req.query.smartVersion || '';
            let smartClusters = [];
            if (requestedVersion && presentation._smartClustersHistory[requestedVersion]) {
                smartClusters = presentation._smartClustersHistory[requestedVersion];
                smartClusterVersion = requestedVersion;
            } else {
                smartClusters = await env.RSS_DATA.get('smartClusters', { type: 'json' }) || [];
                smartClusters = smartClusters.map(article => cleanStoredCluster(article));
                if (smartClusterVersion) {
                    presentation._smartClustersHistory[smartClusterVersion] = smartClusters;
                    const historyKeys = Object.keys(presentation._smartClustersHistory);
                    if (historyKeys.length > 6) delete presentation._smartClustersHistory[historyKeys[0]];
                }
            }
            filteredArticles = smartClusters
                .map(article => {
                    const cleaned = cleanStoredCluster(article);
                    // Recalculate hotness live using the current formula
                    const allArticles = [cleaned, ...(Array.isArray(cleaned.relatedArticles) ? cleaned.relatedArticles : [])];
                    cleaned.hotness = calculateHotness(allArticles);
                    return cleaned;
                })
                .filter(article => !hiddenSet.has(article.link) && !articleIsBlocked(article));
            if (filterValue === 'news') {
                filteredArticles = filteredArticles.filter(article => ['news_vietnam', 'news_world'].includes(article.smartCategory));
            } else if (filterValue === 'finance') {
                filteredArticles = filteredArticles.filter(article => ['finance_vietnam', 'finance_global'].includes(article.smartCategory));
            } else if (filterValue === 'tech') {
                const isInvestingCom = (art) => {
                    if (!art) return false;
                    const text = [art.link, art.feedUrl, art.url, art.feedTitle, art.sourceName, art.source, ...(Array.isArray(art.sources) ? art.sources : [])]
                        .filter(Boolean)
                        .join(' ')
                        .toLowerCase();
                    return text.includes('investing.com');
                };
                filteredArticles = filteredArticles
                    .filter(article => article.smartCategory === 'tech' && !isInvestingCom(article))
                    .map(article => {
                        if (!Array.isArray(article.relatedArticles) || !article.relatedArticles.length) return article;
                        const cleanRelated = article.relatedArticles.filter(r => !isInvestingCom(r));
                        if (cleanRelated.length === article.relatedArticles.length) return article;
                        const sources = [...new Set([article.feedTitle, ...cleanRelated.map(r => r.feedTitle)].filter(Boolean))];
                        return {
                            ...article,
                            relatedArticles: cleanRelated,
                            clusterCount: cleanRelated.length + 1,
                            sourceCount: sources.length,
                            sources
                        };
                    });
            } else if (filterValue) {
                filteredArticles = filteredArticles.filter(article => article.smartCategory === filterValue);
            }
            if (hideRead) {
                filteredArticles = filteredArticles.filter(article => !readSet.has(article.link)).map(article => {
                    if (!article.relatedArticles || !article.relatedArticles.length) return article;
                    const unreadRelated = article.relatedArticles.filter(r => !readSet.has(r.link));
                    if (unreadRelated.length === article.relatedArticles.length) return article;
                    const sources = [...new Set([article.feedTitle, ...unreadRelated.map(r => r.feedTitle)].filter(Boolean))];
                    return {
                        ...article,
                        relatedArticles: unreadRelated,
                        clusterCount: unreadRelated.length + 1,
                        sourceCount: sources.length,
                        sources
                    };
                });
            }
            filteredArticles.sort((a, b) =>
                (b.hotness || 0) - (a.hotness || 0) ||
                (b.sourceWeight || 1) - (a.sourceWeight || 1) ||
                (new Date(b.pubDate || 0).getTime()) - (new Date(a.pubDate || 0).getTime())
            );
        } else if (filterType === 'hidden') {
            filteredArticles = filteredArticles.filter(a => hiddenSet.has(a.link))
                .sort((a, b) => hiddenIndex.get(b.link) - hiddenIndex.get(a.link));
        } else {
            if (['recent', 'saved', 'board'].includes(filterType)) {
                const smartClustersRaw = await env.RSS_DATA.get('smartClusters', { type: 'json' }) || [];
                const smartArticles = smartClustersRaw.map(c => cleanStoredCluster(c)).filter(a => a && !articleIsBlocked(a));

                const linkMap = new Map();
                filteredArticles.forEach(a => linkMap.set(a.link, a));

                const smartRawArticles = await env.RSS_DATA.get('smartRawArticles', { type: 'json' }) || [];
                smartRawArticles.forEach(a => {
                    if (!articleIsBlocked(a)) linkMap.set(a.link, a);
                });

                smartArticles.forEach(a => linkMap.set(a.link, a));
                if (filterType === 'board') {
                    const members = await env.RSS_DATA.get('cacheMembers', { type: 'json' }) || {};
                    for (const member of Object.values(members)) if (member.in_cache) {
                        const article = { ...(linkMap.get(member.url) || member.article), link: member.url, active_caching: member.active_caching, auto_added: member.auto_added };
                        linkMap.set(member.url, article);
                    }
                }
                filteredArticles = Array.from(linkMap.values());
            }

            filteredArticles = filteredArticles.filter(a => !hiddenSet.has(a.link));
            if (filterType === 'recent') {
                const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
                filteredArticles = filteredArticles
                    .filter(a => readSet.has(a.link) && (new Date(a.pubDate || 0).getTime() > oneWeekAgo))
                    .sort((a, b) => readIndex.get(b.link) - readIndex.get(a.link));
            } else if (filterType === 'saved') {
                filteredArticles = filteredArticles.filter(a => savedSet.has(a.link));
                if (hideRead) filteredArticles = filteredArticles.filter(a => !readSet.has(a.link));
                filteredArticles.sort((a, b) => savedIndex.get(b.link) - savedIndex.get(a.link));
            } else if (filterType === 'board') {
                filteredArticles = deduplicateBoardArticles(filteredArticles.filter(a => boardSet.has(a.link)));
                if (filterValue) {
                    const mappings = userPreferences.boardFolderMappings || {};
                    const folders = new Map(Object.entries(mappings).map(([url, folder]) => [canonicalIdentity(url), folder]));
                    filteredArticles = filteredArticles.filter(a => folders.get(canonicalIdentity(a)) === filterValue);
                }
                if (hideRead) filteredArticles = filteredArticles.filter(a => !readSet.has(a.link));
                filteredArticles.sort((a, b) => boardIndex.get(b.link) - boardIndex.get(a.link));
            } else if (filterType === 'category') {
                filteredArticles = filteredArticles.filter(a => a.feedCategory === filterValue || (filterValue === 'Others' && !a.feedCategory));
            } else if (filterType === 'feed') {
                filteredArticles = filteredArticles.filter(a => a.feedUrl === filterValue);
            } else if (filterType === 'hot_today' || filterType === 'hot_week' || filterType === 'views_today' || filterType === 'views_week') {
                // Use Vietnam timezone (UTC+7) for date comparison since Voz is a Vietnamese forum
                const VN_OFFSET = 7 * 60 * 60 * 1000;
                const nowVN = new Date(Date.now() + VN_OFFSET);

                const isTodayVN = (dateStr) => {
                    if (!dateStr) return false;
                    const d = new Date(new Date(dateStr).getTime() + VN_OFFSET);
                    return d.getUTCDate() === nowVN.getUTCDate() && d.getUTCMonth() === nowVN.getUTCMonth() && d.getUTCFullYear() === nowVN.getUTCFullYear();
                };
                const isThisWeekVN = (dateStr) => {
                    if (!dateStr) return false;
                    const d = new Date(dateStr);
                    return (Date.now() - d.getTime()) <= 7 * 24 * 60 * 60 * 1000;
                };

                const isTimeMatch = (filterType.includes('today')) ? isTodayVN : isThisWeekVN;

                // Sort by the relevant stat
                const sortFn = filterType.includes('views')
                    ? (a, b) => (b.viewCount || 0) - (a.viewCount || 0) || (b.replyCount || 0) - (a.replyCount || 0)
                    : (a, b) => (b.replyCount || 0) - (a.replyCount || 0) || (b.viewCount || 0) - (a.viewCount || 0);

                // O(1) lookup sets for hidden/sticky exclusion
                const stickyIds = new Set(['.1216621/', '.641432/', '.617079/']);
                const isStickyLink = (link) => { for (const id of stickyIds) if (link.includes(id)) return true; return false; };

                // Pre-filter articles by forum once (avoids scanning all 1500+ articles twice)
                const diemBaoPool = [];
                const chuyenTroPool = [];
                for (const a of allArticles) {
                    if (!a.feedUrl || hiddenSet.has(a.link) || isStickyLink(a.link)) continue;
                    if (a.feedUrl.includes('diem-bao.33')) diemBaoPool.push(a);
                    else if (a.feedUrl.includes('chuyen-tro-linh-tinh-tm.17')) chuyenTroPool.push(a);
                }

                // Helper to guarantee exactly 5 articles from a pre-filtered pool
                const getTop5 = (pool) => {
                    // Tier 1: Strict match for requested time window (Today or This Week)
                    let tier1 = pool.filter(a => a.createDate && isTimeMatch(a.createDate));
                    tier1.sort(sortFn);
                    if (tier1.length >= 5) return tier1.slice(0, 5);

                    // Tier 2 Fallback: Match This Week
                    let chosenLinks = new Set(tier1.map(a => a.link));
                    let tier2 = pool.filter(a => !chosenLinks.has(a.link) && (!a.createDate || isThisWeekVN(a.createDate)));
                    tier2.sort(sortFn);
                    let combined = [...tier1, ...tier2];
                    if (combined.length >= 5) return combined.slice(0, 5);

                    // Tier 3 Guaranteed Fill: Take ANY available non-sticky threads to guarantee 5 slots
                    chosenLinks = new Set(combined.map(a => a.link));
                    let tier3 = pool.filter(a => !chosenLinks.has(a.link));
                    tier3.sort(sortFn);
                    return [...combined, ...tier3].slice(0, 5);
                };

                filteredArticles = [...getTop5(diemBaoPool), ...getTop5(chuyenTroPool)];
                filteredArticles.sort(sortFn);
            }

            if (hideRead && filterType !== 'recent' && !filterType.startsWith('hot_') && !filterType.startsWith('views_')) {
                filteredArticles = filteredArticles.filter(a => !readSet.has(a.link));
            }
        }

        if (searchQuery) {
            const matchesSearch = value => String(value || '').toLowerCase().includes(searchQuery);
            filteredArticles = filteredArticles.filter(a =>
                matchesSearch(a.title) ||
                matchesSearch(a.feedTitle) ||
                matchesSearch(a.content) ||
                (filterType === 'smart' && Array.isArray(a.relatedArticles) && a.relatedArticles.some(related =>
                    matchesSearch(related.title) || matchesSearch(related.feedTitle)
                ))
            );
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 40;
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;

        const hasMore = endIndex < filteredArticles.length;
        const filteredAt = performance.now();
        const paginatedArticles = await mapWithConcurrency(filteredArticles.slice(startIndex, endIndex), 6, prepareArticleForClient);

        res.setHeader?.('Server-Timing', `data;dur=${(loadedAt - startedAt).toFixed(1)}, filter;dur=${(filteredAt - loadedAt).toFixed(1)}, cards;dur=${(performance.now() - filteredAt).toFixed(1)}`);
        res.json({
            feeds,
            articles: paginatedArticles,
            readStates,
            savedStates,
            boardStates,
            hiddenStates,
            categoryOrder,
            userPreferences,
            hasMore,
            currentPage: page,
            unreadCounts,
            smartClusterVersion
        });
        } finally {
            progress.activeForegroundRequests = Math.max(0, progress.activeForegroundRequests - 1);
        }
    });

}

export function deduplicateBoardArticles(articles) {
    const unique = new Map();
    for (const article of articles) {
        let id; try { id = canonicalIdentity(article); } catch { id = article.link; }
        const previous = unique.get(id);
        if (!previous || (!previous.image && article.image)) unique.set(id, article);
    }
    return [...unique.values()];
}
