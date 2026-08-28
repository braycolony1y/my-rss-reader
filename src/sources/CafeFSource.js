export default class CafeFSource {
    match(hostname) {
        return hostname.includes('cafef.vn');
    }

    parseArticleHtmlContent(html, url, result, utils) {
        let articleHtml = '';
        const articleBodyMatch = html.match(/<div\b[^>]*class=["'][^"']*detail-content[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*w640 fr clear|<div\b[^>]*class=["'][^"']*bottom-wrapper|<div\b[^>]*class=["'][^"']*row1[^"']*["'][^>]*>[\s\S]*?Từ Khóa|<div\b[^>]*class=["'][^"']*tags[^"']*["']|CÙNG CHUYÊN MỤC)/i);
        
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
        
        // Clean up "TIN MỚI" or other embedded related news blocks
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*tindnd[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, '');
        articleHtml = articleHtml.replace(/<div\b[^>]*data-marked-zoneid=["'](?:cafef_detail_relatednewsbox|cf_detail_b1)["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, '');
        articleHtml = articleHtml.replace(/<(div|figure)\b[^>]*type=["']Related(One)?News["'][^>]*>[\s\S]*?<\/\1>/gi, '');
        
        // Clean up ads and banners
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*(?:h-show-pc|h-show-mobile|c-banner)[^"']*["'][^>]*>[\s\S]*?<!--end container-->\s*<\/div>/gi, '');
        articleHtml = articleHtml.replace(/<div\b[^>]*id=["']admzone[^"']*["'][^>]*>[\s\S]*?(?:<\/script>|<\/div>)/gi, '');
        articleHtml = articleHtml.replace(/<script>[\s\S]*?admicroAD\.show[\s\S]*?<\/script>/gi, '');
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*tincungmucdetail[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi, '');
        articleHtml = articleHtml.replace(/<div\b[^>]*data-marked-zoneid=["']cf_detail_b1["'][^>]*>[\s\S]*?$/gi, ''); // It's usually at the very end
        
        return articleHtml;
    }
}
