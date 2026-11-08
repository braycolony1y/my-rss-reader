// Live mobile pages exclude committed identities before taking a page. Numeric
// offsets remain available to existing clients and desktop infinite scrolling.
export function feedPageKey(article) {
    const link = article.link || article.originalLink || '';
    try {
        const url = new URL(link);
        const thread = /^(?:www\.)?voz\.vn$/i.test(url.hostname)
            && url.pathname.match(/^\/(?:t|threads)\/(?:[^/]*\.)?(\d+)(?:\/|$)/i);
        if (thread) return `voz:${thread[1]}`;
    } catch {}
    return `link:${link}`;
}

function keyList(value) {
    if (!Array.isArray(value) || value.length > 50000
        || value.some(key => typeof key !== 'string' || key.length > 4096)) {
        throw Object.assign(new Error('Invalid feed page history'), { status: 400 });
    }
    return value;
}

export function selectFeedPage({ articles, query, body, hiddenSet, readSet, page, limit }) {
    const { filterType, filterValue = '' } = query;
    const search = String(query.searchQuery || '').toLowerCase();
    const live = query.feedPageMode === 'unseen';
    const seen = new Set(live ? keyList(body?.seenArticleKeys || []) : []);
    const fixedKeys = live && body?.pageArticleKeys !== undefined ? keyList(body.pageArticleKeys) : null;
    const wanted = fixedKeys && new Set(fixedKeys);
    const fixed = new Map(), unique = new Set(), selected = [];
    const start = (page - 1) * limit;
    let qualifying = 0, hasMore = false;
    for (const article of articles) {
        if (hiddenSet.has(article.link) || (query.hideRead === 'true' && readSet.has(article.link))) continue;
        if (filterType === 'feed' ? article.feedUrl !== filterValue
            : !(article.feedCategory === filterValue || (filterValue === 'Others' && !article.feedCategory))) continue;
        if (search && ![article.title, article.feedTitle, article.content]
            .some(value => String(value || '').toLowerCase().includes(search))) continue;
        if (live) {
            const key = feedPageKey(article);
            if (unique.has(key)) continue;
            unique.add(key);
            if (wanted) {
                if (wanted.has(key)) fixed.set(key, article);
                if (!seen.has(key)) hasMore = true;
                if (hasMore && fixed.size === wanted.size) break;
            } else if (!seen.has(key)) {
                if (selected.length === limit) { hasMore = true; break; }
                selected.push(article);
            }
        } else {
            if (qualifying >= start && selected.length < limit) selected.push(article);
            if (++qualifying > page * limit) { hasMore = true; break; }
        }
    }
    return {
        articles: fixedKeys ? fixedKeys.filter(key => fixed.has(key)).map(key => fixed.get(key)) : selected,
        hasMore, live
    };
}

export function registerFeedPagePost(app, authMiddleware, handler) {
    app.post('/api/data', authMiddleware, (req, res, next) => {
        if (req.query.feedPageMode !== 'unseen' || !['category', 'feed'].includes(req.query.filterType)) {
            return res.status(400).json({ error: 'Unsupported feed page request' });
        }
        return Promise.resolve(handler(req, res)).catch(next);
    });
    return handler;
}
