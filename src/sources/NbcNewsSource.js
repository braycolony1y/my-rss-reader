import * as cheerio from 'cheerio/slim';
import { decodeHTML } from 'entities';

const PARTIAL_REASON = 'NBC News exposed only a subscriber preview to this reader. The remaining article requires publisher access.';

function cleanText(value = '') {
    return decodeHTML(String(value || ''))
        .replace(/<[^>]*>/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`#]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractNbcAuthor(value = '') {
    const source = String(value || '');
    try {
        const metadata = JSON.parse(source);
        const author = Array.isArray(metadata?.authors) ? metadata.authors[0] : metadata?.author;
        if (cleanText(author)) return cleanText(author);
    } catch (error) { }
    const linked = source.match(/(?:By\s*)?\[([^\]\n]{2,100})\]\(https?:\/\/(?:www\.)?nbcnews\.com\/author\/[^)]+\)/i);
    if (linked) return cleanText(linked[1]);
    const htmlLinked = source.match(/<a\b[^>]*href=["'][^"']*nbcnews\.com\/author\/[^"']*["'][^>]*>([\s\S]{1,200}?)<\/a>/i);
    if (htmlLinked) return cleanText(htmlLinked[1]);
    const inline = source.match(/data-testid=["']byline-name["'][^>]*>([\s\S]{1,200}?)<\//i);
    return cleanText(inline?.[1] || '');
}

function isNbcCaption(text = '') {
    const value = cleanText(text);
    return value.length >= 20 && value.length <= 500
        && /(?:Getty Images?|AFP|Associated Press|\bAP\b|Reuters|NBC News|Photo|Images file|Credit)/i.test(value);
}

export function cleanNbcNewsArticleHtml(content = '') {
    const source = String(content || '').trim();
    if (!source) return '';
    const $ = cheerio.load(`<main id="nbc-reader-root">${source}</main>`, null, false);
    const root = $('#nbc-reader-root');

    const hero = root.find('[data-testid="article-hero"]').first();
    const rawBody = root.find('[data-subscriber-content], .article-body__content').filter((_, element) => {
        const node = $(element);
        return node.find('p.body-graf').length || cleanText(node.text()).length >= 120;
    }).first();
    if (hero.length) {
        const normalized = $('<div class="nbcnews-reader"></div>');
        const dek = hero.find('[data-testid="article-dek"]').first();
        if (dek.length && cleanText(dek.text())) normalized.append(`<p class="article-sapo">${dek.html()}</p>`);
        const image = hero.find('figure img, img').first();
        const caption = hero.find('figcaption, [data-testid="caption"]').first();
        if (image.length) {
            const figure = $('<figure class="article-media-figure nbcnews-figure"></figure>');
            figure.append(image.clone());
            if (caption.length && cleanText(caption.text())) figure.append(`<figcaption>${caption.html()}</figcaption>`);
            normalized.append(figure);
        }
        if (rawBody.length) {
            const paragraphs = rawBody.find('p.body-graf').length ? rawBody.find('p.body-graf') : rawBody.find('p');
            paragraphs.each((_, paragraph) => normalized.append($(paragraph).clone()));
        }
        return normalized.prop('outerHTML');
    }

    root.find('p,h2,h3,li').each((_, element) => {
        const node = $(element);
        const text = cleanText(node.text());
        const href = node.find('a').first().attr('href') || '';
        const isPublisherControl = /^(?:Share|Add to Google|Save(?: with an NBCUniversal Profile)?|Resize|Read More)$/i.test(text)
            || /^Sept?\.?\s+\d{1,2},\s+20\d{2},\s+.+\bUTC$/i.test(text)
            || (/^By\s+/i.test(text) && /nbcnews\.com\/author\//i.test(href))
            || (/^!?$/.test(text) && /nbcnews\.com\/author\//i.test(href))
            || /\bis (?:an?\s+)?(?:technology\s+)?(?:reporter|correspondent|editor).{0,120}\bNBC News/i.test(text);
        if (isPublisherControl) node.remove();
    });

    root.find('p').each((_, element) => {
        const imageParagraph = $(element);
        if (imageParagraph.closest('figure').length) return;
        const images = imageParagraph.find('img');
        if (images.length !== 1) return;
        const captionParagraph = imageParagraph.next('p');
        if (!captionParagraph.length || !isNbcCaption(captionParagraph.text())) return;

        const figure = $('<figure class="article-media-figure nbcnews-figure"></figure>');
        figure.append(images.first().clone());
        figure.append(`<figcaption>${captionParagraph.html() || cleanText(captionParagraph.text())}</figcaption>`);
        imageParagraph.replaceWith(figure);
        captionParagraph.remove();
    });

    root.find('p,div,section,ul').each((_, element) => {
        const node = $(element);
        if (!node.text().trim() && !node.find('img,video,audio,iframe').length) node.remove();
    });
    return root.html().trim();
}

function nbcReaderMetadata(markdown = '') {
    return {
        markdown: String(markdown || '').trim(),
        author: extractNbcAuthor(markdown) || 'NBC News',
        readerType: 'nbcnews-article'
    };
}

export default class NbcNewsSource {
    match(hostname) {
        return hostname === 'nbcnews.com' || hostname.endsWith('.nbcnews.com');
    }

    parseJinaReaderText(markdown) {
        return nbcReaderMetadata(markdown);
    }

    parseOpenCliMarkdown(markdown) {
        return nbcReaderMetadata(markdown);
    }

    cleanCachedArticleContent(content) {
        return cleanNbcNewsArticleHtml(content);
    }

    enhanceArticleResult(result) {
        let content = cleanNbcNewsArticleHtml(result?.content || '');
        const description = cleanText(result?.description || '');
        if (description && !cleanText(content).includes(description) && /nbcnews-reader/.test(content)) {
            content = content.replace(/<\/div>\s*$/, `<p>${description}</p></div>`);
        }
        const $ = cheerio.load(content, null, false);
        const paragraphCount = $('p').filter((_, element) => cleanText($(element).text()).length >= 40).length;
        const partialContent = paragraphCount <= 3 || cleanText(content).length < 900;
        return {
            ...result,
            content,
            author: extractNbcAuthor(result?.content || '') || extractNbcAuthor(result?.author || '') || cleanText(result?.author) || 'NBC News',
            siteName: 'NBC News',
            readerType: 'nbcnews-article',
            ...(partialContent ? { partialContent: true, partialContentReason: PARTIAL_REASON } : {})
        };
    }

    isUsableArticleResult(result) {
        const text = cleanText(result?.content || '');
        return text.length >= 120
            && !/(?:Site SearchClear|Share Add to Google|For Subscribers.{0,100}For Subscribers)/i.test(text);
    }

    parseArticleHtmlContent(html, url, result) {
        const $ = cheerio.load(String(html || ''));
        const hero = $('[data-testid="article-hero"]').first();
        const body = $('[data-subscriber-content], .article-body__content').filter((_, element) => {
            const node = $(element);
            return node.find('p.body-graf').length || cleanText(node.text()).length >= 120;
        }).first();
        if (!hero.length && !body.length) return false;
        const author = $('[data-testid="byline-name"]').first();
        if (author.length) result.author = cleanText(author.text());
        const combined = `${hero.prop('outerHTML') || ''}${body.prop('outerHTML') || ''}`;
        return cleanNbcNewsArticleHtml(combined);
    }
}
