import * as cheerio from 'cheerio/slim';

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

export default class BaovanhoaSource {
    match(hostname) {
        return hostname === 'baovanhoa.vn' || hostname.endsWith('.baovanhoa.vn');
    }

    parseArticleHtmlContent(html, url, result) {
        const $ = cheerio.load(html);

        // `article:author` points to the publisher's Facebook page on Báo Văn
        // Hóa, so the visible byline is the authoritative author value.
        const author = normalizeText($('.detail__author').first().text());
        if (author) result.author = author;

        const content = $('.detail__content').first().clone();
        if (!content.length) return false;

        // Keep only the editorial body. These blocks contain the FPT Play
        // promotion, ad scripts, and post-article modules such as Google News,
        // related stories, tags, and comments.
        content.find([
            '.notification',
            '.detail__credit',
            '.adsitem',
            '.cms-ads',
            'script',
            'style',
            'template',
            'noscript',
            'form'
        ].join(',')).remove();

        content.find('img').each((index, element) => {
            const image = $(element);
            const original = image.attr('data-original') || image.attr('data-src');
            if (original) image.attr('src', original);
            image.removeAttr('data-original').removeAttr('data-src');
        });

        return content.html()?.trim() || false;
    }
}
