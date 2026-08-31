import * as cheerio from 'cheerio/slim';
import { decodeHTML } from 'entities';

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
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (error) {
        return '';
    }
}

function canonicalFtContentUrl(value = '') {
    const safe = safeHttpUrl(value);
    if (!safe) return '';
    const url = new URL(safe);
    for (const key of [...url.searchParams.keys()]) {
        if (/^syn-/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
}

function plainText(value = '') {
    return decodeHTML(String(value).replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}

const FOOTER_MARKERS = [
    /^\s*\[Reuse this content\b/im,
    /^\s*#{1,4}\s+Follow the topics in this article\s*$/im,
    /^\s*#{1,4}\s+Latest on\b/im,
    /^\s*#{1,4}\s+Comments?\s*$/im
];

function truncateAtFirstFooter(markdown) {
    const boundaries = FOOTER_MARKERS
        .map(pattern => markdown.search(pattern))
        .filter(index => index >= 0);
    return boundaries.length ? markdown.slice(0, Math.min(...boundaries)) : markdown;
}

function removeMultilineShareLinks(lines) {
    const cleaned = [];

    for (let index = 0; index < lines.length; index++) {
        if (!/^\s*-\s+\[\s*$/.test(lines[index])) {
            cleaned.push(lines[index]);
            continue;
        }

        let end = index + 1;
        while (end < lines.length && end <= index + 8 && !/^\s*-\s+\[\s*$/.test(lines[end])) {
            if (/\)\s*$/.test(lines[end])) break;
            end++;
        }
        const block = lines.slice(index, Math.min(end + 1, lines.length)).join(' ');
        const isShareControl = /\bon\s+(?:x|facebook|linkedin|whatsapp)\s+\(opens in a new window\)\]\((?:https?:\/\/(?:twitter\.com|www\.facebook\.com|www\.linkedin\.com)\/|whatsapp:\/\/)/i.test(block);
        if (isShareControl) {
            index = end;
            continue;
        }
        cleaned.push(lines[index]);
    }

    return cleaned;
}

function removeFtPageChrome(lines) {
    const chromeStart = lines.findIndex(line =>
        /^\s*current progress\s+\d+%\s*$/i.test(line) ||
        /^\s*Unlock the .+ newsletter for free\s*$/i.test(line)
    );

    if (chromeStart >= 0) {
        let chromeEnd = -1;
        for (let index = chromeStart; index < Math.min(lines.length, chromeStart + 40); index++) {
            if (/!\[[^\]]*\]\(https?:\/\/bat\.bing\.com\/action\//i.test(lines[index])) {
                chromeEnd = index;
                break;
            }
            if (/^\s*Close help popup\s*$/i.test(lines[index])) chromeEnd = index;
        }
        if (chromeEnd >= chromeStart) {
            lines = [...lines.slice(0, chromeStart), ...lines.slice(chromeEnd + 1)];
        }
    }

    let skipNewsletterDescription = false;
    return lines.filter(line => {
        const text = line.trim();
        if (skipNewsletterDescription && text) {
            skipNewsletterDescription = false;
            return false;
        }
        if (/^Unlock the .+ newsletter for free$/i.test(text)) {
            skipNewsletterDescription = true;
            return false;
        }
        return !(
            /^current progress\s+\d+%$/i.test(text) ||
            /^Published\s*.+$/i.test(text) ||
            /^\[\d+\]\(#comments-anchor[^\n]*\)\s*Print this page$/i.test(text) ||
            /^#{1,4}\s+\u6765\u81ea iframe:\s*https?:\/\/(?:www\.)?ft\.com\//i.test(text) ||
            /^\[Accessibility help\]\(https?:\/\/(?:www\.)?ft\.com\/accessibility\)\[Skip to main content\]/i.test(text) ||
            /^Need help\?Start chat$/i.test(text) ||
            /^Close help popup$/i.test(text) ||
            /^!\[[^\]]*\]\(https?:\/\/bat\.bing\.com\/action\//i.test(text) ||
            /^\[[^\]]+\]\(https?:\/\/(?:www\.)?ft\.com\/[^)]+\)\s+in\s+.{2,80}$/i.test(text)
        );
    });
}

export function extractFinancialTimesLatestArticles(markdown = '') {
    const source = String(markdown || '');
    const heading = source.match(/^\s*##\s+Latest on\s+([^\n]+)\s*$/im);
    if (!heading || !Number.isInteger(heading.index)) return null;

    const sectionStart = heading.index + heading[0].length;
    const remaining = source.slice(sectionStart);
    const nextHeading = remaining.search(/^\s*##\s+(?:Follow the topics in this article|Comments?)\s*$/im);
    const section = nextHeading >= 0 ? remaining.slice(0, nextHeading) : remaining;
    const items = [];

    for (const block of section.split(/(?=^\s*-\s+)/m)) {
        const articleLinks = [...block.matchAll(/\[([^\]\n]+)\]\((https?:\/\/(?:www\.)?ft\.com\/content\/[^)\s]+)\)/gi)]
            .filter(match => !match[1].trim().startsWith('!'));
        const titleLink = articleLinks.find(match => plainText(match[1]).length >= 8);
        if (!titleLink) continue;

        const href = canonicalFtContentUrl(titleLink[2]);
        const title = plainText(titleLink[1]);
        if (!href || !title || items.some(item => item.href === href)) continue;

        const imageMatch = block.match(/!\[[^\]]*\]\((https?:\/\/images\.ft\.com\/[^)\s]+)\)/i);
        const prefix = block.slice(0, titleLink.index || 0)
            .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, ' $1 ')
            .replace(/^\s*-\s*/, '')
            .replace(/\s+/g, ' ')
            .trim();
        const category = plainText(prefix).slice(0, 90);
        const premium = /\bPremium content\b/i.test(block);
        const duration = block.match(/\b(\d+\s+min listen)\b/i)?.[1] || '';

        items.push({
            href,
            title,
            image: imageMatch ? safeHttpUrl(imageMatch[1]) : '',
            category,
            badge: premium ? 'Premium content' : duration
        });
        if (items.length === 10) break;
    }

    return {
        title: plainText(heading[1]),
        items
    };
}

function renderFinancialTimesStandfirst(description = '') {
    const text = plainText(description);
    if (text.length < 20) return '';
    return '<p class="font-bold text-xl mb-6 text-gray-900 dark:text-gray-100 leading-relaxed" data-ft-standfirst="true">'
        + escapeHtml(text)
        + '</p>';
}

export function extractFinancialTimesByline(markdown = '') {
    for (const line of String(markdown || '').split(/\r?\n/)) {
        if (!line.includes('](https://www.ft.com/') || !/\s+in\s+/i.test(line)) continue;
        const text = plainText(line
            .replace(/\[([^\]]+)\]\(https?:\/\/(?:www\.)?ft\.com\/[^)]+\)/gi, '$1')
            .replace(/^\s*By\s+/i, ''));
        if (text.length >= 8 && text.length <= 220 && /\s+in\s+/i.test(text)) return text;
    }
    return '';
}

