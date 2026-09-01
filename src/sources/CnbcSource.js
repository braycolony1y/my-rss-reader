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

function extractCnbcAuthor(markdown = '') {
    const source = String(markdown || '');
    const keyPointsIndex = source.search(/^\s*(?:#{1,4}\s+)?Key Points\s*$/im);
    const bylineWindow = keyPointsIndex >= 0 ? source.slice(0, keyPointsIndex) : source.slice(0, 2500);
    const linked = [...bylineWindow.matchAll(/\[([^\]\n]{2,90})\]\((https?:\/\/(?:www\.)?cnbc\.com\/[^)\s]+)\)/gi)]
        .find(match => /\/(?:author|staff|reporter)\//i.test(match[2]) || /^\/[a-z-]+\/$/i.test(new URL(match[2]).pathname));
    if (linked) return cleanText(linked[1]);
    const metadata = cleanText(bylineWindow.match(/^\s*>?\s*(?:作者|Author)\s*:\s*([^\n|]{2,90})/im)?.[1] || '').replace(/^@/, '');
    if (metadata) return metadata;
    return cleanText(bylineWindow.match(/^\s*By\s+([^\n|]{2,90})/im)?.[1] || '') || 'CNBC';
}

function looksLikeCnbcHero(value = '') {
    const url = safeHttpUrl(value);
    return Boolean(url)
        && /(?:cnbcfm|image\.cnbcfm|static-redesign)\.com|cnbc\.com/i.test(url)
        && !/(?:headshot|author|avatar|logo|icon|badge)/i.test(url);
}

function extractCnbcHero(markdown = '') {
    const source = String(markdown || '');
    const matches = [...source.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/gi)];
    const keyPointsIndex = source.search(/^\s*(?:#{1,4}\s+)?Key Points\s*$/im);
    const match = matches.find(candidate => candidate.index > keyPointsIndex && looksLikeCnbcHero(candidate[2]))
        || matches.find(candidate => looksLikeCnbcHero(candidate[2]));
    if (!match || !Number.isInteger(match.index)) return { image: '', imageCaption: '', markdown: source };

    const before = source.slice(0, match.index);
    const after = source.slice(match.index + match[0].length);
    const lines = after.split(/\r?\n/);
    const captionLines = [];
    let consumed = 0;
    for (; consumed < Math.min(lines.length, 6); consumed++) {
        const line = lines[consumed].trim();
        if (!line) continue;
        if (/^(?:#{1,6}\s+|[-*+]\s+|\[|!\[)/.test(line)) break;
        if (line.length > 260 && !/(?:Getty|Reuters|Bloomberg|CNBC|Photo|Image|©|\|)/i.test(line)) break;
        captionLines.push(line.replace(/^[_*]+|[_*]+$/g, '').trim());
        if (captionLines.length >= 2 || /(?:Getty|Reuters|Bloomberg|CNBC|©|\|)/i.test(line)) {
            consumed++;
            break;
        }
    }

    return {
        image: safeHttpUrl(match[2]),
        imageCaption: cleanText(captionLines.join(' · ')),
        markdown: `${before}${lines.slice(consumed).join('\n')}`.replace(/\n{3,}/g, '\n\n').trim()
    };
}

export function cleanCnbcReaderMarkdown(markdown = '') {
    let source = String(markdown || '');
    const author = extractCnbcAuthor(source);
    const hero = extractCnbcHero(source);
    source = hero.markdown;

    const boundaries = [
        /^\s*\*\*WATCH:\*\*/im,
        /^\s*#{1,4}\s+Read more CNBC tech news\s*$/im,
        /^\s*\[WATCH LIVESTREAM\]/im,
        /^\s*##\s+Most Popular\s*$/im
    ].map(pattern => source.search(pattern)).filter(index => index >= 0);
    if (boundaries.length) source = source.slice(0, Math.min(...boundaries));

    const keyPointsIndex = source.search(/^\s*(?:#{1,4}\s+)?Key Points\s*$/im);
    const firstHeadingIndex = source.search(/^\s*#\s+.+$/m);
    const startIndex = keyPointsIndex >= 0
        ? (firstHeadingIndex >= 0 && firstHeadingIndex < keyPointsIndex ? firstHeadingIndex : keyPointsIndex)
        : Math.max(firstHeadingIndex, 0);
    source = source.slice(startIndex)
        .replace(/^\s*Key Points\s*$/im, '## Key Points')
        .replace(/^\s*!\[[^\]]*\]\([^)]*(?:headshot|author|avatar)[^)]*\)\s*$/gim, '')
        .replace(/^\s*\[[^\]\n]{2,90}\]\(https?:\/\/(?:www\.)?cnbc\.com\/[a-z-]+\/\)\s*$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return {
        markdown: source,
        author,
        image: hero.image,
        imageCaption: hero.imageCaption,
        readerType: 'cnbc-article'
    };
}

export default class CnbcSource {
    match(hostname) {
        return hostname === 'cnbc.com' || hostname.endsWith('.cnbc.com');
    }

    parseJinaReaderText(markdown) {
        return cleanCnbcReaderMarkdown(markdown);
    }

    parseOpenCliMarkdown(markdown) {
        return cleanCnbcReaderMarkdown(markdown);
    }

    isUsableArticleResult(result) {
        return cleanText(result?.content || '').length >= 350;
    }
}
