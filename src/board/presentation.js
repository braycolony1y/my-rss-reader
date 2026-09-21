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

    const ordered = Object.values(record.posts || {}).sort((a, b) => {
        const aId = Number(a.post_id), bId = Number(b.post_id);
        if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) return aId - bId;
        return (Date.parse(a.source_created_at || a.created_at || '') || 0) - (Date.parse(b.source_created_at || b.created_at || '') || 0);
    });

    // Live posts keep their latest verified VOZ page. A historical post that
    // disappeared from VOZ is an overlay: keep it after its previous surviving
    // neighbour so it never pushes a live post onto a different logical page.
    const projectedPage = new Map();
    let previousLivePage = 1;
    for (const post of ordered) {
        const ownPage = Number(post.current_page) || previousLivePage || 1;
        if (post.is_removed) {
            projectedPage.set(String(post.post_id), previousLivePage || ownPage || 1);
        } else {
            projectedPage.set(String(post.post_id), ownPage);
            previousLivePage = ownPage;
        }
    }

    const requestedPostPage = requestedPost && record.posts[requestedPost]
        ? projectedPage.get(String(requestedPost))
        : null;
    const currentPage = Number(requestedPostPage) || pageOf(requestedUrl);
    const pageNumbers = [...new Set([
        1,
        currentPage,
        ...ordered.map(post => projectedPage.get(String(post.post_id)) || 1),
        ...(record.legacy_snapshots || []).map(s => pageOf(s.url))
    ])].filter(p => Number.isSafeInteger(p) && p > 0).sort((a,b) => a-b);
    const pageUrl = p => p === 1 ? base : `${base}/page-${p}`;
    const index = pageNumbers.indexOf(currentPage);
    const pagePosts = ordered.filter(post => (projectedPage.get(String(post.post_id)) || 1) === currentPage);

    return {
        url: pageUrl(currentPage),
        pagination: {
            currentPage,
            pages: pageNumbers.map(page => ({page, url: pageUrl(page), isCurrent: page === currentPage})),
            prevUrl: index > 0 ? pageUrl(pageNumbers[index - 1]) : null,
            nextUrl: index < pageNumbers.length - 1 ? pageUrl(pageNumbers[index + 1]) : null
        },
        record: {
            ...record,
            posts: Object.fromEntries(pagePosts.map(post => [String(post.post_id), post])),
            legacy_snapshots: (record.legacy_snapshots || []).filter(s => pageOf(s.url) === currentPage)
        }
    };
}
function displayContent(content, url, sanitize = true) {
    // Publisher collapse controls need XenForo scripts; show their full contents in the reader.
    const normalized = normalizeArticleMediaMarkup(styleVozQuotes(content), url).replace(/<div[^>]*class=["'][^"']*bbCodeBlock-expandLink[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
    return sanitize ? sanitizePostMarkup(normalized) : normalized;
}
export function renderArchive(record) {
    const legacyPosts = new Map();
    const posts = Object.values(record.posts).sort((a, b) => {
        const aId = Number(a.post_id), bId = Number(b.post_id);
        if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) return aId - bId;
        return (Date.parse(a.source_created_at || a.created_at || '') || 0) - (Date.parse(b.source_created_at || b.created_at || '') || 0);
    });
    // Modern posts already retain presentation metadata. Only parse old HTML
    // when it can actually supply a missing field.
    const needsLegacy = posts.some(post => post.reaction_html == null || !post.author_avatar || !post.author_rank || !(post.source_created_at || post.created_at));
    for (const snapshot of [...(needsLegacy ? record.legacy_snapshots || [] : [])].sort((a,b) => String(a.captured_at).localeCompare(String(b.captured_at)))) {
        for (const post of extractLegacyPosts(snapshot.content, snapshot.url || record.url)) legacyPosts.set(post.post_id, post);
    }
    const current = posts.map(post => {
        const legacy = legacyPosts.get(post.post_id);
        const versions = post.versions?.length > 1 ? meaningfulVersions(post, record.url) : post.versions || [];
        return renderVozPost({...post,
            author_avatar:post.author_avatar || legacy?.author_avatar,
            author_rank:post.author_rank || legacy?.author_rank,
            source_created_at:post.source_created_at || post.created_at || legacy?.created_at,
            unavailable:post.is_removed || record.sync_status === 'incomplete'
        }, {
            // renderVozPost sanitizes the complete post, including this body.
            body:displayContent(post.display_content || post.current_content, record.url, false),
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
