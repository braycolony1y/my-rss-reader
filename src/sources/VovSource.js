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
        let articleHtml = '';
        const articleBodyMatch = html.match(/<div\b[^>]*class=["'][^"']*text-long[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*class=["']author/i) || 
                                 html.match(/<div\b[^>]*class=["'][^"']*text-long[^"']*["'][^>]*>([\s\S]*?)(?:<\/div>\s*<div\b[^>]*class=["']row|$)/i);
        if (articleBodyMatch) {
            articleHtml = articleBodyMatch[1];
        } else {
            articleHtml = html; // fallback
        }

        // Remove unnecessary info (inner-article / related links inside text)
        const innerArticleRegex = /<article\b[^>]*class=["'][^"']*inner-article[^"']*["'][^>]*>[\s\S]*?<\/article>/gi;
        articleHtml = articleHtml.replace(innerArticleRegex, '');
        
        return articleHtml;
    }
}
