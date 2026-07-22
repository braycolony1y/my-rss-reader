export default class CafeFSource {
    match(hostname) {
        return hostname.includes('cafef.vn');
    }

    parseArticleHtmlContent(html, url, result, utils) {
        let articleHtml = '';
        const articleBodyMatch = html.match(/<div\b[^>]*class=["'][^"']*detail-content[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*bottom-wrapper[^"']*["']|<div\b[^>]*class=["'][^"']*tags[^"']*["']|$)/i);
        
        if (articleBodyMatch) {
            articleHtml = articleBodyMatch[1];
        } else {
            articleHtml = html;
        }

        // Clean up stock ticker box and related news
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*chisochungkhoan[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/gi, '');
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*chisochungkhoan[^"']*["'][^>]*>[\s\S]*?(?:(?=<p)|(?=<div)|(?=<h2))/gi, '');
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*tintucsukien[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, '');
        articleHtml = articleHtml.replace(/<h2\b[^>]*class=["'][^"']*title_box[^"']*["'][^>]*>[\s\S]*?Giá hiện tại[\s\S]*?Xem hồ sơ doanh nghiệp[\s\S]*?<\/a>\s*<\/div>\s*<\/div>/gi, '');
        
        return articleHtml;
    }
}
