import {
    hasVozDeletedThreadMarker,
    isDeletedVozThreadPayload,
    isVozThreadUrl
} from './voz-thread-state.js';

const GENERIC_DELETED_SOURCE_PATTERNS = [
    /Không tìm thấy đường dẫn này[\s\S]{0,500}(?:trang chủ|ô (?:dưới đây|tìm kiếm)|tìm kiếm)/iu,
    /(?:Nội dung|Bài viết|Trang) (?:này )?(?:không còn tồn tại|đã bị (?:xóa|gỡ)|không được tìm thấy)/iu,
    /(?:The page|This page|The article|This article) (?:you (?:requested|are looking for) )?(?:could not be found|was not found|no longer exists|has been (?:deleted|removed))/iu,
    /(?:^|[>\s])(?:404|410)\s*(?:[-–|:]\s*)?(?:Page )?(?:Not Found|Gone)(?:[<\s]|$)/iu,
    /class=["'][^"']*(?:error[-_ ]?404|page[-_ ]?not[-_ ]?found|not[-_ ]?found[-_ ]?page)[^"']*["']/iu,
    /<!--\s*RSS_SOURCE_HTTP_STATUS:(?:404|410)\s*-->/i
];

function payloadText(payload) {
    if (typeof payload === 'string') return payload;
    return [payload?.title, payload?.content, payload?.error, payload?.message]
        .filter(Boolean)
        .join('\n');
}

export function hasGenericDeletedSourceMarker(payload = '') {
    const text = payloadText(payload);
    if (!text) return false;

    const titleOrHeading = String(text).match(
        /<(?:title|h1|h2)\b[^>]*>([\s\S]{0,500}?)<\/(?:title|h1|h2)>/giu
    ) || [];
    if (titleOrHeading.some(value => /(?:Không tìm thấy|không còn tồn tại|đã bị (?:xóa|gỡ)|404|410|Not Found|Gone|no longer exists|has been (?:deleted|removed))/iu.test(value))) {
        return true;
    }

    return GENERIC_DELETED_SOURCE_PATTERNS.some(pattern => pattern.test(String(text).slice(0, 250000)));
}

export function isDeletedArticlePayload(url, payload) {
    if (payload?.sourceDeleted === true || payload?.isDeletedSource === true) return true;
    if (isDeletedVozThreadPayload(url, payload)) return true;
    return !isVozThreadUrl(url) && hasGenericDeletedSourceMarker(payload);
}

export function deletedSourceKind(url) {
    return isVozThreadUrl(url) ? 'thread' : 'article';
}

export function deletedSourceTitle(url) {
    return isVozThreadUrl(url) ? 'Deleted Thread' : 'Deleted Article';
}

export function normalizeArticleSourceUrl(value) {
    const url = String(value || '').trim();
    // Markdown/chat copies occasionally leave a closing bracket, parenthesis,
    // brace or escape after a publisher file extension. Those characters are
    // not part of these article URLs and otherwise create a separate 404 cache.
    const cleaned = url.replace(
        /(\.(?:tpo|chn|s?html?|aspx?|php))[\]\\)}]+([?#].*)?$/i,
        '$1$2'
    );
    // URL fragments are never sent to the publisher. RSS feeds such as
    // Techmeme append an in-page anchor while routed reader links omit it;
    // treating those forms as different cache keys causes an avoidable
    // foreground refetch even when the article was already warmed by cron.
    return cleaned.replace(/#.*$/, '');
}

export { hasVozDeletedThreadMarker };
