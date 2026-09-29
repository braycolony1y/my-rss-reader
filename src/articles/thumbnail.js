import { load } from 'cheerio';
import sourceRegistry from '../sources/index.js';
import { decodeProxy, extractImageFromHtml, isInvalidImage, safeHttpUrl } from '../utils/article-utils.js';
import { isVozThreadUrl, getVozThreadPageNumber } from '../voz-thread-state.js';

export function getArticleThumbnail(url, result) {
    if (!result) return null;
    const source = sourceRegistry.getHandler(url);
    const valid = value => {
        if (!value || isInvalidImage(value) || source?.isInvalidFeedImage?.(value)) return null;
        try { return safeHttpUrl(new URL(value, url).href) || null; } catch { return null; }
    };
    let content = result.content || '';
    if (isVozThreadUrl(url)) {
        // Replies, quotes, avatars, and the forum logo are not the story cover.
        if ((getVozThreadPageNumber(url) || 1) !== 1 || Number(result.pagination?.currentPage || 1) !== 1) return null;
        const existing = valid(result.image);
        if (existing) return existing;
        const $ = load(content);
        const body = $('.voz-post').first().find('.voz-post-body').first();
        body.find('blockquote, .voz-quote, .reactionsBar, .voz-post-likes').remove();
        for (const image of body.find('img').toArray()) {
            const value = $(image).attr('data-url') || $(image).attr('data-src') || $(image).attr('src');
            const candidate = value && valid(decodeProxy(value));
            if (candidate && !/\/reactions?\//i.test(candidate)) return candidate;
        }
        return null;
    }
    return valid(result.image) || valid(extractImageFromHtml(content, url));
}
