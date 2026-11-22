import { decodeHTML } from 'entities';
import { normalizeArticleSourceUrl } from './src/article-source-state.js';

export function decodeHTMLEntities(text) {
    if (!text) return '';
    return decodeHTML(String(text));
}

export function normalizeArticleTitle(value) {
    let title = String(value || '').trim();
    for (let pass = 0; pass < 3; pass++) {
        const decoded = decodeHTMLEntities(title);
        if (decoded === title) break;
        title = decoded;
    }
    return title.replace(/^\*\*([\s\S]*?)\*\*$/, '$1').trim();
}

export function fastParseRSS(xml) {
    const items = [];
    const itemRegex = /<(item|entry)[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;
    let count = 0;

    let feedTitle = null;
    const headerMatch = xml.split(/<(item|entry)/i)[0];
    if (headerMatch) {
        const titleMatch = headerMatch.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch) {
            feedTitle = decodeHTMLEntities(titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim());
        }
    }

    while ((match = itemRegex.exec(xml)) !== null && count < 20) {
        const block = match[2];
        const getTag = tag => {
            const regular = new RegExp(`<(${tag})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
            const regularMatch = block.match(regular);
            if (regularMatch) return regularMatch[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();

            const namespaced = new RegExp(`<([a-z0-9]+:${tag})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
            const namespacedMatch = block.match(namespaced);
            return namespacedMatch
                ? namespacedMatch[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim()
                : null;
        };

        const rawTitle = getTag('title');
        const title = rawTitle ? normalizeArticleTitle(rawTitle) : 'Untitled Article';

        let link = getTag('link');
        if (!link || link.includes('<')) {
            const linkMatch = block.match(/<link[^>]+href=["']([^"']+)["']/i);
            if (linkMatch) link = linkMatch[1];
        }
        if (link && link.startsWith('<![CDATA[')) {
            link = link.replace(/^<!\[CDATA\[/i, '').replace(/\]\]>$/, '').trim();
        }
        if (link) {
            link = normalizeArticleSourceUrl(decodeHTMLEntities(link));
        }

        const pubDate = getTag('pubDate') || getTag('updated') || getTag('published') || new Date().toISOString();
        const rawContent = getTag('content:encoded') || getTag('content') || getTag('description') || getTag('summary') || '';

        let imageUrl = null;
        const enclosure = block.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image\//i);
        if (enclosure) imageUrl = enclosure[1];
        if (!imageUrl) {
            const media = block.match(/<(?:media:content|media:thumbnail)[^>]+url=["']([^"']+)["']/i);
            if (media) imageUrl = media[1];
        }
        if (!imageUrl) {
            const image = rawContent.match(/<img[^>]+src=["']([^"']+)["']/i);
            if (image) imageUrl = image[1];
        }

        const content = decodeHTMLEntities(rawContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
        const slashComments = getTag('slash:comments');
        const replyCount = slashComments ? parseInt(slashComments) || 0 : 0;

        if (link) {
            items.push({ title, link, pubDate, content, imageUrl, replyCount });
            count++;
        }
    }

    return { items, feedTitle };
}
