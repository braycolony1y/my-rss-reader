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
    const original = String(markdown || '');
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

    const start = lines.findIndex(line => /^[A-ZÀ-Ý][A-ZÀ-Ý .’'()-]{1,80},\s+[A-Z][a-z]+\s+\d{1,2}\s+\(Reuters\)\s*[-—]\s+\S/.test(cleanText(line)));
    if (start < 0) {
        return { markdown: original.trim(), author, image, imageCaption, readerType: 'reuters-article' };
    }
    let body = lines.slice(start);
    const copyright = body.findIndex(line => /^\s*(?:\*\*)?Copyright\s+\d{4}\s+Thomson Reuters/i.test(line));
    if (copyright >= 0) body = body.slice(0, copyright);

    body = body.filter(line => {
        const text = cleanText(line);
        return !/^(?:Advertisement\s*·\s*Scroll to continue|Get a look at the day ahead.+Morning Bid Europe newsletter|Item\s+\d+\s+of\s+\d+\b|\[\d+\/\d+\].+Purchase Licensing Rights.*|Our Standards:.*|Purchase Licensing Rights.*)$/i.test(text);
    }).map(line => {
        const text = cleanText(line);
        return text.length >= 8 && text.length <= 110 && /^[A-Z0-9][A-Z0-9\s,’'&()-]+$/.test(text)
            ? `## ${text}`
            : line;
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

    isUsableArticleResult(result) {
        const text = cleanText(result?.content || '');
        return text.length >= 350
            && /\(Reuters\)\s*[-—]/i.test(text)
            && !/(?:verifying the device|requested content will be available after verification|captcha-delivery\.com\/interstitial)/i.test(text);
    }
}
