import { safeHttpUrl } from '../utils/article-utils.js';

function parseOpenCliSearchDestination(output, expectedDomain = '') {
    const source = String(output || '').trim();
    const start = source.indexOf('[');
    const end = source.lastIndexOf(']');
    if (start < 0 || end <= start) return '';
    let results;
    try {
        results = JSON.parse(source.slice(start, end + 1));
    } catch (error) {
        return '';
    }
    const domain = String(expectedDomain || '').toLowerCase().replace(/^www\./, '');
    for (const result of Array.isArray(results) ? results : []) {
        const candidate = safeHttpUrl(result?.url);
        if (!candidate || isGoogleNewsArticleUrl(candidate)) continue;
        try {
            const hostname = new URL(candidate).hostname.toLowerCase().replace(/^www\./, '');
            if (!domain || hostname === domain || hostname.endsWith('.' + domain)) return candidate;
        } catch (error) { }
    }
    return '';
}

function isGoogleNewsArticleUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.hostname === 'news.google.com' && /\/(?:rss\/)?articles\//.test(parsed.pathname);
    } catch (e) {
        return false;
    }
}

function isGoogleNewsHostedThumbnail(value) {
    try {
        const hostname = new URL(value).hostname.toLowerCase();
        return hostname === 'lh3.googleusercontent.com'
            || hostname === 'news.google.com'
            || hostname.endsWith('.gstatic.com');
    } catch (error) {
        return false;
    }
}

export { isGoogleNewsArticleUrl, parseOpenCliSearchDestination, isGoogleNewsHostedThumbnail };
