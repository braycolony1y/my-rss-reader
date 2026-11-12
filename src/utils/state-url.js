import { normalizeArticleSourceUrl } from '../article-source-state.js';

export function normalizeStateUrl(url) {
    if (!url) return '';
    let u = normalizeArticleSourceUrl(url);
    if (u.includes('voz.vn/t/')) {
        u = u.replace(/[?#].*$/, '')
            .replace(/\/(?:unread|latest|page-\d+|post-\d+)\/?$/i, '')
            .replace(/\/$/, '');
    }
    return u.replace(/\/+$/, '');
}
