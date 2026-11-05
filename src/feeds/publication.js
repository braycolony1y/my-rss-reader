import { normalizeStateUrl } from '../utils/article-utils.js';

// Called inside the database updater, after fetches finish. Current user state
// and feed membership, rather than the opening snapshot, own the publication.
export function reconcileFeedPublication(current, newArticles, feeds) {
    const currentFeeds = current.feeds || [];
    const feedsByUrl = new Map(currentFeeds.map(feed => [typeof feed === 'string' ? feed : feed.url, feed]));
    const inferred = new Map(feeds.map(feed => [feed.url, feed]));
    const feedTitle = (feed, fresh) => !feed.title || feed.title === new URL(feed.url).hostname || feed.title.startsWith('http')
        ? fresh?.title || feed.title : feed.title;
    const existingByLink = new Map((current.articles || []).map(article => [article.link, article]));
    const admitted = newArticles.filter(article => feedsByUrl.has(article.feedUrl)).map(article => {
        const feed = feedsByUrl.get(article.feedUrl);
        const fresh = inferred.get(article.feedUrl);
        return { ...existingByLink.get(article.link), ...article,
            ...(typeof feed === 'object' ? {feedTitle: article.feedTitle === fresh?.title
                ? feedTitle(feed, fresh) || article.feedTitle : article.feedTitle,
                feedCategory: feed.category || 'Others'} : {}) };
    });
    let allArticles = [...admitted, ...(current.articles || [])];

    for (let article of allArticles) {
        if (!article.image) {
            article.image = `/api/og-image?url=${encodeURIComponent(article.link.replace(/\/unread\/?$/, ''))}&rss=${encodeURIComponent(article.rssFallbackMap || '')}&icon=${encodeURIComponent(article.feedIcon)}`;
        }
        delete article.rssFallbackMap;
    }

    for (let i = 0; i < allArticles.length; i++) {
        allArticles[i]._ts = new Date(allArticles[i].pubDate).getTime() || 0;
    }
    allArticles.sort((a, b) => b._ts - a._ts);

    const uniqueArticles = [];
    const linkMap = new Map();
    const titleMap = new Map();
    const guidMap = new Map();
    for (const article of allArticles) {
        const titleKey = `${article.feedUrl}|${article.guid || article.title.toLowerCase()}`;
        const guidKey = article.guid ? `${article.feedUrl}|${article.guid}` : null;
        if (!linkMap.has(article.link) && !titleMap.has(titleKey) && !(guidKey && guidMap.has(guidKey))) {
            if (guidKey) guidMap.set(guidKey, article);
            linkMap.set(article.link, article);
            titleMap.set(titleKey, article);
            delete article._ts;
            uniqueArticles.push(article);
        } else {
            // Keep the maximum view/reply count and createDate even if we skip the duplicate
            const existing = (guidKey && guidMap.get(guidKey)) || linkMap.get(article.link) || titleMap.get(titleKey);
            if (existing) {
                if (article.replyCount > (existing.replyCount || 0)) existing.replyCount = article.replyCount;
                if (article.viewCount > (existing.viewCount || 0)) existing.viewCount = article.viewCount;
                if (article.createDate && !existing.createDate) existing.createDate = article.createDate;
            }
        }
    }

    const MAX_PER_SOURCE = 200;
    const feedCounts = {};
    const savedStatesForPruning = current.savedStates || [];
    const boardStatesForPruning = current.boardStates || [];
    const readStatesForPruning = current.readStates || [];
    const archivedUrlsForPruning = new Set(
        [...savedStatesForPruning, ...boardStatesForPruning].map(normalizeStateUrl).filter(Boolean)
    );
    const readUrlsForPruning = new Set(readStatesForPruning.map(normalizeStateUrl).filter(Boolean));

    const latestArticles = uniqueArticles.filter(article => {
        const normalizedLink = normalizeStateUrl(article.link);
        if (archivedUrlsForPruning.has(normalizedLink)) return true;
        if (readUrlsForPruning.has(normalizedLink)) {
            const ageMs = Date.now() - (new Date(article.pubDate || 0).getTime() || 0);
            if (ageMs < 7 * 24 * 60 * 60 * 1000) return true;
        }
        const sourceUrl = article.feedUrl;
        if (!feedCounts[sourceUrl]) feedCounts[sourceUrl] = 0;
        if (feedCounts[sourceUrl] < MAX_PER_SOURCE) {
            feedCounts[sourceUrl]++;
            return true;
        }
        return false;
    });

    const pendingDatabaseUpdates = {
        articles: JSON.stringify(latestArticles)
    };
    // State lists tied to the live feed should not retain links after the
    // article itself is rotated out. Read Later and Boards are intentional
    // archives, so they are deliberately never pruned here.
    try {
        const smartClusters = current.smartClusters || [];
        const smartRawArticles = current.smartRawArticles || [];
        const retainedLinks = new Set(latestArticles.map(article => normalizeStateUrl(article.link)));

        for (const article of smartRawArticles) {
            if (article.link) retainedLinks.add(normalizeStateUrl(article.link));
        }

        for (const cluster of smartClusters) {
            if (cluster.link) retainedLinks.add(normalizeStateUrl(cluster.link));
            for (const related of cluster.relatedArticles || []) {
                if (related.link) retainedLinks.add(normalizeStateUrl(related.link));
            }
        }
        for (const listName of ['readStates', 'hiddenStates']) {
            const state = current[listName] || [];
            const pruned = state.filter(link => retainedLinks.has(normalizeStateUrl(link)));
            if (pruned.length !== state.length) pendingDatabaseUpdates[listName] = JSON.stringify(pruned);
        }
    } catch (error) {
        console.error('[STATE CLEANUP] Could not prune stale feed state:', error.message);
    }
    const updatedFeeds = currentFeeds.map(value => {
        const feed = typeof value === 'string' ? {url: value} : value;
        const fresh = inferred.get(feed.url);
        if (!fresh) return value;
        const title = feedTitle(feed, fresh);
        return {...feed, title, icon: feed.icon || fresh.icon, category: feed.category || 'Others'};
    });
    if (JSON.stringify(updatedFeeds) !== JSON.stringify(currentFeeds)) pendingDatabaseUpdates.feeds = JSON.stringify(updatedFeeds);
    return {changes: pendingDatabaseUpdates, articles: latestArticles};
}
