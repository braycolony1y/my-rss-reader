import { decodeHTML } from 'entities';
import { load } from 'cheerio';

const invisibleSpacing = /[\u200b-\u200d\u2060\ufeff]/g;
const reportLead = /\(Reuters\)\s*[-—]\s*\S/i;
const reportCredits = /^\(?Reporting\s+by\b/i;
const reportFooter = /^(?:Read Next|Join the Conversation|Our Standards:|Copyright\s+\d{4}\s+Thomson Reuters|Purchase Licensing Rights)\b/i;
const newsletterPromo = /^(?:The Reuters\b.*\bnewsletter\b|Get a look at the day ahead.*newsletter)/i;

function cleanText(value = '') {
    return decodeHTML(String(value || ''))
        .replace(invisibleSpacing, '')
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

function syndicatedUsNewsUrl(value = '') {
    try {
        const url = new URL(value);
        if (!/(?:^|\.)reuters\.com$/i.test(url.hostname)) return '';
        const match = url.pathname.match(/^\/world\/(?:[^/]+\/)*(.+)-(20\d{2})-(\d{2})-(\d{2})\/?$/i);
        if (!match) return '';
        const [, slug, year, month, day] = match;
        return `https://www.usnews.com/news/world/articles/${year}-${month}-${day}/${slug}`;
    } catch (error) {
        return '';
    }
}

function markdownImage(line = '') {
    const match = String(line).match(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/i);
    return match ? { alt: cleanText(match[1]), url: safeHttpUrl(match[2]) } : null;
}

export function cleanReutersReaderMarkdown(markdown = '') {
    const original = decodeHTML(String(markdown || '')).replace(invisibleSpacing, '');
    const lines = original.split(/\r?\n/);
    const author = cleanText(original.match(/^\s*By\s+(?:\[)?([^\]\n]+)(?:\]\([^)]+\))?\s*$/im)?.[1] || 'Reuters');
    let image = '';
    let imageCaption = '';

    for (let index = 0; index < lines.length; index++) {
        const candidate = markdownImage(lines[index]);
        if (!candidate?.url || /(?:logo|icon|avatar)/i.test(`${candidate.alt} ${candidate.url}`)) continue;
        image = candidate.url;
        const captionLine = lines.find(line => /\bREUTERS\/[A-ZÀ-Ý]/i.test(cleanText(line)));
        imageCaption = cleanText(captionLine || '')
            .replace(/^Item\s+\d+\s+of\s+\d+\s+/i, '')
            .replace(/^\[\d+\/\d+\]\s*/, '')
            .replace(/\s+Purchase Licensing Rights.*$/i, '');
        break;
    }

    const start = lines.findIndex(line => reportLead.test(cleanText(line)));
    if (start < 0) {
        return { markdown: original.trim(), author, image, imageCaption, readerType: 'reuters-article' };
    }
    let body = lines.slice(start);
    const credits = body.findIndex(line => reportCredits.test(cleanText(line)));
    if (credits >= 0) body = body.slice(0, credits + 1);
    const footer = body.findIndex(line => reportFooter.test(cleanText(line)));
    if (footer >= 0) body = body.slice(0, footer);

    body = body.filter(line => {
        const text = cleanText(line);
        if (newsletterPromo.test(text)) return false;
        return !/^(?:Advertisement\s*·\s*Scroll to continue|Get a look at the day ahead.+Morning Bid Europe newsletter|Item\s+\d+\s+of\s+\d+\b|\[\d+\/\d+\].+Purchase Licensing Rights.*|Our Standards:.*|Purchase Licensing Rights.*)$/i.test(text);
    }).map(line => {
        const text = cleanText(line);
        return text.length >= 8 && text.length <= 110 && /^[A-Z0-9][A-Z0-9\s,’'&()-]+$/.test(text)
            ? `## ${text}`
            : line.replace(/,?\s*opens new tab/gi, '');
    });

    return {
        markdown: body.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
        author: author || 'Reuters',
        image,
        imageCaption,
        readerType: 'reuters-syndicated-article'
    };
}

export default class ReutersSource {
    match(hostname) {
        return hostname === 'reuters.com' || hostname.endsWith('.reuters.com');
    }

    // Reuters sometimes moves the top-level page into a device-verification
    // iframe. Give a real browser session time to finish before trying a
    // Reuters-credited syndication of the same story.
    getOpenCliWaitSeconds() {
        return 15;
    }

    getOpenCliFallbackReaderUrls(url) {
        return [syndicatedUsNewsUrl(url)].filter(Boolean);
    }

    needsOpenCliDiagnostics() {
        return true;
    }

    parseOpenCliMarkdown(markdown) {
        return cleanReutersReaderMarkdown(markdown);
    }

    parseJinaReaderText(markdown) {
        return cleanReutersReaderMarkdown(markdown);
    }

    cleanCachedArticleContent(content) {
        const $ = load(content, null, false);
        $.root().find('*').addBack().contents().each((_, node) => {
            if (node.type === 'text') node.data = node.data.replace(invisibleSpacing, '');
        });
        const children = $.root().children().toArray();
        const start = children.findIndex(node => reportLead.test($(node).text()));
        if (start < 0) return content;
        children.slice(0, start).forEach(node => $(node).remove());
        let finished = false;
        children.slice(start).forEach(node => {
            const text = $(node).text().trim();
            if (finished || reportFooter.test(text)) {
                $(node).remove();
                finished = true;
            } else if (newsletterPromo.test(text) || /^Advertisement\s*·?\s*Scroll to continue/i.test(text)) {
                $(node).remove();
            } else if (reportCredits.test(text)) {
                finished = true;
            }
        });
        $('a').contents().each((_, node) => {
            if (node.type === 'text') node.data = node.data.replace(/,?\s*opens new tab/gi, '');
        });
        return $.root().html();
    }

    isUsableArticleResult(result) {
        const text = cleanText(result?.content || '');
        return text.length >= 350
            && /\(Reuters\)\s*[-—]/i.test(text)
            && !/(?:verifying the device|requested content will be available after verification|captcha-delivery\.com\/interstitial)/i.test(text);
    }
}
