import { cleanStoredCluster } from '../smart/clustering/cluster.js';
import { normalizeBlockedKeywordEntries, articleContentFilterMatches } from '../filters/content-filter.js';
import { isRedditUrl } from '../utils/article-utils.js';

// Pure selection shared by the public prefetch API and atomic RSS publication.
export function selectUniversalPrefetchTargets(articles, smartClustersRaw, blockedKeywords, now = Date.now()) {
    const blockedKeywordEntries = normalizeBlockedKeywordEntries(blockedKeywords);
    const articleIsBlocked = article => articleContentFilterMatches(article, blockedKeywordEntries);
    const safeDate = dateVal => { try { const d = new Date(dateVal); return isNaN(d.getTime()) ? 0 : d.getTime(); } catch(e) { return 0; } };
    const smartClusters = smartClustersRaw.map(c => cleanStoredCluster(c)).filter(a => a && !articleIsBlocked(a));
    const activeArticles = articles.filter(a => a && !articleIsBlocked(a));

    const topArticlesMap = new Map();
    const addTopFive = (list) => {
        if (!Array.isArray(list)) return;
        for (let i = 0; i < Math.min(5, list.length); i++) {
            const art = list[i];
            if (!art) continue;
            const url = art.link || art.originalLink;
            if (url && !isRedditUrl(url) && !topArticlesMap.has(url)) {
                topArticlesMap.set(url, { url, title: art.title, originalLink: art.originalLink, link: art.link });
            }
        }
    };

    // 1. Smart tabs top 5 each
    const smartCategories = ['news_vietnam', 'news_global', 'finance_vietnam', 'finance_global', 'tech'];
    for (const cat of smartCategories) {
        const catArticles = smartClusters.filter(a => {
            if (cat === 'news_vietnam' || cat === 'news_global') return ['news_vietnam', 'news_global'].includes(a.smartCategory) && (cat === 'news_vietnam' ? a.smartCategory === 'news_vietnam' : a.smartCategory === 'news_global');
            if (cat === 'finance_vietnam' || cat === 'finance_global') return ['finance_vietnam', 'finance_global'].includes(a.smartCategory) && (cat === 'finance_vietnam' ? a.smartCategory === 'finance_vietnam' : a.smartCategory === 'finance_global');
            return a.smartCategory === cat;
        }).sort((a, b) =>
            (b.hotness || 0) - (a.hotness || 0) ||
            (b.sourceWeight || 1) - (a.sourceWeight || 1) ||
            (new Date(b.pubDate || 0).getTime()) - (new Date(a.pubDate || 0).getTime())
        );
        addTopFive(catArticles);
    }

    // 2. Standard main tabs top 5 each
    const todaySorted = [...activeArticles].sort((a, b) => (new Date(b.pubDate || 0).getTime()) - (new Date(a.pubDate || 0).getTime()));
    addTopFive(todaySorted);

    const hotToday = activeArticles.filter(a => safeDate(a.pubDate) > now - 24 * 60 * 60 * 1000)
        .sort((a, b) => ((b.views || 0) + (b.clicks || 0) * 3) - ((a.views || 0) + (a.clicks || 0) * 3));
    addTopFive(hotToday);

    const hotWeek = activeArticles.filter(a => safeDate(a.pubDate) > now - 7 * 24 * 60 * 60 * 1000)
        .sort((a, b) => ((b.views || 0) + (b.clicks || 0) * 3) - ((a.views || 0) + (a.clicks || 0) * 3));
    addTopFive(hotWeek);

    const viewsToday = [...activeArticles].filter(a => safeDate(a.pubDate) > now - 24 * 60 * 60 * 1000)
        .sort((a, b) => (b.views || 0) - (a.views || 0));
    addTopFive(viewsToday);

    // 3. Every Category tab top 5 each
    const allCategories = new Set(activeArticles.map(a => a.category).filter(Boolean));
    for (const catName of allCategories) {
        const catList = activeArticles.filter(a => a.category === catName)
            .sort((a, b) => (new Date(b.pubDate || 0).getTime()) - (new Date(a.pubDate || 0).getTime()));
        addTopFive(catList);
    }

    const toProcess = Array.from(topArticlesMap.values());
    return toProcess;
}
