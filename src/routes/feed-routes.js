import sourceRegistry from '../sources/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { publisherIcon } from '../utils/article-utils.js';
import { sourceFetchPolicyIdentity } from '../../smart-news.js';

export function registerFeedRoutes({
    app,
    setManualSyncProgress,
    syncFeeds,
    env,
    smartNews,
    finishManualSyncProgress,
    getRootDomain,
    ARTICLE_FETCH_BASE_POINTS,
    normalizeConfiguredSourceFetchMethods,
    synchronizeConfiguredSourceFetchMethods,
} = {}) {
    app.post('/api/sync', authMiddleware, async (req, res) => {
        let targetFeedUrl = req.body && req.body.feedUrl ? req.body.feedUrl : null;
        let targetCategory = req.body && req.body.category ? req.body.category : null;
        const requestId = String(req.body?.requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
        setManualSyncProgress(requestId, 'starting', targetFeedUrl ? 'Preparing this source…' : targetCategory ? `Preparing ${targetCategory} refresh…` : 'Preparing feed refresh…');
        try {
            const result = await syncFeeds(env, targetFeedUrl, progress => {
                setManualSyncProgress(requestId, progress.stage, progress.message, progress);
            }, targetCategory);
            if (!targetFeedUrl && !targetCategory) {
                setManualSyncProgress(requestId, 'smart', 'Updating Smart clusters…');
                result.smart = await smartNews.sync(progress => {
                    setManualSyncProgress(requestId, progress.stage, progress.message, progress);
                });
            }
            finishManualSyncProgress(requestId, 'Refresh complete.', {
                failed: result.success === false || result.smart?.ok === false
            });
            res.json(result);
        } catch (error) {
            finishManualSyncProgress(requestId, 'Refresh failed.', { failed: true, error: error.message });
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/feeds', authMiddleware, async (req, res) => {
        try {
            let { url: feedUrl, category } = req.body;
            feedUrl = feedUrl.trim();
            if (!feedUrl.startsWith('http')) feedUrl = 'https://' + feedUrl;
            let feeds = await env.RSS_DATA.get('feeds', { type: 'json' }) || [];

            if (!feeds.find(f => f.url === feedUrl)) {
                let cleanHostname = new URL(feedUrl).hostname;
                if (cleanHostname.includes('dj.com') || cleanHostname.includes('wsj')) cleanHostname = 'wsj.com';
                if (cleanHostname.includes('bbc')) cleanHostname = 'bbc.com';
                const source = sourceRegistry.getHandler(feedUrl);
                let iconUrl = source?.publisherIcon?.(cleanHostname) || publisherIcon(cleanHostname);

                // Inherit a publisher policy whether it was selected in a normal
                // feed or in any Smart category.
                const rootDomain = getRootDomain(feedUrl);
                const existingSameDomainFeed = feeds.find(f => getRootDomain(f.url) === rootDomain && f.fetchMethods && f.fetchMethods.length > 0);
                let existingSmartSource = null;
                if (!existingSameDomainFeed && rootDomain) {
                    const smartSources = await smartNews.getSourceSettings();
                    existingSmartSource = smartSources.find(source =>
                        sourceFetchPolicyIdentity(source) === rootDomain &&
                        Array.isArray(source.fetchMethods) &&
                        source.fetchMethods.length
                    );
                }
                const inheritedFetchMethods = existingSameDomainFeed?.fetchMethods || existingSmartSource?.fetchMethods || [];

                feeds.push({
                    url: feedUrl,
                    title: source?.feedTitle || cleanHostname,
                    category: category || 'Others',
                    icon: iconUrl,
                    excludeFromSmart: req.body.excludeFromSmart || false,
                    fetchMethods: [...inheritedFetchMethods]
                });
                await env.RSS_DATA.put('feeds', JSON.stringify(feeds));
            }
            res.status(200).send('Added');
        } catch (e) {
            res.status(400).send(e.message);
        }
    });

    app.put('/api/feeds', authMiddleware, async (req, res) => {
        const { url: feedUrl, title, category, fetchMethods, excludeFromSmart } = req.body;
        const requestedFetchMethods = Array.isArray(fetchMethods) ? fetchMethods : [];
        const invalidFetchMethods = requestedFetchMethods.filter(method => !(method in ARTICLE_FETCH_BASE_POINTS));
        if (invalidFetchMethods.length) {
            return res.status(400).send(`Unknown fetch method(s): ${[...new Set(invalidFetchMethods)].join(', ')}`);
        }
        const normalizedFetchMethods = normalizeConfiguredSourceFetchMethods(requestedFetchMethods);
        let feeds = await env.RSS_DATA.get('feeds', { type: 'json' }) || [];
        let feedIndex = feeds.findIndex(f => f.url === feedUrl);
        if (feedIndex > -1) {
            feeds[feedIndex].title = title;
            feeds[feedIndex].category = category;
            if (excludeFromSmart !== undefined) feeds[feedIndex].excludeFromSmart = excludeFromSmart;
            const synchronized = await synchronizeConfiguredSourceFetchMethods(
                feeds[feedIndex],
                normalizedFetchMethods,
                feeds
            );
            res.status(200).json({ ok: true, ...synchronized });
        } else {
            res.status(404).send('Not Found');
        }
    });

    app.delete('/api/feeds', authMiddleware, async (req, res) => {
        const { url: feedUrl } = req.body;
        let feeds = await env.RSS_DATA.get('feeds', { type: 'json' }) || [];
        const beforeCount = feeds.length;
        feeds = feeds.filter(f => f.url !== feedUrl);
        if (feeds.length < beforeCount) {
            if (feeds.length === 0) return res.status(409).send('The final feed cannot be removed because it would leave the database without a source.');
            await env.RSS_DATA.put('feeds', JSON.stringify(feeds));
            // Also remove articles belonging to the deleted feed
            let articles = await env.RSS_DATA.get('articles', { type: 'json' }) || [];
            const articlesBefore = articles.length;
            articles = articles.filter(a => a.feedUrl !== feedUrl);
            if (articles.length > 0 || articlesBefore === 0) {
                await env.RSS_DATA.put('articles', JSON.stringify(articles), { allowLargeReduction: true });
            } else {
                console.error('[DB SAFETY] Feed removal would wipe every stored article; old articles were retained until another source syncs.');
            }
            console.log(`[FEEDS] Deleted feed "${feedUrl}" and removed ${articlesBefore - articles.length} associated articles.`);
        }
        res.status(200).send('Deleted');
    });

    app.post('/api/feeds/reorder', authMiddleware, async (req, res) => {
        try {
            const { feeds: newFeedsOrder } = req.body;
            if (!Array.isArray(newFeedsOrder)) return res.status(400).send('Invalid data format');
            const currentFeeds = await env.RSS_DATA.get('feeds', { type: 'json' }) || [];
            const currentUrls = currentFeeds.map(feed => feed.url).sort();
            const incomingUrls = newFeedsOrder.map(feed => feed?.url).filter(Boolean).sort();
            if (currentUrls.length !== incomingUrls.length || currentUrls.some((url, index) => url !== incomingUrls[index])) {
                return res.status(400).send('Reorder must contain every existing feed exactly once.');
            }
            await env.RSS_DATA.put('feeds', JSON.stringify(newFeedsOrder));
            res.status(200).send('Reordered');
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

    app.post('/api/categories/reorder', authMiddleware, async (req, res) => {
        try {
            const { categoryOrder } = req.body;
            if (!Array.isArray(categoryOrder)) return res.status(400).send('Invalid format');
            await env.RSS_DATA.put('categoryOrder', JSON.stringify(categoryOrder));
            res.status(200).send('Categories Reordered');
        } catch (e) {
            res.status(500).send(e.message);
        }
    });

}
