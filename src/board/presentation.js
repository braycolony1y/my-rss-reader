import { styleVozQuotes } from '../sources/VozSource.js';
import { normalizeStoredPostTimes } from '../articles/source-time.js';
import { normalizeArticleMediaMarkup } from '../../article-media.js';
import { canonicalUrl, meaningfulVersions, extractLegacyPosts } from './thread-model.js';
import { renderVozPost, sanitizePostMarkup } from '../articles/voz-post-renderer.js';
export const escapeText = text => String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
export function archivePage(record, requestedUrl = record.url) {
    if (!record.thread_id.includes(':thread:')) return { record, url: record.url, pagination: null };
    const base = canonicalUrl(record.url).replace(/\/$/, '');
    const pageOf = url => Number(String(url || '').match(/\/page-(\d+)/)?.[1]) || 1;
    const requestedPost = String(requestedUrl).match(/\/post-(\d+)(?:[/?#]|$)/)?.[1];
    const currentPage = requestedPost && record.posts[requestedPost] ? Number(record.posts[requestedPost].current_page) || 1 : pageOf(requestedUrl);
    const pageNumbers = [...new Set([1, currentPage, ...Object.values(record.posts).map(p => Number(p.current_page) || 1), ...(record.legacy_snapshots || []).map(s => pageOf(s.url))])].filter(p => Number.isSafeInteger(p) && p > 0).sort((a,b) => a-b);
    const pageUrl = p => p === 1 ? base : `${base}/page-${p}`;
    const index = pageNumbers.indexOf(currentPage);
    return { url: pageUrl(currentPage), pagination: { currentPage, pages: pageNumbers.map(page => ({page, url: pageUrl(page), isCurrent: page === currentPage})),
        prevUrl: index > 0 ? pageUrl(pageNumbers[index - 1]) : null, nextUrl: index < pageNumbers.length - 1 ? pageUrl(pageNumbers[index + 1]) : null },
        record: { ...record, posts: Object.fromEntries(Object.entries(record.posts).filter(([,p]) => (Number(p.current_page) || 1) === currentPage)), legacy_snapshots: (record.legacy_snapshots || []).filter(s => pageOf(s.url) === currentPage) } };
}
function displayContent(content, url) {
    // Publisher collapse controls need XenForo scripts; show their full contents in the reader.
    const normalized = normalizeArticleMediaMarkup(styleVozQuotes(content), url).replace(/<div[^>]*class=["'][^"']*bbCodeBlock-expandLink[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
    return sanitizePostMarkup(normalized);
}
export function renderArchive(record) {
    const legacyPosts = new Map();
    for (const snapshot of [...(record.legacy_snapshots || [])].sort((a,b) => String(a.captured_at).localeCompare(String(b.captured_at)))) {
        for (const post of extractLegacyPosts(snapshot.content, snapshot.url || record.url)) legacyPosts.set(post.post_id, post);
    }
    const posts = Object.values(record.posts).sort((a, b) => (a.current_page - b.current_page) || (a.current_position - b.current_position));
    const current = posts.map(post => {
        const legacy = legacyPosts.get(post.post_id);
        const versions = meaningfulVersions(post, record.url);
        return renderVozPost({...post,
            author_avatar:post.author_avatar || legacy?.author_avatar,
            author_rank:post.author_rank || legacy?.author_rank,
            source_created_at:post.source_created_at || post.created_at || legacy?.created_at,
            unavailable:post.is_removed || record.sync_status === 'incomplete'
        }, {
            body:displayContent(post.display_content || post.current_content, record.url),
            reactions:post.reaction_html ?? legacy?.reaction_html ?? '',
            annotations:post.is_removed ? `<div class="cache-removed">Removed from source · Last seen ${escapeText(post.last_seen_at)} · Removed ${escapeText(post.removed_at)}</div>` : '',
            history:versions.length > 1 ? `<button class="cache-history-button" data-cache-history="${escapeText(post.post_id)}">View change history · ${versions.length} versions</button>` : ''
        });
    }).join('\n');
    if (posts.length) return current;
    // Keep old archives readable when permanent post IDs were never captured.
    // Backups remain on disk, but are not appended to the thread as duplicate pages.
    const latest = [...(record.legacy_snapshots || [])].sort((a,b) => String(a.captured_at).localeCompare(String(b.captured_at))).at(-1);
    return latest ? displayContent(normalizeStoredPostTimes(latest.content, {cached_at:latest.captured_at, unavailable:true}), latest.url || record.url) : '';
}
