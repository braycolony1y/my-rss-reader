export default class DanvietSource {
    match(hostname) {
        return hostname.includes('danviet.vn');
    }

    parseArticleHtmlContent(html, url, result, utils) {
        let articleHtml = '';
        
        // Isolate the main article body
        const entryBodyMatch = html.match(/<div\b[^>]*class=["'][^"']*entry-body[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*box-samecat|<div\b[^>]*class=["'][^"']*box-related)/i);
        const detailMainMatch = html.match(/<div\b[^>]*class=["'][^"']*detail-main[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i);
        
        if (entryBodyMatch) {
            articleHtml = entryBodyMatch[1];
        } else if (detailMainMatch) {
            articleHtml = detailMainMatch[1];
        } else {
            articleHtml = html;
        }

        // Clean up cruft
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*advertisement-container[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*boxnews-right[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*none_adsgg_auto[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
        
        // Extract Sapo manually if possible since it might be outside the body
        const sapoMatch = html.match(/<div\b[^>]*class=["'][^"']*sapo[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
        if (sapoMatch && !result.description) {
            const tempSapo = sapoMatch[1].replace(/<[^>]+>/g, '').trim();
            if (tempSapo.length > 20) {
                result.description = tempSapo;
            }
        }
        
        // Fix Danviet images
        articleHtml = articleHtml.replace(/<img\b([^>]*)data-src=["']([^"']+)["']([^>]*)>/gi, '<img $1src="$2"$3>');

        return articleHtml;
    }
}
