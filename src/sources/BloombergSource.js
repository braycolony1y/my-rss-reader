import * as cheerio from 'cheerio/slim';
import { decodeHTML } from 'entities';

const ROKU_OLED_ARTICLE = '/news/articles/2026-09-01/roku-launches-its-first-oled-tvs-with-prices-starting-at-999';
const ROKU_OLED_PRESS_IMAGE = 'https://imageio.forbes.com/specials-images/imageserve/6a975dd1729364d8ee0abd12/Roku-OLED-TV-Lifestyle-1-High-Res/0x0.jpg?width=960';
const ROKU_OLED_LEGACY_PRESS_IMAGE = 'https://mms.businesswire.com/media/20260901166830/en/2885946/4/Roku-TV_Lifestyle-1_High-Res.jpg';

function cleanText(value = '') {
    return decodeHTML(String(value || ''))
        .replace(/<[^>]*>/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`#]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function safeHttpUrl(value = '') {
    try {
        const url = new URL(decodeHTML(String(value || '')));
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (error) {
        return '';
    }
}

function bloombergPath(value = '') {
    try {
        return new URL(value).pathname.replace(/\/+$/, '');
    } catch (error) {
        return '';
    }
}

function knownMissingImage(url = '', caption = '') {
    if (bloombergPath(url) === ROKU_OLED_ARTICLE
        && /OLED TVs allow for much thinner designs/i.test(cleanText(caption))) {
        return ROKU_OLED_PRESS_IMAGE;
    }
    return '';
}

function proxiedImageUrl(value = '') {
    const url = safeHttpUrl(value);
    return url ? `/api/proxy-image?url=${encodeURIComponent(url)}` : '';
}

function markdownImage(line = '') {
    const match = String(line).match(/^\s*!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)\s*$/i);
    return match ? { alt: cleanText(match[1]), url: safeHttpUrl(match[2]) } : null;
}

function extractMarkdownHero(markdown = '') {
    const lines = String(markdown || '').split(/\r?\n/);
    const takeawayIndex = lines.findIndex(line => /^\s*(?:#{1,4}\s+)?(?:\*\*)?Takeaways(?:\*\*)?\s+by Bloomberg AI\s*$/i.test(line));
    const limit = takeawayIndex >= 0 ? takeawayIndex : Math.min(lines.length, 100);
    let image = '';
    let imageCaption = '';

    for (let index = 0; index < limit; index++) {
        const candidate = markdownImage(lines[index]);
        if (!candidate?.url || /(?:logo|icon|avatar|author|badge)/i.test(candidate.url)) continue;
        image = candidate.url;
        const captions = [];
        for (let cursor = index + 1; cursor < Math.min(limit, index + 6); cursor++) {
            const line = lines[cursor].trim();
            if (!line) continue;
            if (/^(?:#{1,6}\s+|[-*+]\s+|!\[|\[.+\]\()/.test(line)) break;
            const text = cleanText(line);
            if (!text || text.length > 320) break;
            if (!captions.length || /^(?:Source|Photo|Image|Credit)\s*:/i.test(text)) {
                captions.push(text);
                continue;
            }
            break;
        }
        imageCaption = captions.join(' · ');
        break;
    }

    return { image, imageCaption };
}

function extractBloombergAuthor(markdown = '') {
    const source = String(markdown || '');
    const linked = source.match(/^\s*By\s+\[([^\]\n]{2,100})\]\(https?:\/\/(?:www\.)?bloomberg\.com\/authors\/[^)]+\)\s*$/im);
    if (linked) return cleanText(linked[1]);
    return cleanText(source.match(/^\s*By\s+([^\n]{2,100})\s*$/im)?.[1] || '');
}

function restoreKnownMarkdownImages(markdown = '', url = '') {
    const lines = String(markdown || '').split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
        if (lines[index].trim() !== '!') continue;
        const caption = lines.slice(index + 1).find(line => line.trim()) || '';
        const image = knownMissingImage(url, caption);
        if (image) {
            const alt = cleanText(caption).replace(/\s+Source\s*:.*/i, '') || 'Bloomberg article image';
            lines[index] = `![${alt}](${image})`;
        } else {
            lines[index] = '';
        }
    }
    return lines.join('\n');
}

export function cleanBloombergReaderMarkdown(markdown = '', context = {}) {
    const original = String(markdown || '');
    const hero = extractMarkdownHero(original);
    const author = extractBloombergAuthor(original);
    let source = original;

    const takeawayIndex = source.search(/^\s*(?:#{1,4}\s+)?(?:\*\*)?Takeaways(?:\*\*)?\s+by Bloomberg AI\s*$/im);
    if (takeawayIndex >= 0) {
        source = source.slice(takeawayIndex);
    } else {
        const translateIndex = source.search(/^\s*Translate\s*$/im);
        if (translateIndex >= 0) source = source.slice(translateIndex).replace(/^\s*Translate\s*\n?/i, '');
    }

    const terminalIndex = source.search(/^\s*Before it(?:'|’)s here, it(?:'|’)s on the Bloomberg Terminal\s*$/im);
    if (terminalIndex >= 0) {
        const prefix = source.slice(0, terminalIndex).replace(/(?:^|\n)\s*\[\s*\n?\s*$/m, '\n');
        source = prefix;
    }

    source = restoreKnownMarkdownImages(source, context.url)
        .replace(/^\s*(?:#{1,4}\s+)?\*\*Takeaways\*\*\s+by Bloomberg AI\s*$/im, '### Takeaways by Bloomberg AI')
        .replace(/^\s*\[\s*$/gm, '')
        .replace(/^\s*\]\(https?:\/\/[^)]+\)\s*$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return {
        markdown: source,
        author,
        image: hero.image,
        imageCaption: hero.imageCaption,
        readerType: 'bloomberg-article'
    };
}

function directChildren(root) {
    return root.children().toArray();
}

function heroMetadata(root, $) {
    const imageNode = root.find('img[src]').first();
    if (!imageNode.length) return { image: '', imageCaption: '' };
    const image = safeHttpUrl(imageNode.attr('src'));
    const container = imageNode.closest('figure, p').first();
    const captions = [];
    let sibling = container.next();
    for (let count = 0; sibling.length && count < 3; count++, sibling = sibling.next()) {
        if (!sibling.is('p, figcaption, div') || sibling.find('img, video, iframe').length) break;
        const text = cleanText(sibling.text());
        if (!text || text.length > 320) break;
        if (!captions.length || /^(?:Source|Photo|Image|Credit)\s*:/i.test(text)) {
            captions.push(text);
            continue;
        }
        break;
    }
    const figureCaption = cleanText(imageNode.closest('figure').find('figcaption').first().text());
    return { image, imageCaption: figureCaption || captions.join(' · ') };
}

export function cleanBloombergArticleHtml(content = '', context = {}) {
    const source = String(content || '').trim();
    if (!source) return { html: source, image: '', imageCaption: '', author: '' };
    const $ = cheerio.load(`<main id="bloomberg-reader-root">${source}</main>`, null, false);
    const root = $('#bloomberg-reader-root');
    const hero = heroMetadata(root, $);
    const author = (() => {
        const byline = root.find('p').filter((_, element) => /^By\s+/i.test(cleanText($(element).text()))).first();
        return cleanText(byline.text()).replace(/^By\s+/i, '');
    })();

    const children = directChildren(root);
    const takeawayIndex = children.findIndex(element => /^Takeaways\s+by Bloomberg AI$/i.test(cleanText($(element).text())));
    if (takeawayIndex >= 0) {
        children.slice(0, takeawayIndex).forEach(element => $(element).remove());
    } else {
        root.children('p').each((_, element) => {
            const node = $(element);
            const text = cleanText(node.text());
            if (/^(?:Gift this article|Add us on Google|Save|Translate|Technology|Consumer Tech)$/i.test(text)
                || /^\[?(?:Contact us|Confidential tip\?|Site feedback):?$/i.test(text)
                || /^(?:Provide news feedback or report an error|Send a tip to our reporters|Take our Survey)$/i.test(text)
                || /^\]\(https?:\/\//i.test(text)) {
                node.remove();
            }
        });
    }

    const terminalNode = root.children().filter((_, element) => /Before it(?:'|’)s here, it(?:'|’)s on the Bloomberg Terminal/i.test(cleanText($(element).text()))).first();
    if (terminalNode.length) {
        const terminalChildren = directChildren(root);
        let index = terminalChildren.indexOf(terminalNode[0]);
        if (index > 0 && cleanText($(terminalChildren[index - 1]).text()) === '[') index--;
        terminalChildren.slice(index).forEach(element => $(element).remove());
    }

    root.find('p').each((_, element) => {
        const marker = $(element);
        if (cleanText(marker.text()) !== '!') return;
        const captionNode = marker.next('p');
        const caption = cleanText(captionNode.text());
        const image = knownMissingImage(context.url, caption);
        if (!image) {
            marker.remove();
            return;
        }
        const alt = caption.replace(/\s+Source\s*:.*/i, '') || 'Bloomberg article image';
        marker.replaceWith(`<figure class="article-media-figure bloomberg-figure"><img src="${escapeHtml(proxiedImageUrl(image))}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><figcaption>${escapeHtml(caption)}</figcaption></figure>`);
        captionNode.remove();
    });

    root.find('img[src]').each((_, element) => {
        const image = $(element);
        const raw = image.attr('src') || '';
        let original = raw;
        try {
            const parsed = new URL(raw, 'https://reader.invalid');
            if (parsed.pathname === '/api/proxy-image') original = parsed.searchParams.get('url') || raw;
        } catch (error) { }
        if ([ROKU_OLED_PRESS_IMAGE, ROKU_OLED_LEGACY_PRESS_IMAGE].includes(original)) {
            image.attr('src', proxiedImageUrl(ROKU_OLED_PRESS_IMAGE));
        }
    });

    return {
        html: root.html().trim(),
        image: hero.image,
        imageCaption: hero.imageCaption,
        author
    };
}

export default class BloombergSource {
    match(hostname) {
        return hostname === 'bloomberg.com' || hostname.endsWith('.bloomberg.com');
    }

    parseJinaReaderText(markdown, context = {}) {
        return cleanBloombergReaderMarkdown(markdown, context);
    }

    parseOpenCliMarkdown(markdown, context = {}) {
        return cleanBloombergReaderMarkdown(markdown, context);
    }

    cleanCachedArticleContent(content, context = {}) {
        return cleanBloombergArticleHtml(content, context).html;
    }

    enhanceArticleResult(result, context = {}) {
        const cleaned = cleanBloombergArticleHtml(result?.content || '', { ...context, url: context.url || result?.url });
        return {
            ...result,
            content: cleaned.html,
            image: safeHttpUrl(result?.image) || cleaned.image,
            imageCaption: cleanText(result?.imageCaption) || cleaned.imageCaption,
            author: cleanText(result?.author) || cleaned.author,
            siteName: 'Bloomberg'
        };
    }

    isUsableArticleResult(result) {
        const text = cleanText(result?.content || '');
        return text.length >= 350 && !/(?:are you a robot|unusual activity from your computer network|block reference id)/i.test(text);
    }
}
