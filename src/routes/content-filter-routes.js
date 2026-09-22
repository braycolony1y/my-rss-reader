import { authMiddleware } from '../middleware/auth.js';
import { normalizeBlockedKeywordEntries, articleContentFilterMatches, contentFilterPreviewLinkKey, normalizeBlockedText, combineContentFilterMatchDetails } from '../filters/content-filter.js';
import { cleanStoredCluster } from '../../smart-news.js';
import { normalizeArticleTitle } from '../../feed-parsers.js';
import { safeHttpUrl } from '../utils/article-utils.js';
import { publishAppEvent } from '../events.js';

export function registerContentFilterRoutes({
    app,
    env,
} = {}) {
    app.get('/api/content-filter-settings', authMiddleware, async (req, res) => {
        const stored = await env.RSS_DATA.get('blockedArticleKeywords', { type: 'json' }) || [];
        const keywords = normalizeBlockedKeywordEntries(stored).map(entry => entry.keyword);
        if (JSON.stringify(stored) !== JSON.stringify(keywords)) {
            await env.RSS_DATA.put('blockedArticleKeywords', JSON.stringify(keywords));
        }
        res.json({ keywords });
    });

    app.post('/api/content-filter-settings', authMiddleware, async (req, res) => {
        const keywords =
            normalizeBlockedKeywordEntries(
                req.body?.keywords
            ).map(
                entry => entry.keyword
            );

        await env.RSS_DATA.put('blockedArticleKeywords', JSON.stringify(keywords), { allowLargeReduction: true });
        _contentFilterPreviewCache = null;
        publishAppEvent('content-filter-changed', { keywords });

        res.json({
            ok: true,
            keywords
        });
    });

    let _contentFilterPreviewCache = null;

    app.post('/api/content-filter-preview', authMiddleware, async (req, res) => {
        const keywordEntries = normalizeBlockedKeywordEntries(req.body?.keywords);
        const requestedKeyword = normalizeBlockedKeywordEntries([req.body?.selectedKeyword])[0];
        const offset = Math.max(0, Math.floor(Number(req.body?.offset) || 0));
        const limit = Math.min(100, Math.max(1, Math.floor(Number(req.body?.limit) || 50)));
        if (!keywordEntries.length) return res.json({ total: 0, overallTotal: 0, offset, limit, selectedKeyword: '', keywordTotals: [], matches: [] });

        const cacheKey = JSON.stringify(keywordEntries.map(k => k.normalized).sort());
        const now = Date.now();
        let cacheEntry = _contentFilterPreviewCache && _contentFilterPreviewCache.key === cacheKey ? _contentFilterPreviewCache : null;

        if (!cacheEntry || now - cacheEntry.timestamp > 30000) {
            const articles = await env.RSS_DATA.get('articles', { type: 'json' }) || [];

            // CONTENT_FILTER_HEAVY_GATE_V2
            //
            // Filtered Smart-source articles are intentionally excluded from
            // Smart clustering/AI, but remain in smartRawArticles. Include the
            // raw Smart snapshot here so Content Filters can still show the
            // matching article when the user checks a keyword.
            const smartRawArticles =
                await env.RSS_DATA.get(
                    'smartRawArticles',
                    { type: 'json' }
                ) || [];

            const smartClusters =
                (
                    await env.RSS_DATA.get(
                        'smartClusters',
                        { type: 'json' }
                    ) || []
                ).map(
                    article =>
                        cleanStoredCluster(article)
                );

            const candidates = [
                ...articles.map(
                    article => ({
                        article,
                        surface: 'Feed'
                    })
                ),
                ...smartRawArticles.map(
                    article => ({
                        article,
                        surface: 'Smart'
                    })
                ),
                ...smartClusters.map(
                    article => ({
                        article,
                        surface: 'Smart'
                    })
                )
            ];
            const affected = [];
            const byLink = new Map();
            const bySignature = new Map();
            for (const candidate of candidates) {
                const details = articleContentFilterMatches(candidate.article, keywordEntries, true);
                if (!details.length) continue;
                const article = candidate.article;
                const title = normalizeArticleTitle(article.title) || 'Untitled article';
                const feedTitle = article.feedTitle || article.siteName || article.sourceName || (candidate.surface === 'Smart' ? 'Smart Briefing' : 'Unknown source');
                const pubDate = article.pubDate || article.date || article.createDate || '';
                const linkKey = contentFilterPreviewLinkKey(article.link || '');
                const timeKey = Number.isFinite(Date.parse(pubDate)) ? Math.floor(Date.parse(pubDate) / 60000) : '';
                const signature = [normalizeBlockedText(title), normalizeBlockedText(feedTitle), timeKey].join('|');
                let record = (linkKey && byLink.get(linkKey)) || bySignature.get(signature);
                if (!record) {
                    record = {
                        id: 'affected:' + (article.clusterId || linkKey || signature || affected.length),
                        surfaces: [],
                        title,
                        link: safeHttpUrl(article.link || ''),
                        feedTitle,
                        feedIcon: safeHttpUrl(article.feedIcon || article.icon || ''),
                        category: article.feedCategory || article.smartCategory || '',
                        pubDate,
                        rawMatches: []
                    };
                    affected.push(record);
                }
                if (!record.surfaces.includes(candidate.surface)) record.surfaces.push(candidate.surface);
                record.rawMatches.push(...details);
                if (linkKey) byLink.set(linkKey, record);
                bySignature.set(signature, record);
            }
            affected.forEach(record => {
                record.matches = combineContentFilterMatchDetails(record.rawMatches);
                delete record.rawMatches;
            });
            affected.sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));
            const groups = new Map(keywordEntries.map(entry => [entry.normalized, { keyword: entry.keyword, matches: [] }]));
            for (const record of affected) {
                for (const detail of record.matches) {
                    const key = normalizeBlockedText(detail.keyword);
                    const group = groups.get(key);
                    if (!group) continue;
                    group.matches.push({ ...record, id: record.id + ':' + key, matches: [detail] });
                }
            }
            cacheEntry = { key: cacheKey, timestamp: now, affected, groups };
            _contentFilterPreviewCache = cacheEntry;
        }

        const { affected, groups } = cacheEntry;
        const selectedKey = requestedKeyword && groups.has(requestedKeyword.normalized)
            ? requestedKeyword.normalized
            : keywordEntries[keywordEntries.length - 1].normalized;
        const selectedGroup = groups.get(selectedKey);
        const keywordTotals = [...groups.values()].map(group => ({ keyword: group.keyword, total: group.matches.length }));
        res.json({
            total: selectedGroup.matches.length,
            overallTotal: affected.length,
            offset,
            limit,
            selectedKeyword: selectedGroup.keyword,
            keywordTotals,
            matches: selectedGroup.matches.slice(offset, offset + limit)
        });
    });

}
