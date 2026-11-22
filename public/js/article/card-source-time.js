// Resolve the card's creation date from source metadata or an already-opened
// first page. RSS dates on VOZ are reply dates, so they are never a fallback.
const ReaderCardSourceTime = {
    value(article, member, contentCache) {
        const parseUrl = value => { try { return new URL(value); } catch { return null; } };
        const url = parseUrl(article?.link || member?.url);
        const isVoz = url && (url.hostname === 'voz.vn' || url.hostname.endsWith('.voz.vn'))
            && /^\/(?:t|threads)\//.test(url.pathname);
        const valid = value => value && Number.isFinite(new Date(value).getTime()) ? value : null;
        const source = [member?.source_created_at, article?.source_created_at, article?.createDate]
            .map(valid).find(Boolean);
        if (source) return source;
        if (!isVoz) return valid(article?.pubDate) || valid(member?.cached_at);
        const threadKey = parsed => parsed && `${parsed.hostname}${parsed.pathname.replace(/\/(?:unread|page-\d+)\/?$/, '').replace(/\/$/, '')}`;
        const key = threadKey(url);
        for (const [cachedUrl, result] of contentCache || []) {
            const parsed = parseUrl(cachedUrl);
            if (threadKey(parsed) !== key || /\/page-(?:[2-9]|\d{2,})\/?$/.test(parsed.pathname)
                || Number(parsed.searchParams.get('page') || 1) !== 1
                || Number(result.pagination?.currentPage || 1) !== 1) continue;
            const date = valid(result.date);
            if (date) return date;
        }
        return null;
    },
    format(app, article, exactOnly) {
        const value = this.value(article, app.cacheMember(article), app.articleContentCache);
        if (!value) return 'Creation time unavailable';
        return exactOnly ? app.formatVietnamDateTime(value) : app.timeAgo(value);
    }
};
