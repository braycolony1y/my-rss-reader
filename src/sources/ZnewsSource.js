export default class ZnewsSource {
    match(hostname) {
        return hostname.includes('znews.vn');
    }

    async getBestImage(targetUrl, fetchFn, rssFallback, utils) {
        try {
            let res;
            try {
                res = await fetchFn(targetUrl);
            } catch (e) {
                res = { ok: false };
            }
            if (!res.ok) {
                const fetchUrl = utils.CF_PROXY_BASE + encodeURIComponent(targetUrl);
                res = await fetchFn(fetchUrl);
            }
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

    async parseArticleHtmlContent(html, url, result, utils) {
        let articleHtml = '';
        const articleBodyMatch = html.match(/<div\b[^>]*class=["'][^"']*the-article-body[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*the-article-credit|<p\b[^>]*class=["'][^"']*the-article-tags|<div\b[^>]*class=["'][^"']*article-footer)/i) || 
                                 html.match(/<div\b[^>]*class=["'][^"']*the-article-body[^"']*["'][^>]*>([\s\S]*?)(?:<\/div>\s*<\/div>\s*<\/div>)/i) ||
                                 html.match(/<div\b[^>]*class=["'][^"']*the-article-body[^"']*["'][^>]*>([\s\S]*)/i);

        if (articleBodyMatch) {
            articleHtml = articleBodyMatch[1];
        } else {
            articleHtml = html;
        }

        const authorMatch = html.match(/<p\b[^>]*class=["'][^"']*author[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) ||
                            html.match(/<li\b[^>]*class=["'][^"']*the-article-author[^"']*["'][^>]*>([\s\S]*?)<\/li>/i) ||
                            html.match(/"author":\s*\{\s*"@type":\s*"Person",\s*"name":\s*"([^"]+)"\s*\}/i);
        if (authorMatch && result) {
            result.author = authorMatch[1].replace(/<[^>]+>/g, '').trim();
        }

        const fetchOgImage = async (absUrl) => {
            if (!utils || !utils.fetchWithTimeout) return '';
            try {
                const res = await utils.fetchWithTimeout(absUrl, {}, 3000);
                if (res.ok) {
                    const text = await res.text();
                    const ogMatch = text.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || text.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
                    if (ogMatch) return ogMatch[1];
                }
            } catch(e) {}
            return '';
        };

        // 1. Fix video ratio
        articleHtml = articleHtml.replace(/<iframe\b([^>]*)>/gi, (match, attrs) => {
            return `<iframe ${attrs} style="width: 100%; aspect-ratio: 16/9; height: auto;">`;
        });

        // 1.5 Fix image tables
        articleHtml = articleHtml.replace(/<table\b[^>]*class=["'][^"']*picture[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi, (match, inner) => {
            const imgMatch = inner.match(/<img\b([^>]*)>/i);
            const captionMatch = inner.match(/<td\b[^>]*class=["'][^"']*caption[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
            let resultHtml = '';
            if (imgMatch) {
                resultHtml += `<figure class="my-4"><img ${imgMatch[1]} class="w-full h-auto rounded-lg">`;
                if (captionMatch) {
                    resultHtml += `<figcaption class="text-sm text-center text-gray-500 mt-2">${captionMatch[1]}</figcaption>`;
                }
                resultHtml += `</figure>`;
                return resultHtml;
            }
            return match;
        });

        // 2. Format related items
        const allRelatedItems = [];
        const addItem = (href, title, img, desc) => {
            let absUrl = href;
            try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
            if (!allRelatedItems.some(item => item.href === absUrl)) {
                allRelatedItems.push({ href: absUrl, title, img, desc });
            }
        };

        const promises = [];

        const innerArticleRegex = /<(table|article)\b[^>]*class=["'][^"']*(?:article|article-item)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
        let innerMatch;
        while ((innerMatch = innerArticleRegex.exec(articleHtml)) !== null) {
            const inner = innerMatch[2];
            promises.push((async () => {
                const linkMatch = inner.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
                if (linkMatch) {
                    const relUrl = linkMatch[1];
                    let absUrl = relUrl;
                    try { absUrl = relUrl.startsWith('/') ? new URL(relUrl, url).href : relUrl; } catch(e) {}

                    const titleMatch = inner.match(/<h[234]\b[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/h[234]>/i);
                    let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
                    if (!title) {
                        const allLinks = [...inner.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
                        for (const a of allLinks) {
                            const t = a[1].replace(/<[^>]+>/g, '').trim();
                            if (t && t.length > title.length) title = t;
                        }
                    }

                    const descMatch = inner.match(/<p\b[^>]*class=["'][^"']*summary[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
                    let desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

                    const imgMatch = inner.match(/data-src=["']([^"']+)["']/i) || inner.match(/src=["']([^"']+)["']/i) || inner.match(/background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
                    let imgSrc = imgMatch ? imgMatch[1] : '';
                    if (imgSrc.startsWith('data:image/')) {
                         const realImgMatch = inner.match(/data-src=["']([^"']+)["']/i) || inner.match(/<noscript>\s*<img\b[^>]*src=["']([^"']+)["']/i);
                         if (realImgMatch) imgSrc = realImgMatch[1];
                    }

                    if (!imgSrc) {
                        imgSrc = await fetchOgImage(absUrl);
                    }
                    addItem(absUrl, title, imgSrc, desc);
                }
            })());
        }
        articleHtml = articleHtml.replace(innerArticleRegex, '');

        await Promise.all(promises);

        if (allRelatedItems.length > 0) {
            let relatedListHtml = `
<div class="embedded-suggested-articles">
    <div class="embedded-suggested-header">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        BÀI VIẾT LIÊN QUAN
    </div>
    <div class="embedded-suggested-carousel">`;
            for (const item of allRelatedItems) {
                relatedListHtml += `
                <div class="embedded-suggested-card">
                    <a href="${item.href}" target="_blank" class="embedded-suggested-overlay"></a>
                    ${item.img ? `<img src="${item.img}" class="embedded-suggested-image" alt="">` : ''}
                    <div class="embedded-suggested-content">
                        <div class="embedded-suggested-title">${item.title}</div>
                        ${item.desc ? `<div class="embedded-suggested-summary">${item.desc}</div>` : ''}
                    </div></div>`;
            }
            relatedListHtml += `</div></div>`;
            articleHtml += relatedListHtml;
        }

        return articleHtml;
    }
}
