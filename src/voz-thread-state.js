const VOZ_DELETED_THREAD_PATTERN = /(?:The requested thread could not be found|Chủ đề yêu cầu không tìm thấy|Không tìm thấy chủ đề được yêu cầu)/i;
const VOZ_ERROR_TITLE_PATTERN = /(?:^|\n|<title[^>]*>)\s*(?:Title:\s*)?(?:Oops! We ran into some problems\.|Rất tiếc!\s*Đã xảy ra một số vấn đề\.)(?:\s*\|\s*VOZ)?\s*(?:$|\n|<\/title>)/i;

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
        const queryPage = Number.parseInt(parsed.searchParams.get('page'), 10);
        if (Number.isSafeInteger(queryPage) && queryPage > 0) return queryPage;
        const match = parsed.pathname.match(/\/page-(\d+)\/?$/i);
        if (!match) return null;
        const page = Number.parseInt(match[1], 10);
        return Number.isSafeInteger(page) && page > 0 ? page : null;
    } catch (error) {
        const value = String(url);
        const queryMatch = value.match(/[?&]page=(\d+)(?:&|#|$)/i);
        if (queryMatch) {
            const page = Number.parseInt(queryMatch[1], 10);
            if (Number.isSafeInteger(page) && page > 0) return page;
        }
        const match = value.match(/\/page-(\d+)\/?(?:[?#].*)?$/i);
        if (!match) return null;
        const page = Number.parseInt(match[1], 10);
        return Number.isSafeInteger(page) && page > 0 ? page : null;
    }
}

export function buildVozThreadPageUrl(url = '', page = 1, { preferQuery = null } = {}) {
    const pageNumber = Number.parseInt(page, 10);
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) return String(url || '');
    try {
        const parsed = new URL(String(url));
        const hadQueryPage = parsed.searchParams.has('page');
        const hadPathPage = /\/page-\d+\/?$/i.test(parsed.pathname);
        const useQuery = preferQuery === null ? (hadQueryPage || !hadPathPage) : Boolean(preferQuery);
        parsed.hash = '';
        parsed.pathname = parsed.pathname
            .replace(/\/(?:unread|latest|page-\d+|post-\d+)\/?$/i, '')
            .replace(/\/+$/, '');
        parsed.searchParams.delete('page');
        if (pageNumber > 1) {
            if (useQuery) {
                if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
                parsed.searchParams.set('page', String(pageNumber));
            } else {
                parsed.pathname += `/page-${pageNumber}`;
            }
        }
        return parsed.href;
    } catch (error) {
        const raw = String(url || '');
        const queryStyle = preferQuery === null ? /[?&]page=\d+/i.test(raw) || !/\/page-\d+/i.test(raw) : Boolean(preferQuery);
        const base = raw
            .replace(/#.*$/, '')
            .replace(/([?&])page=\d+(&?)/i, (m, lead, tail) => lead === '?' && tail ? '?' : tail ? lead : '')
            .replace(/[?&]$/, '')
            .replace(/\/(?:unread|latest|page-\d+|post-\d+)\/?$/i, '')
            .replace(/\/+$/, '');
        if (pageNumber <= 1) return base;
        if (queryStyle) return base + (base.includes('?') ? '&' : '?') + `page=${pageNumber}`;
        return `${base}/page-${pageNumber}`;
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

    const paginationEntries = Array.isArray(pagination?.pages) ? pagination.pages : [];
    const preferQuery = (() => {
        try {
            if (new URL(String(requestedUrl)).searchParams.has('page')) return true;
        } catch {}
        return paginationEntries.some(entry => /[?&]page=\d+/i.test(String(entry?.url || '')));
    })();
    const baseUrl = buildVozThreadPageUrl(threadUrl || requestedUrl, 1, { preferQuery });
    const pageUrl = page => buildVozThreadPageUrl(baseUrl, page, { preferQuery });
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

// A page hint is only a shortcut: the permanent post ID must be present before
// it can replace a publisher post redirect (positions can change after edits).
export async function getCachedVozResumePage(url, pageHint, getCachedArticle) {
    if (!isVozThreadUrl(url)) return null;
    const parsed = new URL(url);
    const postId = parsed.pathname.match(/\/post-(\d+)\/?$/)?.[1];
    const page = Number(pageHint);
    if (!postId || !Number.isSafeInteger(page) || page < 1) return null;
    const candidates = [
        buildVozThreadPageUrl(url, page, { preferQuery: true }),
        buildVozThreadPageUrl(url, page, { preferQuery: false })
    ];

    for (const pageUrl of [...new Set(candidates)]) {
        const cached = await getCachedArticle(pageUrl);
        if (!cached?.content || isUnsafeVozThreadPayload(pageUrl, cached)) continue;
        if (!new RegExp(`data-absolute-post-id=["']${postId}["']`).test(cached.content)) continue;
        return { url: pageUrl, cached };
    }

    return null;
}
