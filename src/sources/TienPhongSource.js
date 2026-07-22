export default class TienPhongSource {
    match(hostname) {
        return hostname.includes('tienphong.vn');
    }

    parseArticleHtmlContent(html, url, result, utils) {
        // Extract Author
        const authorMatch = html.match(/<div[^>]*class=["'][^"']*author[^"']*["'][^>]*>[\s\S]*?<\/span>([^<]+)/i) || 
                            html.match(/class=["']article__author["'][^>]*>\s*<span[^>]*>[\s\S]*?<\/span>\s*([^<]+)<\/div>/i);
        if (authorMatch) {
            result.author = authorMatch[1].trim();
        }

        let articleHtml = '';
        const articleBodyMatch = html.match(/<div\b[^>]*class=["'][^"']*article__body[^"']*["'][^>]*>([\s\S]*?)<div\b[^>]*class=["'][^"']*(article-footer|article__tag)/i) || 
                                 html.match(/<div\b[^>]*class=["'][^"']*article__body[^"']*["'][^>]*>([\s\S]*)/i);
        if (articleBodyMatch) {
            articleHtml = articleBodyMatch[1];
        } else {
            articleHtml = html; // fallback
        }

        if (articleHtml) {
            // Remove banners/ads (class="rennab")
            articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*rennab[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');

            // In-article relate (article-relate or article__relate)
            const articleRelateRegex = /<div\b[^>]*class=["'][^"']*article[-_]relate[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>\s*<\/div>)?/gi;
            articleHtml = articleHtml.replace(articleRelateRegex, (m, inner) => {
                let relatedListHtml = `<div class="tp-related-articles bg-gray-50 dark:bg-gray-800 p-4 rounded-xl my-4 border border-gray-200 dark:border-gray-700"><ul>`;
                const relateRegex = /<article\b[^>]*class=["'][^"']*story[^>]*>([\s\S]*?)<\/article>/gi;
                let newsMatch;
                let found = false;
                while ((newsMatch = relateRegex.exec(inner)) !== null) {
                    found = true;
                    const innerArticle = newsMatch[1];
                    const linkMatch = innerArticle.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']+)["']/i);
                    if (linkMatch) {
                        const relUrl = linkMatch[1];
                        const relTitle = linkMatch[2].replace(/<[^>]+>/g, '').trim();
                        const absUrl = relUrl.startsWith('/') ? new URL(relUrl, url).href : relUrl;
                        relatedListHtml += `<li class="mb-2"><a href="${absUrl}" class="font-semibold text-blue-600 dark:text-blue-400 hover:underline">${relTitle}</a></li>`;
                    }
                }
                relatedListHtml += `</ul></div>`;
                return found ? relatedListHtml : m;
            });
        }
        
        // Find trailing related-news block
        const relatedNewsRegex = /<div\b[^>]*class=["'][^"']*related-news[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
        let trailingHtml = '';
        html.replace(relatedNewsRegex, (m) => {
            let relatedListHtml = `<div class="tp-related-news bg-blue-50 dark:bg-blue-900/30 p-4 rounded-xl my-4 border border-blue-100 dark:border-blue-800/50">
                <h3 class="font-bold text-lg mb-2 text-blue-800 dark:text-blue-300">Xem thêm</h3><ul>`;
            const relateRegex = /<article\b[^>]*class=["'][^"']*story[^>]*>([\s\S]*?)<\/article>/gi;
            let newsMatch;
            let found = false;
            while ((newsMatch = relateRegex.exec(m)) !== null) {
                found = true;
                const inner = newsMatch[1];
                const linkMatch = inner.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']+)["']/i);
                if (linkMatch) {
                    const relUrl = linkMatch[1];
                    const relTitle = linkMatch[2].replace(/<[^>]+>/g, '').trim();
                    const absUrl = relUrl.startsWith('/') ? new URL(relUrl, url).href : relUrl;
                    relatedListHtml += `<li class="mb-2"><a href="${absUrl}" class="font-semibold text-blue-600 dark:text-blue-400 hover:underline">${relTitle}</a></li>`;
                }
            }
            relatedListHtml += `</ul></div>`;
            if (found) trailingHtml += relatedListHtml;
        });
        
        if (trailingHtml) {
            articleHtml += trailingHtml;
        }

        return articleHtml;
    }
}
