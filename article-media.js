import * as cheerio from 'cheerio/slim';
import { decodeHTMLEntities } from './feed-parsers.js';

function safeHttpUrl(value) {
    try {
        const parsed = new URL(String(value || ''));
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch (e) {
        return '';
    }
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function isLikelyImageCaption(text = '') {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value || value.length > 360) return false;
    return (
        /(?:^|\s)(?:©|\(c\)|credit(?:s)?\s*:|photo\s*:|image\s*:|source\s*:|ảnh\s*:|nguồn\s*:|đồ họa\s*:|graphic\s*:|video\s*:)/iu.test(value) ||
        /(?:Getty Images|Reuters|Bloomberg|AFP|AP Photo|Financial Times|TTXVN|Tuổi Trẻ|Dân Trí|VnExpress|Thanh Niên)\s*$/iu.test(value)
    );
}

function isLikelyGraphicImage(image, selected = '') {
    const hint = [
        selected,
        image.attr('alt'),
        image.attr('title'),
        image.attr('class'),
        image.closest('figure').attr('class')
    ].filter(Boolean).join(' ');
    const isDecorativeAsset = /(?:logo|avatar|icon|badge|emoji|smilie)/i.test(hint);
    if (isDecorativeAsset) return false;

    return (
        /(?:chart|graphic|infographic|visuali[sz]ation|diagram|plot|datawrapper|flourish)/i.test(hint) ||
        /images\.ft\.com\/v3\/image\/raw\/https%3a%2f%2f[^?]+-standard\.png/i.test(selected) ||
        /\.(?:svg)(?:$|[?#])/i.test(selected)
    );
}

function addClass(node, className) {
    const classes = new Set(String(node.attr('class') || '').split(/\s+/).filter(Boolean));
    classes.add(className);
    node.attr('class', [...classes].join(' '));
}

export function normalizeArticleMediaMarkup(markup, pageUrl = '') {
    const source = String(markup || '');
    if (!source || !/<(?:img|picture|figure)\b/i.test(source)) return source;

    try {
        const $ = cheerio.load(source, null, false);
        let baseUrl = null;
        try { baseUrl = new URL(pageUrl); } catch (e) { }

        const resolveImageUrl = value => {
            const decoded = decodeHTMLEntities(String(value || '').trim());
            if (!decoded || /^data:/i.test(decoded) || /^blob:/i.test(decoded)) return '';
            // Reader-owned image endpoints must stay relative to this app.
            // Resolving them against the publisher URL would incorrectly turn
            // /api/og-image into https://publisher.example/api/og-image.
            if (/^\/api\/(?:og-image|proxy-image)\?/i.test(decoded)) return decoded;
            try {
                return safeHttpUrl(baseUrl ? new URL(decoded, baseUrl).href : decoded);
            } catch (e) {
                return '';
            }
        };

        const bestSrcsetUrl = value => {
            let best = { url: '', score: -1, order: -1 };
            String(value || '').split(',').forEach((candidate, order) => {
                const match = candidate.trim().match(/^(\S+)(?:\s+([0-9.]+)(w|x))?$/i);
                if (!match) return;
                const url = resolveImageUrl(match[1]);
                if (!url) return;
                const amount = Number(match[2] || 1);
                const score = match[3]?.toLowerCase() === 'x' ? amount * 10000 : amount;
                if (score > best.score || (score === best.score && order > best.order)) {
                    best = { url, score, order };
                }
            });
            return best.url;
        };

        $('picture').each((_, element) => {
            const picture = $(element);
            let image = picture.find('img').first();
            let pictureCandidate = '';
            picture.find('source').each((__, sourceElement) => {
                const sourceNode = $(sourceElement);
                pictureCandidate ||= bestSrcsetUrl(sourceNode.attr('data-srcset') || sourceNode.attr('srcset'));
            });

            if (!image.length && pictureCandidate) {
                image = $('<img>');
                picture.append(image);
            }
            if (!image.length) {
                picture.remove();
                return;
            }

            const imageCandidate = bestSrcsetUrl(image.attr('data-srcset') || image.attr('srcset'));
            const lazyCandidate = resolveImageUrl(
                image.attr('data-large-src') || image.attr('data-original') || image.attr('data-original-src') ||
                image.attr('data-src') || image.attr('data-url') || image.attr('data-zoom-image') ||
                image.attr('data-img-src') || image.attr('data-lazy-src')
            );
            const currentCandidate = resolveImageUrl(image.attr('src'));
            const selected = imageCandidate || pictureCandidate || lazyCandidate || currentCandidate;
            if (selected) {
                image.attr('src', selected);
                [
                    'data-large-src', 'data-original', 'data-original-src', 'data-src', 'data-url',
                    'data-zoom-image', 'data-img-src', 'data-lazy-src', 'data-srcset', 'srcset'
                ].forEach(attribute => image.removeAttr(attribute));
            }
            picture.replaceWith(image);
        });

        $('figure').each((_, element) => {
            const figure = $(element);
            figure.removeAttr('style');
            figure.find('.fig-picture').removeAttr('style');
            if (!figure.find('figcaption').length) {
                const caption = figure.find('[class*="caption"], [data-testid*="caption"]').first();
                if (caption.length && isLikelyImageCaption(caption.text())) {
                    caption.replaceWith(`<figcaption>${caption.html() || escapeHtml(caption.text().trim())}</figcaption>`);
                }
            }
            if (!figure.find('img').length) {
                const metadataUrl = resolveImageUrl(figure.find('meta[itemprop="url"]').first().attr('content'));
                if (metadataUrl) {
                    const alt = figure.find('figcaption').first().text().replace(/\s+/g, ' ').trim();
                    figure.prepend(`<img src="${escapeHtml(metadataUrl)}"${alt ? ` alt="${escapeHtml(alt)}"` : ''}>`);
                }
            }
        });

        $('img').each((_, element) => {
            const image = $(element);
            const srcsetCandidate = bestSrcsetUrl(image.attr('data-srcset') || image.attr('srcset'));
            const lazyCandidate = resolveImageUrl(
                image.attr('data-large-src') || image.attr('data-original') || image.attr('data-original-src') ||
                image.attr('data-src') || image.attr('data-url') || image.attr('data-zoom-image') ||
                image.attr('data-img-src') || image.attr('data-lazy-src')
            );
            const currentCandidate = resolveImageUrl(image.attr('src'));
            const figureCandidate = resolveImageUrl(image.closest('figure').find('meta[itemprop="url"]').first().attr('content'));
            const selected = srcsetCandidate || lazyCandidate || currentCandidate || figureCandidate;
            if (!selected) {
                image.remove();
                return;
            }

            image.attr('src', selected);
            image.removeAttr('style');
            image.removeAttr('srcset');
            image.removeAttr('data-srcset');
            [
                'data-large-src', 'data-original', 'data-original-src', 'data-src', 'data-url',
                'data-zoom-image', 'data-img-src', 'data-lazy-src', 'data-width', 'intrinsicsize'
            ].forEach(attribute => image.removeAttr(attribute));
            const normalizedClasses = String(image.attr('class') || '')
                .split(/\s+/)
                .filter(className => className && !/^(?:lazy|lazyload|lazyloaded|loading)$/i.test(className))
                .join(' ');
            if (normalizedClasses) image.attr('class', normalizedClasses);
            else image.removeAttr('class');
            image.attr('loading', 'lazy');
            image.attr('decoding', 'async');
            image.attr('referrerpolicy', 'no-referrer');

            if (isLikelyGraphicImage(image, selected)) {
                addClass(image, 'article-graphic-image');
                const graphicContainer = image.closest('figure, p');
                if (graphicContainer.length) addClass(graphicContainer, 'article-graphic-figure');
            }

            if (/images\.ft\.com\/v3\/image\/raw\/https%3a%2f%2f[^?]+-standard\.png/i.test(selected)) {
                addClass(image, 'ft-chart-image');
                const container = image.closest('figure, p');
                if (container.length) addClass(container, 'ft-chart-figure');
            }
        });

        $('figure').each((_, element) => {
            const figure = $(element);
            if (!figure.find('img, video, iframe').length) return;
            addClass(figure, 'article-media-figure');
            if (figure.find('.article-graphic-image, .article-graphic-embed').length) {
                addClass(figure, 'article-graphic-figure');
            }

            if (!figure.find('figcaption').length) {
                const captionNode = figure.next('p, div').first();
                const captionText = captionNode.text().replace(/\s+/g, ' ').trim();
                if (captionNode.length && !captionNode.find('img,video,audio,iframe').length && isLikelyImageCaption(captionText)) {
                    figure.append(`<figcaption>${captionNode.html() || escapeHtml(captionText)}</figcaption>`);
                    captionNode.remove();
                }
            }
        });

        // Reader services commonly flatten a semantic <figure> into two
        // adjacent paragraphs: one containing only the image, followed by its
        // caption. Restore the relationship so captions receive the same
        // typography and spacing across publishers.
        $('p').each((_, element) => {
            const imageParagraph = $(element);
            if (imageParagraph.closest('figure').length) return;
            const images = imageParagraph.find('img');
            if (images.length !== 1 || imageParagraph.text().trim()) return;

            const captionParagraph = imageParagraph.next('p');
            const captionText = captionParagraph.text().replace(/\s+/g, ' ').trim();
            if (!captionParagraph.length || captionParagraph.find('img,video,audio,iframe').length || !isLikelyImageCaption(captionText)) return;

            const figureClasses = ['article-media-figure'];
            if (images.first().hasClass('article-graphic-image')) figureClasses.push('article-graphic-figure');
            if (images.first().hasClass('ft-chart-image')) figureClasses.push('ft-chart-figure');
            const figure = $(`<figure class="${figureClasses.join(' ')}"></figure>`);
            figure.append(imageParagraph.contents());
            figure.append(`<figcaption>${captionParagraph.html() || escapeHtml(captionText)}</figcaption>`);
            imageParagraph.replaceWith(figure);
            captionParagraph.remove();
        });

        return $.html();
    } catch (e) {
        return source;
    }
}
