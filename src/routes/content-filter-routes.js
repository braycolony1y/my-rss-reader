import { authMiddleware } from '../middleware/auth.js';
import { normalizeBlockedKeywordEntries, articleContentFilterMatches, contentFilterPreviewLinkKey, normalizeBlockedText, combineContentFilterMatchDetails } from '../filters/content-filter.js';
import { cleanStoredCluster } from '../../smart-news.js';
import { normalizeArticleTitle } from '../../feed-parsers.js';
import { safeHttpUrl, normalizeStateUrl } from '../utils/article-utils.js';
import { publishAppEvent } from '../events.js';
import { articlesByLinks } from '../database/article-lookups.js';
import { createIdfProvider, suggestKeywords, suggestionInputFor, SUGGESTION_LIMIT } from '../filters/keyword-suggestions.js';

export function registerContentFilterRoutes({
    app,
    env,
} = {}) {
    // Document frequencies over the last 14 days of titles and snippets, built lazily on the first
    // request and rebuilt at most every 30 minutes. It never touches the embedding cache.
    const getIdfIndex = createIdfProvider({
        loadArticles: async () => {
            const [articles, raw] = await Promise.all([
                env.RSS_DATA.get('articles', { type: 'json', shared: true }),
                env.RSS_DATA.get('smartRawArticles', { type: 'json', shared: true }),
            ]);
            const seen = new Set();
            return [...(articles || []), ...(raw || [])].filter(article => {
                const link = article?.link;
                if (!link || seen.has(link)) return false;
                seen.add(link);
                return true;
            });
        },
    });

    async function findSuggestionSubject(link, clusterId, originalLink) {
        const normalizedLink = normalizeStateUrl(link);
        const links = originalLink && originalLink !== link ? [link, originalLink] : [link];
        // Google News repair also replaces cluster IDs that are the story URL.
        const hasLinkClusterId = links.some(url => normalizeStateUrl(url) === normalizeStateUrl(clusterId));
        for (const key of ['smartClusters', 'articles', 'smartRawArticles']) {
            const rows = await articlesByLinks(env.RSS_DATA, key, links, { normalized: true, includeOriginalLink: true });
            const matching = rows.filter(row => !clusterId || !row.clusterId || row.clusterId === clusterId
                || (hasLinkClusterId && (row.clusterId === row.link || row.clusterId === row.originalLink)));
            const found = matching.find(row => row.link === link)
                || matching.find(row => normalizeStateUrl(row.link) === normalizedLink)
                || matching[0];
            if (found) return found;
        }
        return null;
    }

    app.get('/api/content-filters/suggest', authMiddleware, async (req, res) => {
        try {
            const link = String(req.query.link || '').slice(0, 2000);
            if (!safeHttpUrl(link)) return res.status(400).json({ error: 'A story link is required.' });
            const clusterId = String(req.query.clusterId || '').slice(0, 2000);
            const originalLink = String(req.query.originalLink || '').slice(0, 2000);
            const article = await findSuggestionSubject(link, clusterId, safeHttpUrl(originalLink) ? originalLink : '');
            if (!article) return res.status(404).json({ error: 'This story is no longer available. Refresh and try again.' });
            const requested = Math.floor(Number(req.query.limit));
            const limit = Number.isFinite(requested) && requested > 0 ? Math.min(SUGGESTION_LIMIT, requested) : SUGGESTION_LIMIT;
            const [index, blocked] = await Promise.all([
                getIdfIndex(),
                env.RSS_DATA.get('blockedArticleKeywords', { type: 'json' }),
            ]);
            const input = suggestionInputFor(article);
            res.json({
                title: input.title,
                suggestions: suggestKeywords({ ...input, blockedKeywords: blocked || [], index, limit }),
            });
        } catch (error) {
            console.error('[CONTENT FILTER] Keyword suggestion failed:', error);
            res.status(500).json({ error: 'Could not suggest keywords.' });
        }
    });

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

            const affected = [];
            const byLink = new Map();
            const bySignature = new Map();
            const matchDetails = article => articleContentFilterMatches(article, keywordEntries, true);
            const addAffected = (article, surface, details) => {
                if (!details.length) return;
                const title = normalizeArticleTitle(article.title) || 'Untitled article';
                const feedTitle = article.feedTitle || article.siteName || article.sourceName || (surface === 'Smart' ? 'Stories' : 'Unknown source');
                const pubDate = article.pubDate || article.date || article.createDate || '';
                const linkKey = contentFilterPreviewLinkKey(article.link || '');
                const originalKey = contentFilterPreviewLinkKey(article.originalLink || '');
                const timeKey = Number.isFinite(Date.parse(pubDate)) ? Math.floor(Date.parse(pubDate) / 60000) : '';
                const signature = [normalizeBlockedText(title), normalizeBlockedText(feedTitle), timeKey].join('|');
                let record = byLink.get(linkKey) || byLink.get(originalKey) || bySignature.get(signature);
                if (!record) {
                    record = {
                        id: 'affected:' + (linkKey || originalKey || signature),
                        title,
                        link: safeHttpUrl(article.link || ''),
                        feedTitle,
                        feedIcon: safeHttpUrl(article.feedIcon || article.icon || ''),
                        category: article.feedCategory || article.smartCategory || '',
                        pubDate,
                        rawMatches: [],
                        surfacesByKeyword: new Map()
                    };
                    affected.push(record);
                }
                record.rawMatches.push(...details);
                for (const { keyword } of details) {
                    if (!record.surfacesByKeyword.has(keyword)) record.surfacesByKeyword.set(keyword, new Set());
                    record.surfacesByKeyword.get(keyword).add(surface);
                }
                if (linkKey) byLink.set(linkKey, record);
                if (originalKey) byLink.set(originalKey, record);
                bySignature.set(signature, record);
            };
            for (const article of articles) addAffected(article, 'Feed', matchDetails(article));
            for (const article of smartRawArticles) addAffected(article, 'Smart', matchDetails(article));
            for (const cluster of smartClusters) {
                const leadMatches = matchDetails(cluster);
                addAffected(cluster, 'Smart', leadMatches);
                if (!Array.isArray(cluster?.relatedArticles)) continue;
                const inheritedMatches = leadMatches.map(detail => ({
                    ...detail, fieldLabel: `Story lead (${detail.fieldLabel})`
                }));
                for (const member of cluster.relatedArticles) {
                    const directMatches = matchDetails(member);
                    if (!inheritedMatches.length) {
                        addAffected(member, 'Smart', directMatches);
                        continue;
                    }
                    addAffected(member, 'Smart', [
                        ...directMatches,
                        ...inheritedMatches.filter(detail => !directMatches.some(match => match.keyword === detail.keyword))
                    ]);
                }
            }
            affected.sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));
            const groups = new Map(keywordEntries.map(entry => [entry.normalized, { keyword: entry.keyword, matches: [] }]));
            for (const { rawMatches, surfacesByKeyword, ...record } of affected) {
                for (const detail of combineContentFilterMatchDetails(rawMatches)) {
                    const key = normalizeBlockedText(detail.keyword);
                    const group = groups.get(key);
                    if (!group) continue;
                    group.matches.push({
                        ...record, id: record.id + ':' + key,
                        surfaces: [...surfacesByKeyword.get(detail.keyword)], matches: [detail]
                    });
                }
            }
            cacheEntry = { key: cacheKey, timestamp: now, overallTotal: affected.length, groups };
            _contentFilterPreviewCache = cacheEntry;
        }

        const { overallTotal, groups } = cacheEntry;
        const selectedKey = requestedKeyword && groups.has(requestedKeyword.normalized)
            ? requestedKeyword.normalized
            : keywordEntries[keywordEntries.length - 1].normalized;
        const selectedGroup = groups.get(selectedKey);
        const keywordTotals = [...groups.values()].map(group => ({ keyword: group.keyword, total: group.matches.length }));
        res.json({
            total: selectedGroup.matches.length,
            overallTotal,
            offset,
            limit,
            selectedKeyword: selectedGroup.keyword,
            keywordTotals,
            matches: selectedGroup.matches.slice(offset, offset + limit)
        });
    });

}
