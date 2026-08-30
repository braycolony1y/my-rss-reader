const VOZ_DELETED_THREAD_PATTERN = /(?:The requested thread could not be found|Chủ đề yêu cầu không tìm thấy)/i;
const VOZ_ERROR_TITLE_PATTERN = /(?:^|\n|<title[^>]*>)\s*(?:Title:\s*)?Oops! We ran into some problems\.(?:\s*\|\s*VOZ)?\s*(?:$|\n|<\/title>)/i;

export function isVozThreadUrl(url = '') {
    try {
        const parsed = new URL(String(url));
        return (parsed.hostname === 'voz.vn' || parsed.hostname.endsWith('.voz.vn')) && parsed.pathname.startsWith('/t/');
    } catch (error) {
        return /(?:^|\.)voz\.vn\/t\//i.test(String(url));
    }
}

export function getVozThreadPageNumber(url = '') {
    if (!isVozThreadUrl(url)) return null;
    try {
        const parsed = new URL(String(url));
        const match = parsed.pathname.match(/\/page-(\d+)\/?$/i);
        if (!match) return null;
        const page = Number.parseInt(match[1], 10);
        return Number.isSafeInteger(page) && page > 0 ? page : null;
    } catch (error) {
        const match = String(url).match(/\/page-(\d+)\/?(?:[?#].*)?$/i);
        if (!match) return null;
        const page = Number.parseInt(match[1], 10);
        return Number.isSafeInteger(page) && page > 0 ? page : null;
    }
}

export function getVozPaginationMaxPage(pagination, fallback = 1) {
    const candidates = [Number.parseInt(pagination?.currentPage, 10)];
    for (const entry of Array.isArray(pagination?.pages) ? pagination.pages : []) {
        candidates.push(Number.parseInt(entry?.page, 10));
    }
    const valid = candidates.filter(page => Number.isSafeInteger(page) && page > 0);
    const fallbackPage = Number.parseInt(fallback, 10);
    if (Number.isSafeInteger(fallbackPage) && fallbackPage > 0) valid.push(fallbackPage);
    return valid.length ? Math.max(...valid) : 1;
}

export function alignVozPaginationToRequestedPage(pagination, requestedUrl, threadUrl) {
    const requestedPage = getVozThreadPageNumber(requestedUrl);
    if (!requestedPage) return pagination || null;

    const baseUrl = String(threadUrl || requestedUrl)
        .replace(/[?#].*$/, '')
        .replace(/\/(?:unread|latest|page-\d+|post-\d+)\/?$/i, '')
        .replace(/\/+$/, '');
    const pageUrl = page => page === 1 ? baseUrl : `${baseUrl}/page-${page}`;
    const knownPages = new Map();

    for (const entry of Array.isArray(pagination?.pages) ? pagination.pages : []) {
        const page = Number.parseInt(entry?.page, 10);
        if (!Number.isSafeInteger(page) || page < 1 || knownPages.has(page)) continue;
        knownPages.set(page, {
            ...entry,
            page,
            url: entry.url || pageUrl(page),
            isCurrent: page === requestedPage
        });
    }
    if (!knownPages.has(requestedPage)) {
        knownPages.set(requestedPage, {
            page: requestedPage,
            url: requestedUrl || pageUrl(requestedPage),
            isCurrent: true
        });
    }

    const pages = [...knownPages.values()]
        .sort((a, b) => a.page - b.page)
        .map(entry => ({ ...entry, isCurrent: entry.page === requestedPage }));
    const previousPage = knownPages.get(requestedPage - 1);
    const nextPage = knownPages.get(requestedPage + 1);
    const sourceAlreadyDescribedRequestedPage = Number(pagination?.currentPage) === requestedPage;

    return {
        ...(pagination || {}),
        currentPage: requestedPage,
        pages,
        prevUrl: requestedPage > 1
            ? (previousPage?.url || (sourceAlreadyDescribedRequestedPage ? pagination?.prevUrl : null) || null)
            : null,
        nextUrl: nextPage?.url || (sourceAlreadyDescribedRequestedPage ? pagination?.nextUrl : null) || null
    };
}

export function hasVozDeletedThreadMarker(value = '') {
    const text = typeof value === 'string'
        ? value
        : [value?.title, value?.content, value?.error].filter(Boolean).join('\n');
    return VOZ_DELETED_THREAD_PATTERN.test(String(text));
}

export function isDeletedVozThreadPayload(url, payload) {
    return isVozThreadUrl(url)
        && Boolean(payload?.isDeletedThread || hasVozDeletedThreadMarker(payload));
}

export function isUnsafeVozThreadPayload(url, payload) {
    if (!isVozThreadUrl(url)) return false;
    const text = typeof payload === 'string'
        ? payload
        : [payload?.title, payload?.content, payload?.error].filter(Boolean).join('\n');
    return isDeletedVozThreadPayload(url, payload)
        || VOZ_ERROR_TITLE_PATTERN.test(String(text));
}
