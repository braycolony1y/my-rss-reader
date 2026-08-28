export default class VovSource {
    match(hostname) {
        return hostname.includes('vov.vn');
    }

    async getBestImage(targetUrl, fetchFn, rssFallback, utils) {
        try {
            const fetchUrl = utils.CF_PROXY_BASE + encodeURIComponent(targetUrl);
            const res = await fetchFn(fetchUrl);
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

    parseArticleHtmlContent(html, url, result, utils) {
        // Extract og:image if missing
        if (!result.image) {
            const ogImageMatch = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                                 html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
            if (ogImageMatch) result.image = ogImageMatch[1];
        }

        // Extract author if missing
        if (!result.author) {
            const authorMatch = html.match(/<a\b[^>]*href=["']\/author\?[^>]+>([^<]+)<\/a>/i) || 
                                html.match(/<div\b[^>]*class=["'][^"']*article-author[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
            if (authorMatch) result.author = authorMatch[1].replace(/<[^>]+>/g, '').trim();
        }

        let articleHtml = '';
        const articleBodyMatch = html.match(/<div\b[^>]*class=["'][^"']*text-long[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*class=["']author/i) || 
                                 html.match(/<div\b[^>]*class=["'][^"']*text-long[^"']*["'][^>]*>([\s\S]*?)(?:<\/div>\s*<div\b[^>]*class=["']row|$)/i);
        if (articleBodyMatch) {
            articleHtml = articleBodyMatch[1];
        } else {
            articleHtml = html; // fallback
        }
        
        return articleHtml;
    }
}
