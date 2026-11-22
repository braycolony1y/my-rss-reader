import * as cheerio from 'cheerio/slim';
import { decodeHTML } from 'entities';

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
    const markdown = source.match(/\[([^\]\n]{2,100})\]\(https?:\/\/(?:www\.)?marketwatch\.com\/author\/[^)]+\)/i);
    if (markdown) return cleanText(markdown[1]);
    const html = source.match(/<a\b[^>]*href=["'][^"']*marketwatch\.com\/author\/[^"']*["'][^>]*>([\s\S]{1,200}?)<\/a>/i);
    return cleanText(html?.[1] || '');
}

function removeNewsletterBlock($, container) {
    const headings = container.find('h2,h3,h4').toArray();
    for (const element of headings) {
        const heading = $(element);
        if (!/Don(?:'|’|&#x2019;)t Short Yourself/i.test(cleanText(heading.text()))) continue;
        let cursor = heading;
        while (cursor.length) {
            const next = cursor.next();
            const text = cleanText(cursor.text());
            cursor.remove();
            if (/iframe:/i.test(text)) break;
            cursor = next;
        }
    }
    container.find('h2,h3,h4').filter((_, element) => /iframe:/i.test(cleanText($(element).text()))).remove();
}

function removeStockChiclets($, container) {
    container.find('ul').filter((_, element) => /^\[$/.test(cleanText($(element).text()))).remove();
    container.find('p').each((_, element) => {
        const node = $(element);
        const text = cleanText(node.text());
        if (/^\[$/.test(text)
            || /^\]\(https?:\/\/[^)]+\)$/.test(text)
            || /^[A-Z]{1,6}(?:\.[A-Z])?$/.test(text)
            || /^[+-]?\d+(?:\.\d+)?%$/.test(text)) node.remove();
    });

    let merged = true;
    while (merged) {
        merged = false;
        container.find('p').each((_, element) => {
            if (merged) return;
            const first = $(element);
            const second = first.next('p');
            if (!second.length) return;
            const firstText = cleanText(first.text());
            const secondText = cleanText(second.text());
            if (!firstText || !secondText || /[.!?:;”"')\]]$/.test(firstText)) return;
            if (!/^(?:[a-z]|\$|\.|unit\b)/i.test(secondText)) return;
            first.append(/^[.,!?;:]/.test(secondText) ? '' : ' ').append(second.contents());
            second.remove();
            merged = true;
        });
    }
}

export function cleanMarketWatchArticleHtml(content = '') {
    const source = String(content || '').trim();
    if (!source) return '';
    const $ = cheerio.load(`<main id="marketwatch-cleaning-root">${source}</main>`, null, false);
    const root = $('#marketwatch-cleaning-root');
    const container = root.find('.marketwatch-reader').first().length
        ? root.find('.marketwatch-reader').first()
        : root;
    const children = container.children().toArray();
    const figureIndex = children.findIndex(element => $(element).is('figure') && $(element).find('img').length);
    const summary = container.find('.article-sapo').first().text()
        || (figureIndex >= 0
            ? $(children.slice(0, figureIndex).reverse().find(element => $(element).is('h2,h3') && cleanText($(element).text()).length >= 60)).text()
            : '');
    const startIndex = children.findIndex((element, index) => index > figureIndex
        && $(element).is('p')
        && cleanText($(element).text()).length >= 50
        && !/^(?:Copyright|About the Author)/i.test(cleanText($(element).text())));
    const endIndex = children.findIndex((element, index) => index > startIndex && /^Copyright\s+©?\s*20\d{2}\s+MarketWatch/i.test(cleanText($(element).text())));
    const output = $('<div class="marketwatch-reader"></div>');
    if (summary) output.append(`<p class="article-sapo">${cleanText(summary)}</p>`);
    if (figureIndex >= 0) output.append($(children[figureIndex]).clone());
    if (startIndex >= 0) {
        const selected = children.slice(startIndex, endIndex >= 0 ? endIndex : children.length);
        for (const element of selected) output.append($(element).clone());
    }

    removeNewsletterBlock($, output);
    removeStockChiclets($, output);
    output.find('p,h2,h3,h4').filter((_, element) => /^(?:Share|Resize|Show Conversation\b|About the Author)$/i.test(cleanText($(element).text()))).remove();
    output.find('ul').filter((_, element) => !cleanText($(element).text())).remove();
    return output.prop('outerHTML');
}

function readerMetadata(markdown = '') {
    return {
        markdown: String(markdown || '').trim(),
        author: extractAuthor(markdown) || 'MarketWatch',
        readerType: 'marketwatch-article'
    };
}

export default class MarketWatchSource {
    match(hostname) {
        return hostname === 'marketwatch.com' || hostname.endsWith('.marketwatch.com');
    }

    parseJinaReaderText(markdown) {
        return readerMetadata(markdown);
    }

    parseOpenCliMarkdown(markdown) {
        return readerMetadata(markdown);
    }

    cleanCachedArticleContent(content) {
        return cleanMarketWatchArticleHtml(content);
    }

    enhanceArticleResult(result) {
        return {
            ...result,
            content: cleanMarketWatchArticleHtml(result?.content || ''),
            author: extractAuthor(result?.content || '') || cleanText(result?.author) || 'MarketWatch',
            siteName: 'MarketWatch',
            readerType: 'marketwatch-article'
        };
    }

    isUsableArticleResult(result) {
        const text = cleanText(result?.content || '');
        return text.length >= 350
            && !/(?:Site SearchClear|No Results Found|ticker_ribbon|Copyright\s+©?\s*20\d{2}\s+MarketWatch|来自 iframe|About the Author)/i.test(text);
    }
}
