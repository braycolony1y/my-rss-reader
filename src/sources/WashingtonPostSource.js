import * as cheerio from 'cheerio/slim';
import { decodeHTML } from 'entities';

const PARTIAL_REASON = 'The Washington Post exposed only a short preview to this reader. The remaining article requires publisher access.';

function cleanText(value = '') {
    return decodeHTML(String(value || ''))
        .replace(/<[^>]*>/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`#]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractAuthor(value = '') {
    const source = String(value || '');
    const markdown = source.match(/^\s*By\s+\[([^\]\n]{2,100})\]\(https?:\/\/(?:www\.)?washingtonpost\.com\/people\/[^)]+\)/im);
    if (markdown) return cleanText(markdown[1]);
    const html = source.match(/(?:By\s*(?:<!--.*?-->)?\s*)?<a\b[^>]*href=["'][^"']*washingtonpost\.com\/people\/[^"']*["'][^>]*>([\s\S]{1,200}?)<\/a>/i);
    return cleanText(html?.[1] || '');
}

function cleanWashingtonPostMarkdown(markdown = '') {
    const source = String(markdown || '');
    const lines = source.split(/\r?\n/);
    const author = extractAuthor(source);
    const bylineIndex = lines.findIndex(line => /^\s*By\s+\[[^\]]+\]\(https?:\/\/(?:www\.)?washingtonpost\.com\/people\//i.test(line));
    if (bylineIndex < 0) return { markdown: source.trim(), author, readerType: 'washington-post-article' };

    const preface = lines.slice(0, bylineIndex);
    let imageIndex = -1;
    for (let index = preface.length - 1; index >= 0; index--) {
        if (/!\[[^\]]*\]\(https?:\/\/[^)]+\)/i.test(preface[index]) && !/(?:author-service|avatar|logo|pixel)/i.test(preface[index])) {
            imageIndex = index;
            break;
        }
    }
    const hero = imageIndex >= 0 ? preface[imageIndex].trim() : '';
    const caption = imageIndex >= 0
        ? preface.slice(imageIndex + 1).map(line => line.trim()).find(line => line && !/^By\b/i.test(line)) || ''
        : '';

    const body = [];
    for (const rawLine of lines.slice(bylineIndex + 1)) {
        const text = cleanText(rawLine);
        if (/^(?:What readers are saying|Comments\b|Most Read|Two ways to read this article|Create an account)$/i.test(text)
            || /^\s*\*\s*\*\s*\*\s*$/.test(rawLine)) break;
        if (text) body.push(rawLine);
    }

    return {
        markdown: [hero, caption, body.join('\n')].filter(Boolean).join('\n\n').trim(),
        author,
        readerType: 'washington-post-article'
    };
}

function findArticleBody($, root) {
    return root.find('[data-qa="article-body"], .article-body').first();
}

export function cleanWashingtonPostArticleHtml(content = '') {
    const source = String(content || '').trim();
    if (!source) return '';
    const $ = cheerio.load(`<main id="washpost-cleaning-root">${source}</main>`, null, false);
    const root = $('#washpost-cleaning-root');
    const existing = root.find('.washington-post-reader').first();
    if (existing.length) return existing.prop('outerHTML');

    const body = findArticleBody($, root);
    const bodyHtml = body.length ? body.html() : root.html();
    const heroImage = root.find('figure[data-testid="lede-image"] img, [data-testid="lede-image"] img').first();
    const caption = root.find('figcaption[data-testid="lede-art-caption"], [data-testid="lede-art-caption"]').first();
    const output = $('<div class="washington-post-reader"></div>');

    if (heroImage.length) {
        const figure = $('<figure class="article-media-figure washington-post-figure"></figure>');
        figure.append(heroImage.clone());
        if (caption.length && cleanText(caption.text())) figure.append(`<figcaption>${caption.html()}</figcaption>`);
        output.append(figure);
    }
    output.append(bodyHtml || '');
    output.find('svg,wp-ad-wrapper,script,style,button').remove();
    return output.prop('outerHTML');
}

function previewIsPartial(content = '') {
    const $ = cheerio.load(String(content || ''), null, false);
    const paragraphs = $('p').filter((_, element) => cleanText($(element).text()).length >= 40).length;
    return paragraphs <= 2 || cleanText(content).length < 900;
}

export default class WashingtonPostSource {
    match(hostname) {
        return hostname === 'washingtonpost.com' || hostname.endsWith('.washingtonpost.com');
    }

    parseJinaReaderText(markdown) {
        return cleanWashingtonPostMarkdown(markdown);
    }

    parseOpenCliMarkdown(markdown) {
        return cleanWashingtonPostMarkdown(markdown);
    }

    cleanCachedArticleContent(content) {
        return cleanWashingtonPostArticleHtml(content);
    }

    enhanceArticleResult(result) {
        const content = cleanWashingtonPostArticleHtml(result?.content || '');
        const partialContent = previewIsPartial(content);
        return {
            ...result,
            content,
            author: extractAuthor(result?.content || '') || cleanText(result?.author),
            siteName: 'The Washington Post',
            readerType: 'washington-post-article',
            ...(partialContent ? { partialContent: true, partialContentReason: PARTIAL_REASON } : {})
        };
    }

    isUsableArticleResult(result) {
        const text = cleanText(result?.content || '');
        return text.length >= 120
            && !/(?:Most Read|What readers are saying|Two ways to read this article|Democracy Dies in Darkness.{0,100}Democracy Dies in Darkness)/i.test(text);
    }

    parseArticleHtmlContent(html, url, result) {
        const $ = cheerio.load(String(html || ''));
        const body = findArticleBody($, $.root());
        if (!body.length || cleanText(body.text()).length < 100) return false;
        const author = $('[data-testid="author-name-with-optional-link"], [data-qa="author-byline"]').first();
        if (author.length) result.author = cleanText(author.text()).replace(/^By\s+/i, '');
        const articleMarkup = cleanWashingtonPostArticleHtml($.html());
        return articleMarkup;
    }
}
