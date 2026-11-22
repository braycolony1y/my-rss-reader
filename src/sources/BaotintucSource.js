import https from 'https';

function findBalancedElementByClass(html, className) {
    const source = String(html || '');
    const escapedClass = String(className).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startRegex = new RegExp('<([a-z][a-z0-9-]*)\\b[^>]*class=(["\\\'])[^"\\\']*\\b' + escapedClass + '\\b[^"\\\']*\\2[^>]*>', 'i');
    const start = startRegex.exec(source);
    if (!start) return null;

    const tagName = start[1];
    const contentStart = start.index + start[0].length;
    const tokenRegex = new RegExp('<\\/?' + tagName + '\\b[^>]*>', 'gi');
    tokenRegex.lastIndex = start.index;
    let depth = 0;
    let token;

    while ((token = tokenRegex.exec(source))) {
        const isClosing = /^<\//.test(token[0]);
        const isSelfClosing = /\/>$/.test(token[0]);
        if (isClosing) {
            depth--;
            if (depth === 0) {
                return {
                    start: start.index,
                    end: tokenRegex.lastIndex,
                    inner: source.slice(contentStart, token.index),
                    outer: source.slice(start.index, tokenRegex.lastIndex)
                };
            }
        } else if (!isSelfClosing) {
            depth++;
        }
    }

    return null;
}

function stripBalancedClass(markup, className) {
    let value = String(markup || '');
    for (let i = 0; i < 32; i++) {
        const found = findBalancedElementByClass(value, className);
        if (!found) break;
        value = value.slice(0, found.start) + value.slice(found.end);
    }
    return value;
}

function textOnly(markup) {
    return String(markup || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeBaotintucArticleMarkup(markup) {
    let value = String(markup || '');
    if (!value) return value;

    // The article body includes sharing controls, ad placeholders, related
    // stories, tags and comments inside the same outer .article__body. Keep the
    // actual article and author, but stop before related content begins.
    const relatedIndex = value.search(/<div\b[^>]*class=(["'])[^"']*\brelated-news\b[^"']*\1[^>]*>/i);
    if (relatedIndex >= 0) value = value.slice(0, relatedIndex);

    for (const className of [
        'box-share',
        'social-share',
        'sda_middle',
        'rennab'
    ]) {
        value = stripBalancedClass(value, className);
    }

    value = value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
        .replace(/<!--([\s\S]*?)-->/g, '')
        .replace(/<p\b[^>]*>\s*<(?:b|strong)\b[^>]*>\s*([\s\S]*?)\s*<\/(?:b|strong)>\s*<\/p>/gi, (_match, heading) => {
            const label = textOnly(heading);
            return label ? `<h2>${heading.trim()}</h2>` : '';
        });

    // Preserve the publisher credit, but remove its layout-only wrapper.
    const sourceBlock = findBalancedElementByClass(value, 'article__source');
    if (sourceBlock) {
        const authorBlock = findBalancedElementByClass(sourceBlock.inner, 'author');
        const author = textOnly(authorBlock?.inner || sourceBlock.inner);
        const replacement = author
            ? `<p class="article-author"><strong>${author}</strong></p>`
            : '';
        value = value.slice(0, sourceBlock.start) + replacement + value.slice(sourceBlock.end);
    }

    return value.trim();
}

function extractBaotintucArticle(html) {
    const source = String(html || '');
    const body = findBalancedElementByClass(source, 'article__body');
    if (!body) return null;

    const sapo = findBalancedElementByClass(source, 'article__sapo');
    const cleanBody = normalizeBaotintucArticleMarkup(body.inner);
    if (!cleanBody || textOnly(cleanBody).length < 120) return null;

    let lead = sapo?.inner ? normalizeBaotintucArticleMarkup(sapo.inner) : '';
    if (lead) {
        const leadText = textOnly(lead);
        const bodyText = textOnly(cleanBody);
        if (leadText && !bodyText.startsWith(leadText)) {
            lead = `<div class="article-sapo">${lead}</div>`;
        } else {
            lead = '';
        }
    }

    return `${lead}${lead ? '\n' : ''}${cleanBody}`.trim();
}

export default class BaotintucSource {
    match(hostname) {
        return hostname.includes('baotintuc.vn');
    }

    async getBestImage(targetUrl, fetchFn, rssFallback, utils) {
        try {
            // Baotintuc uses an insecure SSL cert, we need a custom fetch
            const agent = new https.Agent({
                rejectUnauthorized: false
            });
            const res = await fetchFn(targetUrl, { agent });
            if (res.ok) {
                const html = await res.text();
                const ogImageMatch = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                                     html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
                if (ogImageMatch) {
                    return ogImageMatch[1];
                }
                const img = utils.extractImageFromHtml(html, targetUrl);
                if (img) return img.startsWith('/') ? new URL(img, targetUrl).href : img;
            }
        } catch (e) {
            // fallback
        }
        return rssFallback && !utils.isInvalidImage(rssFallback) ? rssFallback : null;
    }

    parseArticleHtmlContent(html) {
        // Current Báo Tin tức pages use .article__body. The previous processor
        // looked for old .contents/.detail-content layouts and, on failure,
        // returned the ENTIRE document. That is what caused navigation,
        // related cards and footer markup to appear as article content.
        // Returning false is safer than ever returning the whole page.
        return extractBaotintucArticle(html) || false;
    }

    cleanCachedArticleContent(content) {
        const value = String(content || '');
        if (!value) return value;

        // Repair already-cached bad entries immediately on read. Existing bad
        // cache files contain a complete HTML document because of the old
        // fallback, so we can recover the correct article without waiting for a
        // network refetch.
        if (/<!doctype\s+html|<html\b/i.test(value) && /\barticle__body\b/i.test(value)) {
            return extractBaotintucArticle(value) || value;
        }

        return normalizeBaotintucArticleMarkup(value);
    }

    isUsableArticleResult(result, { url } = {}) {
        const content = String(result?.content || '');
        const text = textOnly(content);
        if (!text) return false;

        // OpenCLI can occasionally land on a related-story card instead of the
        // requested article body on this publisher. Reject that fragment so the
        // pipeline can use another strategy rather than caching the wrong story.
        if (result?.source === 'opencli' || result?.readerType) {
            const targetPostId = String(url || '').match(/post(\d+)\.html/i)?.[1] || '';
            const linkedPostIds = [...content.matchAll(/post(\d+)\.html/gi)].map(match => match[1]);
            if (
                targetPostId &&
                linkedPostIds.length &&
                !linkedPostIds.includes(targetPostId) &&
                text.length < 2000
            ) {
                return false;
            }
        }

        return text.length >= 120;
    }
}
