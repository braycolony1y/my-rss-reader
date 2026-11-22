// Explicit source requests retain their force semantics even when several
// pending scopes are widened into one full refresh.
export function shouldSkipFeedFetch(feed, targetFeedUrl, forcedFeedUrls = new Set(), now = Date.now()) {
    if (targetFeedUrl || forcedFeedUrls.has(feed.url) || feed.category !== 'Macroeconomics') return false;
    const lastFetch = global.lastFetchTimeByUrl?.[feed.url] || 0;
    return now - lastFetch < 86400000 - 30000;
}
