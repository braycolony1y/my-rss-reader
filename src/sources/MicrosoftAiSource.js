// Microsoft AI embeds interactive figures as Base64-encoded HTML documents.
// Some text readers expose the entire encoded iframe document as article text.
// Remove only this known embedded-document signature, preserving the surrounding
// prose and captions. Do not decode or execute third-party HTML.
const ENCODED_HTML_DOCUMENT = /(?:data:text\/html(?:;charset=[^;,\s"'<>]+)?;base64,)?PG1ldGEg[A-Za-z0-9+/]{500,}={0,2}/g;

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
    return text.replace(ENCODED_HTML_DOCUMENT, '');
}

export default class MicrosoftAiSource {
    match(hostname) {
        return hostname === 'microsoft.ai';
    }

    parseJinaReaderText(markdown, context = {}) {
        if (!isMicrosoftAiArticleUrl(context.url)) return null;
        return { markdown: stripMicrosoftAiEncodedFigures(markdown) };
    }

    parseOpenCliMarkdown(markdown, context = {}) {
        if (!isMicrosoftAiArticleUrl(context.url)) return null;
        return { markdown: stripMicrosoftAiEncodedFigures(markdown) };
    }

    cleanCachedArticleContent(content, context = {}) {
        return isMicrosoftAiArticleUrl(context.url)
            ? stripMicrosoftAiEncodedFigures(content)
            : content;
    }

    enhanceArticleResult(result, context = {}) {
        if (!result || !isMicrosoftAiArticleUrl(context.url || result.url)) return result;
        const content = stripMicrosoftAiEncodedFigures(result.content);
        return content === result.content ? result : { ...result, content };
    }
}
