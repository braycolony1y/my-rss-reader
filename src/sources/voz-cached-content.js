import { load } from 'cheerio';
import { transformVozBlueskyEmbeds } from './voz-bluesky-embeds.js';
import { normalizeCachedYoutubeEmbeds } from '../articles/youtube-cached-embeds.js';

export function cleanVozCachedContent(content, result = {}) {
    const upgraded = normalizeCachedYoutubeEmbeds(transformVozBlueskyEmbeds(content));
    const page = Number(result.pagination?.currentPage);
    if (!Number.isSafeInteger(page) || page < 1) return upgraded;
    const $ = load(upgraded, null, false);
    let changed = false;
    $('.voz-post').each((ordinal, element) => {
        const post = $(element);
        const index = post.attr('data-post-index');
        const permanentId = post.attr('data-absolute-post-id');
        if (!permanentId || index !== permanentId) return;
        const position = String((page - 1) * 20 + ordinal + 1);
        if (index === position) return;
        post.attr('data-post-index', position).attr('id', 'voz-post-' + position);
        post.find('.voz-post-index').first().text('#' + position);
        changed = true;
    });
    return changed ? $.html() : upgraded;
}
