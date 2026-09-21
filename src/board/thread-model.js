import { absoluteTimestamp } from '../articles/source-time.js';
import { normalizeArticleMediaMarkup } from '../../article-media.js';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';

export const contentHash = (content, url) => createHash('sha256').update(meaningfulContent(content, url)).digest('hex');
export function meaningfulContent(content = '', url = 'https://voz.vn/') {
    const $ = load(normalizeArticleMediaMarkup(content, url), null, false);
    $('script, style, .message-lastEdit, .reactionsBar, .bbCodeBlock-expandLink').remove();
    $('.bbCodeBlock-sourceJump').each((_, el) => $(el).replaceWith($(el).contents()));
    $('img.smilie').each((_, el) => { $(el).replaceWith($('<span>').text($(el).attr('alt') || '')); });
    $('a[href], img[src], source[src], video[src]').each((_, el) => {
        const attr = el.name === 'a' ? 'href' : 'src';
        try {
            const u = new URL($(el).attr(attr), url);
            if (u.hostname === 'voz.vn' && u.pathname === '/goto/post' && u.searchParams.get('id')) { u.pathname = '/p/' + u.searchParams.get('id'); u.search = ''; }
            $(el).attr(attr, u.href);
        } catch {}
    });
    $('pre, code').each((_, el) => { $(el).text(createHash('sha256').update($(el).text()).digest('hex')); });
    $('div, span').each((_, el) => { $(el).replaceWith($(el).contents()); });
    $('*').each((_, el) => {
        if (el.name === 'strong') el.name = 'b';
        if (el.name === 'em') el.name = 'i';
        for (const key of Object.keys(el.attribs || {})) {
            if (!['href', 'src', 'alt', 'colspan', 'rowspan'].includes(key)) $(el).removeAttr(key);
        }
    });
    return $.html().replace(/\s+/g, ' ').replace(/>\s+/g, '>').replace(/\s+</g, '<').trim();
}
export function meaningfulVersions(post, url) {
    let previous;
    return (post.versions || []).filter(version => {
        const hash = contentHash(version.content, url);
        if (hash === previous) return false;
        previous = hash;
        return true;
    });
}
export function canonicalIdentity(value) {
    const u = new URL(typeof value === 'string' ? value : value.resolvedLink || value.link || value.originalLink);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('An HTTP article URL is required');
    u.hash = '';
    const match = u.pathname.match(/^\/(?:t|threads)\/(?:[^/]*\.)?(\d+)(?:\/|$)/i);
    if (match) return `${u.hostname.toLowerCase()}:thread:${match[1]}`;
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.href;
}
export function canonicalUrl(value) {
    const u = new URL(typeof value === 'string' ? value : value.resolvedLink || value.link || value.originalLink);
    u.hash = '';
    if (canonicalIdentity(u.href).includes(':thread:')) {
        u.pathname = u.pathname.replace(/\/(?:page-\d+|unread|latest|post-\d+)\/?$/i, '').replace(/\/+$/, '');
        u.search = '';
    } else {
        for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
        u.searchParams.sort();
    }
    return u.href;
}
const iso = absoluteTimestamp;
export function extractThreadSnapshot(html, url) {
    const $ = load(html);
    const nodes = $('article.message--post, .message[data-content^="post-"]');
    if (!nodes.length) return null;
    const thread_id = canonicalIdentity(url);
    const page = Number($('.pageNav-page--current').first().text().trim()) || Number(new URL(url).pathname.match(/\/page-(\d+)/)?.[1]) || 1;
    let pageCount = page;
    $('a[href]').each((_, el) => {
        try {
            const href = new URL($(el).attr('href'), url);
            if (canonicalIdentity(href.href) === thread_id) pageCount = Math.max(pageCount, Number(href.pathname.match(/\/page-(\d+)/)?.[1]) || 1);
        } catch {}
    });
    const posts = [];
    let complete = true;
    nodes.each((i, el) => {
        const node = $(el);
        const id = (node.attr('data-content') || node.attr('id') || '').match(/(?:js-)?post-(\d+)$/)?.[1];
        const body = node.find('.message-body .bbWrapper, .message-content .bbWrapper').first();
        if (!id || !body.length) { complete = false; return; }
        body.find('[href], [src], [data-src], [poster]').each((_, media) => {
            const item = $(media);
            if (item.attr('data-src') && (!item.attr('src') || /(?:blank|placeholder|transparent)/i.test(item.attr('src')))) item.attr('src', item.attr('data-src'));
            for (const attr of ['href', 'src', 'poster']) {
                const value = item.attr(attr);
                if (!value) continue;
                try { item.attr(attr, new URL(value, url).href); } catch { item.removeAttr(attr); }
            }
        });
        const author = node.find('.message-name .username, .message-userDetails .username').first();
        const attribution = node.find('.message-attribution-main time').first();
        const edit = node.find('.message-lastEdit time').first();
        const numberLink = node.find('.message-attribution-opposite a').filter((_, a) => /^#\d+$/.test($(a).text().trim())).first();
        posts.push({ thread_id, post_id: id, author_id: author.attr('data-user-id') || node.find('[data-user-id]').first().attr('data-user-id') || null,
            author_name: node.attr('data-author') || author.text().trim(),
            author_rank: node.find('.userTitle').first().text().trim(),
            source_created_at: (iso(attribution.attr('datetime')) || iso(attribution.attr('data-timestamp')) || iso(attribution.attr('data-time'))),
            source_edited_at: (iso(edit.attr('datetime')) || iso(edit.attr('data-timestamp')) || iso(edit.attr('data-time'))),
            author_avatar: (() => { const img = node.find('.message-cell--user .avatar img, .message-avatar img').first(); const src = img.attr('data-src') || img.attr('src'); if (!src) return null; try { return new URL(src, url).href; } catch { return null; } })(), current_content: body.html(),
            created_at: (iso(attribution.attr('datetime')) || iso(attribution.attr('data-timestamp')) || iso(attribution.attr('data-time'))),
            edited_at: (iso(edit.attr('datetime')) || iso(edit.attr('data-timestamp')) || iso(edit.attr('data-time'))),
            current_page: page, current_position: i + 1, current_visible_number: Number(numberLink.text().replace('#', '')) || null,
            permalink: new URL(numberLink.attr('href') || `#post-${id}`, url).href });
    });
    return { thread_id, currentPage: page, pageCount, posts, complete };
}
export function reconcilePosts(record, posts, complete, timestamp = new Date().toISOString(), options = {}) {
    record.posts ||= {};
    const seen = new Set();
    const freezeBefore = Number(options.freezeBefore);
    const markMissingRemoved = options.markMissingRemoved ?? complete;
    const successful = options.successful ?? complete;

    for (const incoming of posts) {
        const id = String(incoming.post_id);
        if (!/^\d+$/.test(id) && id !== 'article') continue;
        seen.add(id);
        const old = record.posts[id];
        const source_created_at = iso(incoming.source_created_at) || iso(incoming.created_at) || iso(old?.source_created_at) || iso(old?.created_at);
        const sourceTime = Date.parse(source_created_at || '');
        const frozen = Boolean(old && Number.isFinite(freezeBefore) && Number.isFinite(sourceTime) && sourceTime <= freezeBefore);
        const history = [...(old?.presence_history || [])];
        if (old?.is_removed) history.push({ state: 'restored', captured_at: timestamp });

        if (frozen) {
            // Cache-board posts become immutable one hour after their ORIGINAL
            // post time. We still accept live placement/permalink information so
            // deleted-post pagination shifts can be projected correctly, but an
            // edit made later does not rewrite the stored historical body.
            record.posts[id] = {
                ...old,
                thread_id: record.thread_id,
                current_page: incoming.current_page ?? old.current_page,
                current_position: incoming.current_position ?? old.current_position,
                current_visible_number: incoming.current_visible_number ?? old.current_visible_number,
                permalink: incoming.permalink || old.permalink,
                source_created_at,
                created_at: source_created_at,
                last_seen_at: timestamp,
                last_live_placement_at: timestamp,
                removed_at: null,
                is_removed: false,
                presence_history: history
            };
            continue;
        }

        const source_edited_at = iso(incoming.source_edited_at) || iso(incoming.edited_at) || iso(old?.source_edited_at) || iso(old?.edited_at);
        const hash = contentHash(incoming.current_content, record.url || incoming.permalink);
        const versions = [...(old?.versions || [])];
        if (!old || contentHash(old.current_content, record.url || incoming.permalink) !== hash) {
            versions.push({ content: incoming.current_content, captured_at: timestamp, edited_at: incoming.edited_at || null, hash, version: versions.length + 1 });
        }
        record.posts[id] = {
            ...old,
            ...incoming,
            thread_id: record.thread_id,
            display_content: incoming.display_content || incoming.current_content,
            source_created_at,
            source_edited_at,
            created_at: source_created_at,
            edited_at: source_edited_at,
            cached_at: old?.cached_at || old?.first_seen_at || timestamp,
            hash,
            presence_history: history,
            first_seen_at: old?.first_seen_at || timestamp,
            last_seen_at: timestamp,
            last_live_placement_at: timestamp,
            removed_at: null,
            is_removed: false,
            versions
        };
    }

    if (markMissingRemoved) {
        for (const post of Object.values(record.posts)) {
            if (!seen.has(String(post.post_id)) && !post.is_removed) {
                post.is_removed = true;
                post.removed_at = timestamp;
                (post.presence_history ||= []).push({ state: 'removed', captured_at: timestamp });
            }
        }
    }
    if (successful) record.last_successful_sync_at = timestamp;
    record.sync_status = successful ? 'complete' : 'incomplete';
    return record;
}

// One-time migration: permanent IDs only; never manufacture IDs from #2 or a page offset.
export function extractLegacyPosts(content, url) {
    const $ = load(content);
    const thread_id = canonicalIdentity(url);
    const page = Number(new URL(url).pathname.match(/\/page-(\d+)/)?.[1]) || 1;
    const posts = [];
    $('.voz-post[data-absolute-post-id]').each((i, el) => {
        const node = $(el), id = node.attr('data-absolute-post-id');
        if (!/^\d+$/.test(id)) return;
        posts.push({ thread_id, post_id: id, author_id: null, author_name: node.find('.voz-post-author').text().replace(/^@/, ''),
            author_avatar: node.find('.voz-post-author-group img').attr('src') || null,
            author_rank: node.find('.voz-post-rank').text().trim(),
            reaction_html: node.find('.voz-post-likes').first().prop('outerHTML') || '',
            current_content: node.find('.voz-post-body').html() || '', created_at: iso(node.attr('data-source-created-at') || (node.find('time').attr('data-time-kind') === 'cached' ? null : node.find('time').attr('datetime'))), edited_at: iso(node.attr('data-source-edited-at')),
            current_page: page, current_position: i + 1, current_visible_number: Number(node.attr('data-post-index')) || null,
            permalink: node.find('.voz-post-index').attr('href') || url });
    });
    return posts;
}

export function upgradeArchiveTimes(record) {
    for (const post of Object.values(record.posts || {})) {
        post.source_created_at = iso(post.source_created_at) || iso(post.created_at);
        post.source_edited_at = iso(post.source_edited_at) || iso(post.edited_at);
        post.cached_at ||= post.versions?.[0]?.captured_at || post.first_seen_at || null;
    }
    const first = Object.values(record.posts || {}).find(p => p.current_visible_number === 1 || p.post_id === 'article');
    record.source_created_at ||= first?.source_created_at || null;
    record.source_edited_at = first?.source_edited_at || record.source_edited_at || null;
    record.cached_at ||= (record.legacy_snapshots || []).map(s => iso(s.captured_at)).filter(Boolean).sort()[0] || record.first_seen_at || null;
    return record;
}