export function extractFinancialTimesChartUrls(diagnostics = '') {
    return [...new Set(
        [...String(diagnostics || '').matchAll(/https:\/\/flo\.uri\.sh\/visualisation\/\d+\/embed\?[^\s]+/gi)]
            .map(match => safeHttpUrl(match[0].replace(/[),;]+$/, '')))
            .filter(Boolean)
    )];
}

export function cleanFinancialTimesBrowserMarkdown(markdown = '') {
    let source = truncateAtFirstFooter(String(markdown || ''));
    let lines = removeMultilineShareLinks(source.split(/\r?\n/));
    lines = removeFtPageChrome(lines);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isRenderedFooter(text) {
    return /^(?:Reuse this content\b|Follow the topics in this article\b|Latest on\b|Comments?\s*$)/i.test(text);
}

function isRenderedChrome(text) {
    return (
        /^current progress\s+\d+%$/i.test(text) ||
        /^Published\s*.+$/i.test(text) ||
        /^\[?\d+\]?[\s\S]{0,100}Print this page$/i.test(text) ||
        /^Unlock the .+ newsletter for free$/i.test(text) ||
        /^\u6765\u81ea iframe:\s*https?:\/\/(?:www\.)?ft\.com\//i.test(text) ||
        /^Accessibility help.*Skip to main content/i.test(text) ||
        /^Need help\?Start chat$/i.test(text) ||
        /^Close help popup$/i.test(text) ||
        /^!$/i.test(text) ||
        /\bon\s+(?:x|facebook|linkedin|whatsapp)\s+\(opens in a new window\)\]\(/i.test(text)
    );
}

export function cleanFinancialTimesRenderedContent(markup = '') {
    const source = String(markup || '');
    if (!source.trim()) return source;

    const $ = cheerio.load(`<main id="ft-reader-root">${source}</main>`, null, false);
    const root = $('#ft-reader-root');
    let children = root.children().toArray();

    const footerIndex = children.findIndex(element => isRenderedFooter($(element).text().trim()));
    if (footerIndex >= 0) {
        children.slice(footerIndex).forEach(element => $(element).remove());
    }

    children = root.children().toArray();
    const chromeStart = children.findIndex(element => /^current progress\s+\d+%$/i.test($(element).text().trim()));
    if (chromeStart >= 0) {
        let chromeEnd = -1;
        for (let index = chromeStart; index < Math.min(children.length, chromeStart + 30); index++) {
            const node = $(children[index]);
            const text = node.text().trim();
            if (node.find('img[src*="bat.bing.com/action/"]').length || text === '!' || /^Close help popup$/i.test(text)) {
                chromeEnd = index;
            }
            if (chromeEnd >= 0 && index > chromeEnd && text.length > 140) break;
        }
        if (chromeEnd >= chromeStart) {
            children.slice(chromeStart, chromeEnd + 1).forEach(element => $(element).remove());
        }
    }

    root.children().each((_, element) => {
        const node = $(element);
        const text = node.text().replace(/\s+/g, ' ').trim();
        const isBrokenShareBullet = node.is('ul, ol') && text === '[';
        const isTrackingPixel = node.find('img[src*="bat.bing.com/action/"]').length > 0;
        if (isBrokenShareBullet || isTrackingPixel || isRenderedChrome(text) || (!text && !node.find('img, video, audio').length)) {
            node.remove();
        }
    });

    return root.html()?.trim() || '';
}

export default class FinancialTimesSource {
    match(hostname) {
        return hostname === 'ft.com' || hostname.endsWith('.ft.com');
    }

    parseOpenCliMarkdown(markdown) {
        return { markdown: cleanFinancialTimesBrowserMarkdown(markdown) };
    }

    cleanCachedArticleContent(content) {
        return cleanFinancialTimesRenderedContent(content);
    }
}
