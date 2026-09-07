import { sourceTimeMarkup } from './source-time.js';
import { normalizeArticleMediaMarkup } from '../../article-media.js';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const purifier = createDOMPurify(new JSDOM('').window);
export const escapePostText = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[ch]);
// The same safety and media rules apply to live and archived posts.
purifier.addHook('uponSanitizeElement', node => {
    if (node.nodeName !== 'IFRAME') return;
    try {
        const url = new URL(node.getAttribute('src'));
        const hosts = ['youtube.com', 'youtube-nocookie.com', 'player.vimeo.com', 'tiktok.com', 'player.bilibili.com', 'dailymotion.com', 'facebook.com', 'instagram.com', 'platform.twitter.com', 'redditmedia.com', 'reddit.com'];
        if (url.protocol !== 'https:' || !hosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) node.remove();
        else { node.removeAttribute('srcdoc'); node.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation'); }
    } catch { node.remove(); }
});
export function sanitizePostMarkup(html) {
    return purifier.sanitize(html || '', { USE_PROFILES: {html:true}, ADD_TAGS:['iframe'], ADD_ATTR:['allow', 'allowfullscreen', 'frameborder', 'sandbox', 'scrolling', 'target', 'referrerpolicy'], FORBID_ATTR:['srcdoc'] });
}
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
