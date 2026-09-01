import { decodeHTML } from 'entities';

function cleanText(value = '') {
    return decodeHTML(String(value || ''))
        .replace(/<[^>]*>/g, ' ')
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

function isTheVergeHero(value = '') {
    const url = safeHttpUrl(value);
    return Boolean(url) && !/(?:author_profile_images|avatar|logo|icon|chorus_asset\/file\/\d+\/verge-logo)/i.test(url);
}

function markdownImage(line = '') {
    const match = String(line).match(/^\s*!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)\s*$/i);
    return match ? { alt: cleanText(match[1]), url: safeHttpUrl(match[2]) } : null;
}

function looksLikeAuthorBiography(value = '') {
    const text = cleanText(value);
    return /\b(?:is an? (?:senior |deput |former )?(?:writer|reporter|editor|reviewer)|covers? .+ for The Verge|started (?:her|his|their) career|posts? from this author|see all by|follow topics and authors)\b/i.test(text);
}

export function cleanTheVergeReaderMarkdown(markdown = '') {
    let source = String(markdown || '');
    const boundaries = [
        /^\s*\[Subscribe to The Verge\]/im,
        /^\s*\[\d+\s+Comments?\]\([^\n]+\)\s*$/im,
        /^\s*\*\*Follow topics and authors\*\*/im,
        /^\s*#{1,4}\s+Most Popular\s*$/im,
        /^\s*Most Popular\s*$/im
    ].map(pattern => source.search(pattern)).filter(index => index >= 0);
    if (boundaries.length) source = source.slice(0, Math.min(...boundaries));

    const author = cleanText(source.match(/^\s*(?:\*\*)?by\s+([^\n*]+)(?:\*\*)?\s*$/im)?.[1] || '');
    const lines = source.split(/\r?\n/);
    const bylineIndex = lines.findIndex(line => /^\s*(?:\*\*)?by\s+/i.test(line));
    let heroIndex = -1;
    let hero = null;
    for (let index = Math.max(0, bylineIndex); index < lines.length; index++) {
        const image = markdownImage(lines[index]);
        if (image?.url && isTheVergeHero(image.url)) {
            heroIndex = index;
            hero = image;
            break;
        }
    }

    let caption = '';
    let bodySearchStart = Math.max(bylineIndex + 1, 0);
    if (heroIndex >= 0) {
        let cursor = heroIndex;
        while (cursor < lines.length) {
            const image = markdownImage(lines[cursor]);
            if (!image || image.url !== hero.url) break;
            lines[cursor] = '';
            cursor++;
            while (cursor < lines.length && !lines[cursor].trim()) cursor++;
        }
        const captionParts = [];
        for (let index = cursor; index < Math.min(lines.length, cursor + 5); index++) {
            const text = lines[index].trim();
            if (!text) continue;
            const normalized = text.replace(/^[_*]+|[_*]+$/g, '').trim();
            if (captionParts.length === 0 || /^(?:Image|Photo|Illustration|Credit)\s*:/i.test(normalized)) {
                captionParts.push(normalized);
                lines[index] = '';
                continue;
            }
            break;
        }
        caption = cleanText(captionParts.join(' · '));
        bodySearchStart = cursor;
    }

    let bodyStart = -1;
    for (let index = bodySearchStart; index < lines.length; index++) {
        const text = lines[index].trim();
        if (!text || markdownImage(text) || /author_profile_images|\/authors\//i.test(text) || /^#{1,6}\s+/.test(text) || /^\[?(?:See All by|Follow)\b/i.test(text)) continue;
        const plain = cleanText(text.replace(/^[_*]+|[_*]+$/g, ''));
        if (plain.length < 90 || looksLikeAuthorBiography(plain)) continue;
        bodyStart = index;
        break;
    }

    if (bodyStart < 0) bodyStart = Math.max(heroIndex + 1, bylineIndex + 1, 0);
    source = lines.slice(bodyStart)
        .filter(line => {
            const image = markdownImage(line);
            return !/(?:author_profile_images|avatar)/i.test(line) && (!image || !/(?:author_profile_images|avatar)/i.test(image.url));
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return {
        markdown: source,
        author,
        image: hero?.url || '',
        imageCaption: caption,
        readerType: 'the-verge-article'
    };
}

export default class TheVergeSource {
    match(hostname) {
        return hostname === 'theverge.com' || hostname.endsWith('.theverge.com');
    }

    parseJinaReaderText(markdown) {
        return cleanTheVergeReaderMarkdown(markdown);
    }

    parseOpenCliMarkdown(markdown) {
        return cleanTheVergeReaderMarkdown(markdown);
    }

    parseArticleHtmlContent(html, url, result) {
        let theVergeHtml = '';
        const classRegex = new RegExp('<div\\b[^>]*class=["\'][^"\']*duet--article--article-body-component[^"\']*["\'][^>]*>', 'ig');
        let startMatch;
        while ((startMatch = classRegex.exec(html)) !== null) {
            const index = startMatch.index;
            const tagRegex = /<\/?div\b/ig;
            tagRegex.lastIndex = index + startMatch[0].length;
            let depth = 1;
            let match;
            while ((match = tagRegex.exec(html)) !== null) {
                if (match[0].startsWith('</')) depth--; else depth++;
                if (depth === 0) {
                    theVergeHtml += html.substring(index, match.index + match[0].length + 1) + '\n';
                    classRegex.lastIndex = match.index + match[0].length;
                    break;
                }
            }
        }
        let articleHtml = '';
        if (theVergeHtml) {
            articleHtml = theVergeHtml;
            articleHtml = articleHtml.replace(/class=["']([^"']*duet--article--scorecard[^"']*)["']/gi, 'class="$1 bg-gray-100 dark:bg-[#252525] p-6 rounded-2xl shadow-sm my-8 border border-gray-200 dark:border-gray-700"');
            articleHtml = articleHtml.replace(/class=["']([^"']*duet--article--highlight[^"']*)["']/gi, 'class="$1 bg-gray-50 dark:bg-[#2a2a2a] p-6 rounded-xl border border-gray-200 dark:border-gray-700 my-6 shadow-sm"');
            articleHtml = articleHtml.replace(/class=["']([^"']*duet--article--dangerously-set-cms-markup[^"']*)["']/gi, 'class="$1 prose dark:prose-invert max-w-none"');
        } else {
            const match = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
            if (match) articleHtml = match[1];
        }
        result.siteName = result.siteName || 'The Verge';
        return articleHtml;
    }
}
