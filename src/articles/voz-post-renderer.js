import { sourceTimeMarkup } from './source-time.js';
import { normalizeArticleMediaMarkup } from '../../article-media.js';
import { sanitizePostMarkup } from './post-markup-sanitizer.js';
export { sanitizePostMarkup };

export const escapePostText = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[ch]);
export function renderVozPost(post, {body = '', reactions = '', annotations = '', history = ''} = {}) {
    const e = escapePostText;
    const avatar = post.author_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(post.author_name || 'Member')}&background=random&color=fff&size=96`;
    return sanitizePostMarkup(normalizeArticleMediaMarkup(`<div class="voz-post" id="voz-post-${e(post.current_visible_number || post.post_id)}" data-post-index="${e(post.current_visible_number || '')}" data-absolute-post-id="${e(post.post_id)}" data-source-created-at="${e(post.source_created_at || post.created_at || '')}" data-source-edited-at="${e(post.source_edited_at || post.edited_at || '')}">
    <div class="voz-post-header">
        <div class="voz-post-author-group">
            <img src="${e(avatar)}" alt="${e(post.author_name)}" loading="lazy">
            <span class="voz-post-author">@${e(post.author_name)}</span>
            <span class="voz-post-rank">${e(post.author_rank || 'Member')}</span>
        </div>
        <div class="voz-post-info">
            ${sourceTimeMarkup(post)}
            <a href="${e(post.permalink)}" target="_blank" rel="noopener noreferrer" class="voz-post-index" title="Mở bài viết gốc">${post.current_visible_number ? '#' + e(post.current_visible_number) : 'Source'}</a>
        </div>
    </div>
    ${annotations}
    <div class="voz-post-body">${body}</div>
    ${reactions}
    ${history}
</div>`, post.permalink));
}
