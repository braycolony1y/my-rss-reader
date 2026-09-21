import * as cheerio from 'cheerio/slim';
function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function safeHttpUrl(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
}

function removeExecutableMarkup(root, $) {
    root.find('script, iframe, object, embed, base, link, meta, form').remove();
    root.find('*').addBack().each((_, element) => {
        for (const name of Object.keys(element.attribs || {})) {
            if (/^on/i.test(name) || /^(?:srcdoc|formaction)$/i.test(name)) $(element).removeAttr(name);
            if (/^(?:href|src|xlink:href)$/i.test(name)
                && /^\s*(?:javascript|vbscript|data):/i.test(element.attribs[name] || '')) $(element).removeAttr(name);
        }
    });
}

export default class MacStoriesSource {
    match(hostname) {
        return hostname === 'macstories.net' || hostname.endsWith('.macstories.net');
    }

    // Text readers omit CSS-driven benchmark panels and may stop at the sponsor.
    preferredAggregateStrategies = ['opencli-fetch', 'direct', 'cloudflare', 'vietserver', 'allorigins', 'opencli', 'jina'];

    isUsableArticleResult(result) {
        return /data-macstories-reader="1"/.test(result?.content || '');
    }

    parseArticleHtmlContent(html, url, result) {
        const $ = cheerio.load(html);
        const article = $('article.post').first();
        const body = article.children('.post-content').first();
        if (!body.length) return false;
        result.title = article.find('h1').first().text().trim() || result.title;
        result.author = article.find('[rel="author"], .author').first().text().trim() || result.author;
        result.readerType = 'macstories-article';

        body.find('.aside-narrow, .post-supporters, .club-after-content, .view-full-size').remove();
        body.find('aside').each((_, element) => {
            const node = $(element);
            node.replaceWith(`<blockquote>${node.html() || ''}</blockquote>`);
        });
        removeExecutableMarkup(body, $);

        let widgetCount = 0;
        body.find('.ms-widget').each((_, element) => {
            const widget = $(element);
            const css = widget.find('style').map((_, style) => $(style).text()).get().join('\n');
            widget.find('style, nav').remove();
            // CSS radio controls and animations work without publisher scripts.
            // Each group gets its own opaque sandbox, keeping its CSS and IDs
            // away from the reader and retaining all model/prompt variants.
            const parts = widget.children('.mx-part');
            const groups = parts.length ? parts.toArray() : [element];
            const embeds = groups.map(part => {
                const group = $(part);
                const title = group.find('h2,h3').first().text().trim() || 'Interactive benchmarks';
                widgetCount += group.find('.mx').length;
                const document = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https:"><style>html,body{margin:0;padding:8px;background:white;color:#1d1d1f;font-family:system-ui} .ms-widget{width:100%;max-width:100%} ${css}</style></head><body class="theme-light">${group.prop('outerHTML')}</body></html>`;
                return `<section><h3>${escapeHtml(title)}</h3><iframe data-macstories-widget="1" sandbox="" loading="lazy" title="${escapeHtml(title)}" srcdoc="${escapeHtml(document)}" style="width:100%;height:900px;border:0;display:block"></iframe><p><a class="article-inline-link" href="${escapeHtml(url)}#${escapeHtml(group.attr('id') || '')}" target="_blank" rel="noopener noreferrer">View these benchmarks on MacStories</a></p></section>`;
            });
            widget.replaceWith(embeds.join(''));
        });
        body.find('style, nav, noscript, template').remove();
        body.find('a[href]').addClass('article-inline-link');
        body.find('img').each((_, element) => {
            const image = $(element);
            for (const attribute of ['src', 'data-src']) {
                const value = image.attr(attribute);
                if (!value) continue;
                try {
                    const resolved = safeHttpUrl(new URL(value, url).href);
                    if (resolved) image.attr('src', resolved);
                } catch { }
            }
            image.removeAttr('width').removeAttr('height').removeAttr('style');
        });
        result.image = body.find('img[src]').first().attr('src') || result.image;
        result.imageCaption = body.find('.image-caption').first().text().trim();
        result.interactivePanelCount = widgetCount;
        return `<article data-macstories-reader="1">${body.html()}</article>`;
    }
}
