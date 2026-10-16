const ENCODED_HTML_DOCUMENT = /(?:data:text\/html(?:;charset=[^;,\s"'<>]+)?;base64,)?PG1ldGEg[A-Za-z0-9+/]{500,}={0,2}/g;

// Dedicated Microsoft AI extractor. The publisher embeds SVG charts, images,
// and tables as self-contained Base64 HTML documents. Preserve those figures
// inside isolated reader frames instead of displaying or deleting their bytes.
const MAX_FIGURES = 25;
const MAX_FIGURE_BYTES = 400_000;
const MAX_TOTAL_FIGURE_BYTES = 1_500_000;
const tokenFor = index => 'RSSMICROSOFTAIFIGURE' + index + 'PLACEHOLDER';

// Publisher HTML documents end in a closing script/div. Because OpenCLI can
// concatenate the next paragraph without whitespace, the Base64 regex may
// swallow its initial letters ("We", "Scaling", "Activation", etc.).
// Identify the LAST encoded closing tag and return that prose to the reader.
function splitFigureDocument(value) {
    const source = String(value || '');
    const prefix = source.match(/^data:text\/html(?:;charset=[^;,\s"'<>]+)?;base64,/i)?.[0] || '';
    const encoded = source.slice(prefix.length);
    const ends = ['L3NjcmlwdD4=', 'L2Rpdj4=', 'PC9zY3JpcHQ+', 'PC9kaXY+'];
    let boundary = 0;
    for (const ending of ends) {
        const at = encoded.lastIndexOf(ending);
        if (at >= 500) boundary = Math.max(boundary, at + ending.length);
    }
    if (!boundary || boundary === encoded.length) return { encoded, trailingText: '' };
    return { encoded: encoded.slice(0, boundary), trailingText: encoded.slice(boundary) };
}


function validFigurePayload(base64) {
    if (!base64 || base64.length > MAX_FIGURE_BYTES) return false;
    const doc = Buffer.from(base64, 'base64').toString('utf8');
    return /^<meta\s+http-equiv=["']Content-Security-Policy["']/i.test(doc)
        && /default-src\s+['"]none['"]/i.test(doc.slice(0, 600))
        && /<(?:svg|table|img|div)\b/i.test(doc);
}

export function extractMicrosoftAiFigures(markdown = '') {
    const figures = [];
    let bytes = 0;
    const cleaned = String(markdown || '').replace(ENCODED_HTML_DOCUMENT, value => {
        const { encoded: base64, trailingText } = splitFigureDocument(value);
        if (figures.length >= MAX_FIGURES || bytes + base64.length > MAX_TOTAL_FIGURE_BYTES
            || !validFigurePayload(base64)) return trailingText;
        const number = figures.length;
        figures.push(base64);
        bytes += base64.length;
        return '\n\n' + tokenFor(number) + '\n\n' + trailingText;
    });
    return { markdown: cleaned, figures };
}

export function restoreMicrosoftAiFigures(html = '', figures = []) {
    let source = String(html || '');
    for (let i = 0; i < figures.length; i++) {
        const data = figures[i];
        if (!validFigurePayload(data)) continue;
        const replacement = '<div class="microsoft-ai-figure" data-microsoft-ai-data="' + data + '">'
            + '<span class="microsoft-ai-figure__fallback">Figure ' + (i + 1) + ' — '
            + '<a href="https://microsoft.ai/news/frontier-pre-training-at-microsoft-ai/" '
            + 'target="_blank" rel="noopener noreferrer">View interactive figure at Microsoft AI</a>'
            + '</span></div>';
        source = source.replace(new RegExp('<p>\\s*' + tokenFor(i) + '\\s*<\\/p>', 'g'), replacement)
            .replaceAll(tokenFor(i), replacement);
    }
    return stripMicrosoftAiEncodedFigures(source);
}

export function isMicrosoftAiArticleUrl(value = '') {
    try {
        const url = new URL(value);
        return (url.protocol === 'https:' || url.protocol === 'http:')
            && url.hostname.toLowerCase() === 'microsoft.ai'
            && url.pathname.startsWith('/news/');
    } catch {
        return false;
    }
}

export function stripMicrosoftAiEncodedFigures(content = '') {
    const text = String(content || '');
    if (!text.includes('PG1ldGEg')) return text;
    // Only strip unexpected figure bytes in TEXT nodes, not in our own
    // sanitized data attributes; cached figures must survive another read.
    return text.split(/(<[^>]*>)/g).map((part, index) =>
        index % 2 === 0 ? part.replace(ENCODED_HTML_DOCUMENT, value =>
            splitFigureDocument(value).trailingText) : part
    ).join('');
}

function upgradeMicrosoftAiContent(content = '', figures = []) {
    if (figures?.length) return restoreMicrosoftAiFigures(content, figures);
    const original = String(content || '');
    if (original.includes('data-microsoft-ai-data=')) return stripMicrosoftAiEncodedFigures(original);
    const extracted = extractMicrosoftAiFigures(original);
    return restoreMicrosoftAiFigures(extracted.markdown, extracted.figures);
}

export default class MicrosoftAiSource {
    match(hostname) {
        return hostname === 'microsoft.ai';
    }

    parseJinaReaderText(markdown, context = {}) {
        if (!isMicrosoftAiArticleUrl(context.url)) return null;
        const parsed = extractMicrosoftAiFigures(markdown);
        return { markdown: parsed.markdown, microsoftAiFigures: parsed.figures };
    }

    parseOpenCliMarkdown(markdown, context = {}) {
        if (!isMicrosoftAiArticleUrl(context.url)) return null;
        const parsed = extractMicrosoftAiFigures(markdown);
        return { markdown: parsed.markdown, microsoftAiFigures: parsed.figures };
    }

    cleanCachedArticleContent(content, context = {}) {
        return isMicrosoftAiArticleUrl(context.url)
            ? upgradeMicrosoftAiContent(content, context.microsoftAiFigures)
            : content;
    }

    enhanceArticleResult(result, context = {}) {
        if (!result || !isMicrosoftAiArticleUrl(context.url || result.url)) return result;
        const content = upgradeMicrosoftAiContent(result.content);
        return content === result.content ? result : { ...result, content };
    }
}
