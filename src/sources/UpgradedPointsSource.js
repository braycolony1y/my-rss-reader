export default class UpgradedPointsSource {
    match(hostname) {
        return hostname === 'upgradedpoints.com' || hostname.endsWith('.upgradedpoints.com');
    }

    parseArticleHtmlContent(html, url, result, utils) {
        const articleRegex = /<article\b[^>]*>([\s\S]*?)<\/article>/i;
        const match = html.match(articleRegex);
        if (match) {
            let articleHtml = match[1];
            // Remove TOC, author bio, social shares, disclosures
            articleHtml = articleHtml.replace(/<div[^>]*class=["'][^"']*(?:toc|table-of-contents|author-bio|social-share|disclosure)[^"']*["'][^>]*>[\s\S]*?<\/div>/ig, '');
            // Extract featured image from header if present
            const headerMatch = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/i);
            if (headerMatch) {
                const imgMatch = headerMatch[1].match(/<img[^>]*src=["']([^"']+)["'][^>]*>/i);
                if (imgMatch) {
                    articleHtml = `<img src="${imgMatch[1]}" style="width: 100%; border-radius: 8px; margin-bottom: 20px;">` + articleHtml;
                }
            }
            return articleHtml;
        }
        return null;
    }
}
