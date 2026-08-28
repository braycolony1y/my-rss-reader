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
