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

function safeHttpUrl(value = '') {
    try {
        const url = new URL(decodeHTML(String(value || '')));
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (error) {
        return '';
    }
}

function markdownImage(line = '') {
    const match = String(line).match(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/i);
    if (!match) return null;
    return {
        alt: cleanText(match[1]).replace(/^Image\s+\d+\s*:\s*/i, ''),
        url: safeHttpUrl(match[2])
    };
}

function apImageIdentity(value = '') {
    const safe = safeHttpUrl(value);
    if (!safe) return '';
    try {
        const url = new URL(safe);
        const original = url.searchParams.get('url');
        return safeHttpUrl(original ? decodeURIComponent(original) : '') || safe;
    } catch (error) {
        return safe;
    }
}

export function isInvalidApImage(value = '') {
    const url = safeHttpUrl(value);
    if (!url) return true;
    if (/(?:veifora-comment-icon|\/author\/|avatar|profile|logo|icon)/i.test(url)) return true;
    const resize = url.match(/\/resize\/(\d+)x(\d+)!/i);
    if (resize && (Number(resize[1]) < 240 || Number(resize[2]) < 180)) return true;
    return false;
}

function extractShareImage(markdown = '') {
    const match = String(markdown).match(/[?&]media=([^)&\s]+)/i);
    if (!match) return '';
    try {
        const image = safeHttpUrl(decodeURIComponent(match[1]));
        return image && !isInvalidApImage(image) ? image : '';
    } catch (error) {
        return '';
    }
}

function extractAuthor(markdown = '') {
    const linked = String(markdown).match(/^\s*By\s*\[([^\]\n]{2,100})\]\(https?:\/\/(?:www\.)?apnews\.com\/author\/[^)]+\)\s*$/im);
    if (linked) return cleanText(linked[1]);
    return cleanText(String(markdown).match(/^\s*By\s+([^\n]{2,100})\s*$/im)?.[1] || '');
}

function isApShareLine(line = '') {
    const text = cleanText(line);
    return /^\[\]\(https?:\/\/(?:www\.)?apnews\.com\/article\/[^)]+\)\s*$/i.test(line.trim())
        || /Add AP News (?:on|as your preferred source)/i.test(text)
        || /^(?:Share|Read More)$/i.test(text)
        || /^(?:Sign up for .+|Email address|Sign up)$/i.test(text)
        || /^!\[[^\]]*Comments[^\]]*\]/i.test(line.trim())
        || /^[-*+]\s+(?:\[(?:Facebook|Email|X|LinkedIn|Bluesky|Flipboard|Pinterest|Reddit)\]|(?:Copy Link copied|Print)\b)/i.test(line.trim());
}

