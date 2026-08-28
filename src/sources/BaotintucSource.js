import https from 'https';

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

    parseArticleHtmlContent(html, url, result, utils) {
        let articleHtml = '';
        const articleBodyMatch = html.match(/<div\b[^>]*class=["'][^"']*contents[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["']author|$)/i) || 
                                 html.match(/<div\b[^>]*class=["'][^"']*detail-content[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["']tag|$)/i);
        
        if (articleBodyMatch) {
            articleHtml = articleBodyMatch[1];
        } else {
            articleHtml = html; // fallback
        }

        // Remove unnecessary info
        articleHtml = articleHtml.replace(/<script[\s\S]*?<\/script>/gi, '');
        articleHtml = articleHtml.replace(/<!--[\s\S]*?-->/gi, '');
        articleHtml = articleHtml.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
        const relatedRegex = /<div\b[^>]*class=["'][^"']*(?:box-tinlienquan|tin-lien-quan|box-info)[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi;
        articleHtml = articleHtml.replace(relatedRegex, '');
        
        return articleHtml;
    }
}
