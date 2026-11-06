import { load } from 'cheerio';
import { decodeProxy } from '../utils/article-utils.js';
import { getVozThreadPageNumber } from '../voz-thread-state.js';

function isInlineImage(image) {
    if (image.is('.voz-small-img, .smilie')
        || image.closest('.voz-small-img-wrapper').length) return true;
    const width = Number(image.attr('width'));
    const height = Number(image.attr('height'));
    // Match the reader's small-image classification without rejecting tall
    // photographs, unknown dimensions, or GIFs simply because of their format.
    return width > 0 && width <= 150 && (!height || height <= 150);
}

export function getVozThumbnail(url, result, valid) {
    if ((getVozThreadPageNumber(url) || 1) !== 1
        || Number(result.pagination?.currentPage || 1) !== 1) return null;
    const $ = load(result.content || '');
    const body = $('.voz-post').first().find('.voz-post-body').first();
    body.find('blockquote, .voz-quote, .reactionsBar, .voz-post-likes').remove();
    const excluded = new Set();
    const candidates = [];
    for (const element of body.find('img').toArray()) {
        const image = $(element);
        const value = image.attr('data-url') || image.attr('data-src') || image.attr('src');
        const candidate = value && valid(decodeProxy(value));
        if (!candidate) continue;
        if (isInlineImage(image) || /\/reactions?\//i.test(candidate)) excluded.add(candidate);
        else candidates.push(candidate);
    }
    const existing = valid(result.image && decodeProxy(result.image));
    return existing && !excluded.has(existing) ? existing : candidates[0] || null;
}

export function versionVozThumbnailUrl(image) {
    if (!/^\/api\/og-image\?/.test(image || '')) return image;
    const url = new URL(image, 'http://reader.local');
    // Previously issued permanent redirects can otherwise keep showing the
    // inline GIF even after the server selects the correct photograph.
    url.searchParams.set('cover', '2');
    return url.pathname + url.search;
}