function isRelatedStoryLine(line = '') {
    const text = cleanText(line);
    return !text
        || /^\[/.test(line.trim())
        || /^\d+\s+MIN READ$/i.test(text)
        || /^Read More$/i.test(text);
}

function firstArticleLine(lines, authorLineIndex) {
    const searchStart = Math.max(0, authorLineIndex + 1);
    const dateline = lines.findIndex((line, index) => index >= searchStart
        && /^[A-Z][A-Z .’'()-]{1,80}(?:\s+\(AP\))?\s+—\s+\S/.test(cleanText(line)));
    if (dateline >= 0) return dateline;

    return lines.findIndex((line, index) => {
        if (index < searchStart || isApShareLine(line)) return false;
        const text = cleanText(line);
        return text.length >= 120
            && !/^(?:Updated|Leer en espa|\d+\s+of\s+\d+)/i.test(text)
            && !/^(?:#|\[|!\[|[-*+]\s+)/.test(line.trim());
    });
}

export function cleanApReaderMarkdown(markdown = '') {
    const original = String(markdown || '');
    const author = extractAuthor(original);
    const shareImage = extractShareImage(original);
    const originalLines = original.split(/\r?\n/);
    const authorLineIndex = originalLines.findIndex(line => /https?:\/\/(?:www\.)?apnews\.com\/author\//i.test(line));
    const start = firstArticleLine(originalLines, authorLineIndex);
    if (start < 0) {
        return { markdown: original.trim(), author, image: shareImage, readerType: 'ap-article' };
    }

    let lines = originalLines.slice(start);
    const conversations = lines.findIndex(line => /^\s*#{1,4}\s+Active Conversations\s*$/i.test(line));
    if (conversations >= 0) lines = lines.slice(0, conversations);
    const authorCard = lines.findIndex(line => /^\s*\[?!\[[^\]]*\]\([^)]*\)\]?\(https?:\/\/(?:www\.)?apnews\.com\/author\//i.test(line)
        || /^\s*\[[^\]]+\]\(https?:\/\/(?:www\.)?apnews\.com\/author\/[^)]+\)\s*$/i.test(line));
    if (authorCard >= 0) lines = lines.slice(0, authorCard);

    const output = [];
    const seenImages = new Set();
    let skippingRelated = false;
    let skippedDuplicateCaption = '';

    for (const rawLine of lines) {
        const line = rawLine.trim();
        const text = cleanText(line);

        if (/^Related Stories$/i.test(text)) {
            skippingRelated = true;
            continue;
        }
        if (skippingRelated) {
            if (isRelatedStoryLine(line)) continue;
            skippingRelated = false;
        }
        if (isApShareLine(line)) continue;
        if (!text) {
            output.push(rawLine);
            continue;
        }

        const image = markdownImage(line);
        if (image) {
            if (!image.url || isInvalidApImage(image.url)) continue;
            const identity = apImageIdentity(image.url);
            if (seenImages.has(identity)) {
                skippedDuplicateCaption = image.alt;
                continue;
            }
            seenImages.add(identity);
            skippedDuplicateCaption = '';
            const alt = image.alt || 'AP News article image';
            output.push(`![${alt.replace(/[\[\]]/g, '')}](${image.url})`);
            continue;
        }

        if (skippedDuplicateCaption && (text === skippedDuplicateCaption
            || /(?:AP Photo|Associated Press|AP video|AP Production)/i.test(text))) {
            skippedDuplicateCaption = '';
            continue;
        }
        skippedDuplicateCaption = '';
        output.push(rawLine);
    }

    return {
        markdown: output.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
        author,
        image: shareImage,
        readerType: 'ap-article'
    };
}

export function cleanApArticleHtml(content = '') {
    const source = String(content || '').trim();
    if (!source || /(?:Keyboard Shortcuts|Subtitle Settings|More Videos)/i.test(cleanText(source))) return source;

    const $ = cheerio.load(`<main id="ap-reader-root">${source}</main>`, null, false);
    const root = $('#ap-reader-root');
    root.find('p').each((_, element) => {
        const imageParagraph = $(element);
        if (imageParagraph.closest('figure').length) return;
        const images = imageParagraph.find('img');
        if (images.length !== 1 || cleanText(imageParagraph.text())) return;

        const captionParagraph = imageParagraph.next('p');
        if (!captionParagraph.length || captionParagraph.find('img, video, audio, iframe').length) return;
        const caption = cleanText(captionParagraph.text());
        const alt = cleanText(images.first().attr('alt'));
        if (!caption || (caption !== alt && !/(?:AP Photo|Associated Press|AP video|AP Production)/i.test(caption))) return;

        const figure = $('<figure class="article-media-figure apnews-figure"></figure>');
        figure.append(imageParagraph.contents());
        figure.append(`<figcaption>${captionParagraph.html() || caption}</figcaption>`);
        imageParagraph.replaceWith(figure);
        captionParagraph.remove();
    });
    return root.html().trim();
}

export default class ApnewsSource {
    match(hostname) {
        return hostname === 'apnews.com' || hostname.endsWith('.apnews.com');
    }

    isInvalidFeedImage(url) {
        return isInvalidApImage(url);
    }

    async getBestImage(targetUrl, fetchFn, rssFallback, { extractImageFromHtml, isInvalidImage, CF_PROXY_BASE }) {
        if (rssFallback && !isInvalidImage(rssFallback) && !isInvalidApImage(rssFallback)) return rssFallback;
        try {
            const res = await fetchFn(CF_PROXY_BASE + encodeURIComponent(targetUrl));
            if (res.ok) {
                const html = await res.text();
                const ogMatch = html.match(/<meta property=["']og:image["'] content=["']([^"']+)["']/i);
                if (ogMatch && !isInvalidImage(ogMatch[1]) && !isInvalidApImage(ogMatch[1])) return ogMatch[1];
                const extracted = extractImageFromHtml(html, targetUrl);
                return extracted && !isInvalidApImage(extracted) ? extracted : null;
            }
        } catch (error) { }
        return null;
    }

    preProcessHtml(html) {
        let videosHtml = '';
        const videoJsonMatch = html.match(/<script type="application\/ld\+json" id="video-ld-json">([\s\S]*?)<\/script>/);
        if (videoJsonMatch) {
            try {
                const videoData = JSON.parse(videoJsonMatch[1]);
                const list = Array.isArray(videoData.list) ? videoData.list : (Array.isArray(videoData) ? videoData : [videoData]);
                for (const video of list) {
                    if (video.contentUrl) {
                        videosHtml += `<figure><video controls src="${video.contentUrl}" style="width: 100%; max-width: 100%; height: auto;"></video></figure>`;
                    }
                }
            } catch (error) { }
        }

        let cleanedHtml = html;
        const originalImages = [...cleanedHtml.matchAll(/<img[^>]*src=["']https:\/\/dims\.apnews\.com[^"']*url=([^"'&]+)[^"']*["'][^>]*>/gi)];
        for (const match of originalImages) {
            const originalUrl = decodeURIComponent(match[1]);
            cleanedHtml = cleanedHtml.replace(match[0], match[0].replace(match[0].match(/src=["']([^"']+)["']/)[1], originalUrl));
        }

        if (videosHtml) {
            cleanedHtml = cleanedHtml.replace(/<div[^>]*class=["'][^"']*(?:ArticleBody|RichText)[^"']*["'][^>]*>/i, match => match + videosHtml);
        }
        return cleanedHtml;
    }

    parseJinaReaderText(markdown) {
        return cleanApReaderMarkdown(markdown);
    }

    parseOpenCliMarkdown(markdown) {
        return cleanApReaderMarkdown(markdown);
    }

    cleanCachedArticleContent(content) {
        return cleanApArticleHtml(content);
    }

    enhanceArticleResult(result) {
        const image = safeHttpUrl(result?.image);
        return {
            ...result,
            content: cleanApArticleHtml(result?.content || ''),
            image: image && !isInvalidApImage(image) ? image : '',
            author: cleanText(result?.author),
            siteName: 'AP News'
        };
    }

    isUsableArticleResult(result) {
        const text = cleanText(result?.content || '');
        return text.length >= 350
            && !/(?:Keyboard Shortcuts|Subtitle Settings|More Videos|Active Conversations|Related Stories)/i.test(text);
    }

    async parseArticleHtmlContent(html, url, result) {
        const authorJsonMatch = html.match(/"author":\s*\[?\s*\{[\s\S]{0,800}?"@type":\s*"Person"[\s\S]{0,800}?"name":\s*"([^"]+)"/i);
        if (authorJsonMatch?.[1]) result.author = cleanText(authorJsonMatch[1]);

        const dateMatch = html.match(/"datePublished":\s*"([^"]+)"/i);
        if (dateMatch) result.published = dateMatch[1];

        return false;
    }
}
