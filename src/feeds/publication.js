import { applyGoogleNewsDestinations } from '../articles/google-news-repair.js';
import { googleNewsArticleId } from '../articles/google-news-decode.js';
import { NormalizedSet, hasArticleState, normalizeStateUrl } from '../utils/article-utils.js';

// Called inside the database updater, after fetches finish. Current user state
// and feed membership, rather than the opening snapshot, own the publication.
export function reconcileFeedPublication(current, newArticles, feeds) {
    const currentFeeds = current.feeds || [];
    const feedsByUrl = new Map(currentFeeds.map(feed => [typeof feed === 'string' ? feed : feed.url, feed]));
    const inferred = new Map(feeds.map(feed => [feed.url, feed]));
    const feedTitle = (feed, fresh) => !feed.title || feed.title === new URL(feed.url).hostname || feed.title.startsWith('http')
        ? fresh?.title || feed.title : feed.title;
    const existing = current.articles || [];
    const incoming = newArticles.filter(article => feedsByUrl.has(article.feedUrl));
    const existingByLink = new Map(existing.map(article => [article.link, article]));
    const decodedByWrapper = new Map();
    const decodedByGuid = new Map();
    const guidKeyFor = article => article.guid ? `${article.feedUrl}|${article.guid}` : null;
    for (const article of [...incoming, ...existing]) {
        if (!article.originalLink || !article.originalLink.includes('news.google.com/') ||
            !googleNewsArticleId(article.originalLink) || googleNewsArticleId(article.link)) continue;
        decodedByWrapper.set(normalizeStateUrl(article.originalLink), article);
        const guid = guidKeyFor(article);
        if (guid) decodedByGuid.set(guid, article);
    }
    const keepDecodedLink = article => {
        if (!article.link.includes('news.google.com/') || !googleNewsArticleId(article.link)) return article;
        const guidMatch = decodedByGuid.get(guidKeyFor(article));
        const previous = guidMatch || decodedByWrapper.get(normalizeStateUrl(article.link));
        if (!previous) return article;
        const repaired = { ...article };
        if (!applyGoogleNewsDestinations(repaired, {
            [article.link]: { resolvedUrl: previous.link, source: previous.googleNewsDecodeSource }
        }, { recursive: false })) return guidMatch || article;
        repaired.originalLink = previous.originalLink;
        return repaired;
    };
    const admitted = incoming.map(keepDecodedLink).map(article => {
        const feed = feedsByUrl.get(article.feedUrl);
        const fresh = inferred.get(article.feedUrl);
        return { ...existingByLink.get(article.link), ...article,
            ...(typeof feed === 'object' ? {feedTitle: article.feedTitle === fresh?.title
                ? feedTitle(feed, fresh) || article.feedTitle : article.feedTitle,
                feedCategory: feed.category || 'Others'} : {}) };
    });
    const allArticles = [...admitted, ...existing.map(keepDecodedLink)];

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
        const guidKey = guidKeyFor(article);
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
    const archivedUrlsForPruning = new NormalizedSet([...savedStatesForPruning, ...boardStatesForPruning]);
    const readUrlsForPruning = new NormalizedSet(readStatesForPruning);

    const latestArticles = uniqueArticles.filter(article => {
        if (hasArticleState(archivedUrlsForPruning, article)) return true;
        if (hasArticleState(readUrlsForPruning, article)) {
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
        const retainedLinks = new Set();
        const retainArticle = article => {
            if (article.link) retainedLinks.add(normalizeStateUrl(article.link));
            if (article.originalLink && article.originalLink !== article.link) retainedLinks.add(normalizeStateUrl(article.originalLink));
            for (const member of article.relatedArticles || []) retainArticle(member);
        };
        for (const articles of [latestArticles, smartRawArticles, smartClusters]) {
            for (const article of articles) retainArticle(article);
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
