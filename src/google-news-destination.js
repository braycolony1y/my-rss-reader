export function isExactGoogleNewsDecode(source) {
    return source === 'offline' || source === 'batchexecute' || source === 'browser';
}

// A site-restricted Google News feed must resolve back to that publisher.
export function matchesGoogleNewsPublisher(destination, hints = {}) {
    try {
        let expected = '';
        try {
            const feed = new URL(hints.feedUrl || hints.url || '');
            if (feed.hostname === 'news.google.com') expected = (feed.searchParams.get('q') || '').match(/(?:^|\s)site:([\w.-]+)/i)?.[1] || '';
        } catch { }
        if (!expected) expected = hints.sourceDomain || hints.domain || '';
        if (!expected) return true;
        expected = new URL(expected.includes('://') ? expected : 'https://' + expected).hostname.replace(/^www\./, '').toLowerCase();
        if (/(^|\.)google\.com$/.test(expected)) return true;
        const host = new URL(destination).hostname.replace(/^www\./, '').toLowerCase();
        return host === 'news.google.com' || host === expected || host.endsWith('.' + expected);
    } catch { return false; }
}

// Decode independently: batch RPC response order is not guaranteed to match
// request order, and matching by array position can attach another story's URL.
export async function decodeGoogleNewsIndividually(decoder, urls) {
    const results = [];
    for (const source_url of urls) {
        try {
            results.push({ ...await decoder.decode(source_url), source_url });
        } catch (error) {
            results.push({ status: false, source_url, message: error.message });
        }
    }
    return results;
}

export function repairGoogleNewsRecord(article) {
    if (!article || typeof article !== 'object') return article;
    const valid = item => isExactGoogleNewsDecode(item.googleNewsDecodeSource) || matchesGoogleNewsPublisher(item.link, item);
    const related = (article.relatedArticles || []).filter(valid);
    const validPrimary = valid(article);
    if (validPrimary && related.length === (article.relatedArticles || []).length) return article;
    const primary = validPrimary ? article : related.shift();
    if (!primary) return null;
    const sources = [...new Set([primary, ...related].map(item => item.feedTitle).filter(Boolean))];
    return {
        ...article, ...primary,
        articleKey: primary.link,
        image: primary.image || '',
        originalLink: primary.originalLink,
        contentHash: validPrimary ? article.contentHash : undefined,
        relatedArticles: related,
        sources, sourceCount: sources.length, clusterCount: related.length + 1,
        hotness: undefined,
        clusterId: validPrimary ? article.clusterId : primary.link,
        _activeClusterId: undefined
    };
}
