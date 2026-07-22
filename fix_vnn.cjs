const fs = require('fs');

let code = `export default class VietnamnetSource {
    match(hostname) {
        return hostname.includes('vietnamnet.vn');
    }

    async preProcessHtml(html, utils) {
        let newHtml = html;
        const vnnEmbeds = [...newHtml.matchAll(/<iframe[^>]*src=["'](https:\\/\\/embed\\.vietnamnet\\.vn\\/[^"']+)["'][^>]*>/gi)];
        for (const match of vnnEmbeds) {
            try {
                const embedRes = await utils.fetchWithTimeout(match[1], { headers: { 'Referer': 'https://vietnamnet.vn/' } }, 3000);
                if (embedRes.ok) {
                    const embedHtml = await embedRes.text();
                    const mp4Match = embedHtml.match(/var\\s+mp4\\s*=\\s*['"]([^'"]+\\.mp4[^'"]*)['"]/i);
                    if (mp4Match) {
                        const mp4Url = mp4Match[1];
                        newHtml = newHtml.replace(match[0], \`<video src="\${mp4Url}" controls playsinline></video>\`);
                    }
                }
            } catch(e) {}
        }
        return newHtml;
    }

    parseArticleHtmlContent(html, url, result, utils) {
        // Extract Time
        const publishDateMatch = html.match(/<div\\b[^>]*class=["'][^"']*publish-date[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>/i);
        if (publishDateMatch) {
            result.date = publishDateMatch[1].trim();
        }

        // Extract Author
        const authorMatch = html.match(/<div\\b[^>]*class=["'][^"']*article-detail-author__name[^"']*["'][^>]*>\\s*<a[^>]*>([\\s\\S]*?)<\\/a>/i) || html.match(/<span\\b[^>]*class=["'][^"']*article-detail-author__name[^"']*["'][^>]*>([\\s\\S]*?)<\\/span>/i);
        if (authorMatch) {
            result.author = authorMatch[1].trim();
        }
        
        let articleHtml = '';
        const articleRegex = /<div\\b[^>]*class=["'][^"']*(?:maincontent|article-content|content-detail)[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>\\s*<div\\b[^>]*class=["'][^"']*article-detail-author-wrapper/i;
        let match = html.match(articleRegex);
        if (!match) {
            match = html.match(/<div\\b[^>]*class=["'][^"']*(?:maincontent|article-content|content-detail)[^"']*["'][^>]*>([\\s\\S]*?)(?:<div\\b[^>]*class=["'][^"']*article-detail-author-wrapper|<div\\b[^>]*id=["']insert-rating)/i);
        }
        if (match) {
            articleHtml = match[1];
        }

        if (articleHtml) {
            // Re-format related blocks (ck-cms-insert-news)
            const insertGroupRegex = /<div\\b[^>]*class=["'][^"']*ck-cms-insert-neww-group[^>]*>([\\s\\S]*?)<\\/div>\\s*<\\/div>/gi;
            articleHtml = articleHtml.replace(insertGroupRegex, (m, groupContent) => {
                let relatedListHtml = \`<div class="vnn-related-articles bg-gray-50 dark:bg-gray-800 p-4 rounded-xl my-4 border border-gray-200 dark:border-gray-700"><ul>\`;
                const newsRegex = /<article\\b[^>]*class=["'][^"']*ck-cms-insert-news[^>]*>([\\s\\S]*?)<\\/article>/gi;
                let newsMatch;
                let foundAny = false;
                while ((newsMatch = newsRegex.exec(m)) !== null) {
                    foundAny = true;
                    const inner = newsMatch[1];
                    const linkMatch = inner.match(/<a\\b[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']+)["']/i);
                    if (linkMatch) {
                        const relUrl = linkMatch[1];
                        const relTitle = linkMatch[2];
                        const absUrl = relUrl.startsWith('/') ? new URL(relUrl, url).href : relUrl;
                        relatedListHtml += \`<li class="mb-2"><a href="\${absUrl}" class="font-semibold text-blue-600 dark:text-blue-400 hover:underline">\${relTitle}</a></li>\`;
                    }
                }
                relatedListHtml += \`</ul></div>\`;
                return foundAny ? relatedListHtml : m;
            });
            
            // Format related list (related-news)
            const relatedNewsRegex = /<div\\b[^>]*class=["'][^"']*related-news[^>]*>([\\s\\S]*?)<\\/div>\\s*<\\/div>/gi;
            articleHtml = articleHtml.replace(relatedNewsRegex, (m, groupContent) => {
                let relatedListHtml = \`<div class="vnn-related-list bg-blue-50 dark:bg-blue-900/30 p-4 rounded-xl my-4 border border-blue-100 dark:border-blue-800/50"><ul>\`;
                const liRegex = /<li\\b[^>]*>([\\s\\S]*?)<\\/li>/gi;
                let liMatch;
                let foundAny = false;
                while ((liMatch = liRegex.exec(m)) !== null) {
                    foundAny = true;
                    const inner = liMatch[1];
                    const linkMatch = inner.match(/<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/i);
                    if (linkMatch) {
                        const relUrl = linkMatch[1];
                        const relTitle = linkMatch[2].replace(/<[^>]+>/g, '').trim();
                        const absUrl = relUrl.startsWith('/') ? new URL(relUrl, url).href : relUrl;
                        relatedListHtml += \`<li class="mb-2"><a href="\${absUrl}" class="font-semibold text-blue-600 dark:text-blue-400 hover:underline">\${relTitle}</a></li>\`;
                    }
                }
                relatedListHtml += \`</ul></div>\`;
                return foundAny ? relatedListHtml : m;
            });
        }
        
        return articleHtml;
    }
}
\`;

fs.writeFileSync('src/sources/VietnamnetSource.js', code);
