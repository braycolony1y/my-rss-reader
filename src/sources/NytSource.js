import * as cheerio from 'cheerio/slim';
import { decodeHTML } from 'entities';

function cleanText(value = '') {
    return decodeHTML(String(value || ''))
        .replace(/<[^>]*>/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`#]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function titleCaseSlug(value = '') {
    return String(value || '').split('-').filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function extractNytAuthor(value = '') {
    const source = String(value || '');
    const markdown = source.match(/\[([^\]\n]{2,100})\]\(https?:\/\/(?:www\.)?nytimes\.com\/by\/[^)]+\)/i);
    if (markdown) return cleanText(markdown[1]);
    const html = source.match(/<a\b[^>]*href=["'][^"']*nytimes\.com\/by\/[^"']*["'][^>]*>([\s\S]{1,200}?)<\/a>/i);
    if (html) return cleanText(html[1]);
    try {
        const url = new URL(cleanText(source));
        const slug = url.pathname.match(/^\/by\/([^/]+)/i)?.[1];
        return slug ? titleCaseSlug(slug) : '';
    } catch (error) {
        return '';
    }
}

export function cleanNytArticleHtml(content = '') {
    const source = String(content || '').trim();
    if (!source) return '';
    const $ = cheerio.load(`<main id="nyt-reader-root">${source}</main>`, null, false);
    const root = $('#nyt-reader-root');

    const boundary = root.children().filter((_, element) => /^(?:See more on:|Read \d+ comments?\b|Related Content$)/i.test(cleanText($(element).text()))).first();
    if (boundary.length) {
        boundary.nextAll().remove();
        boundary.remove();
    }
    root.find('p,li').each((_, element) => {
        const node = $(element);
        const text = cleanText(node.text());
        if (/^(?:SKIP ADVERTISEMENT|Share full article)$/i.test(text)
            || (/\bis (?:an?\s+)?(?:senior\s+)?(?:staff\s+)?(?:reporter|correspondent|editor)\b/i.test(text)
                && /nytimes\.com\/by\//i.test(node.find('a').attr('href') || ''))) node.remove();
    });

    root.find('p').each((_, element) => {
        const imageParagraph = $(element);
        if (imageParagraph.closest('figure').length) return;
        const image = imageParagraph.find('img').first();
        if (!image.length) return;
        const captionParagraph = imageParagraph.next('p');
        const caption = cleanText(captionParagraph.text());
        const figure = $('<figure class="article-media-figure nyt-figure"></figure>');
        figure.append(image.clone());
        if (captionParagraph.length && /(?:Credit|Getty Images?|Associated Press|\bAP\b|Reuters|The New York Times)/i.test(caption)) {
            figure.append(`<figcaption>${captionParagraph.html()}</figcaption>`);
            captionParagraph.remove();
        }
        imageParagraph.replaceWith(figure);
    });

    root.find('p,ul').filter((_, element) => !cleanText($(element).text()) && !$(element).find('img,video,audio').length).remove();
    return root.html().trim();
}

function readerMetadata(markdown = '') {
    return {
        markdown: String(markdown || '').trim(),
        author: extractNytAuthor(markdown),
        readerType: 'nyt-article'
    };
}

export default class NytSource {
    match(hostname) {
        return hostname.includes('nytimes.com');
    }

    async getBestImage(targetUrl, fetchFn, rssFallback, { extractImageFromHtml, fetchWithCookies, isInvalidImage, CF_PROXY_BASE }) {
        if (rssFallback && !isInvalidImage(rssFallback)) return rssFallback;
        return null; // Will fallback to what article-extractor gets
    }

    preProcessHtml(html) {
        // Fix images
        let cleanedHtml = html;
        const pictureSources = [...cleanedHtml.matchAll(/<source[^>]*srcset=["']([^"']+)["'][^>]*>/gi)];
        for (const m of pictureSources) {
            const srcset = m[1];
            const bestImage = srcset.split(',').pop().trim().split(' ')[0];
            if (bestImage) {
                // Find parent picture and inject img
                // But extractArticle handles srcset sometimes. We just ensure there's an img.
            }
        }

        // Clean unnecessary info
        cleanedHtml = cleanedHtml.replace(/<div[^>]*class=["'][^"']*BottomAd[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
        return cleanedHtml;
    }

    parseJinaReaderText(markdown) {
        return readerMetadata(markdown);
    }

    parseOpenCliMarkdown(markdown) {
        return readerMetadata(markdown);
    }

    cleanCachedArticleContent(content) {
        return cleanNytArticleHtml(content);
    }

    enhanceArticleResult(result) {
        return {
            ...result,
            content: cleanNytArticleHtml(result?.content || ''),
            author: extractNytAuthor(result?.content || '') || extractNytAuthor(result?.author || '') || cleanText(result?.author),
            siteName: 'The New York Times',
            readerType: 'nyt-article'
        };
    }

    isUsableArticleResult(result) {
        const text = cleanText(result?.content || '');
        return text.length >= 350 && !/(?:SKIP ADVERTISEMENT|Related Content|Share full article)/i.test(text);
    }

    async parseArticleHtmlContent(html, url, result, utils) {
        // Find listen to article audio
        // Often NYT uses <audio src="..."> or embedded json
        const audioMatch = html.match(/<audio[^>]*src=["']([^"']+\.mp3)["']/i) || html.match(/"url":"([^"]+\.mp3)"/i);
        const $ = cheerio.load(String(html || ''));
        const body = $('[name="articleBody"], section[name="articleBody"], article section').filter((_, element) => cleanText($(element).text()).length >= 300).first();
        if (!body.length) return false;
        const audio = audioMatch?.[1]
            ? `<figure class="article-media-figure"><audio controls src="${audioMatch[1]}" style="width: 100%;"></audio></figure>`
            : '';
        return audio + body.html();
    }
}
