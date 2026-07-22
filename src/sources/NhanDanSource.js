export default class NhanDanSource {
    match(hostname) {
        return hostname.includes('nhandan.vn');
    }

    async parseArticleHtmlContent(html, url, result, utils) {
        const fetchOgImage = async (absUrl) => {
            if (!utils || !utils.fetchWithTimeout) return '';
            try {
                const res = await utils.fetchWithTimeout(absUrl, {}, 3000);
                if (res.ok) {
                    const text = await res.text();
                    const ogMatch = text.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || 
                                    text.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
                    if (ogMatch) return ogMatch[1];
                }
            } catch(e) {}
            return '';
        };

        const createCardHtml = (href, title, img, desc) => {
            let absUrl = href;
            try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
            return `
            <div class="embedded-suggested-card">
                <a href="${absUrl}" target="_blank" class="embedded-suggested-overlay"></a>
                ${img ? `<img src="${img}" class="embedded-suggested-image" alt="">` : ''}
                <div class="embedded-suggested-content">
                    <div class="embedded-suggested-title">${title}</div>
                    ${desc ? `<div class="embedded-suggested-summary">${desc}</div>` : ''}
                </div></div>`;
        };

        const createSuggestedHtml = (title, itemsHtml) => {
            if (!itemsHtml) return '';
            return `
<div class="embedded-suggested-articles">
    <div class="embedded-suggested-header">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        ${title}
    </div>
    <div class="embedded-suggested-carousel">
        ${itemsHtml}
    </div>
</div>`;
        };

        // Extract Author
        const authorMatch = html.match(/<div\b[^>]*class=["'][^"']*article__author[^"']*["'][^>]*>\s*<p\b[^>]*class=["'][^"']*name[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) || 
                            html.match(/<div\b[^>]*class=["'][^"']*box-author[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
        if (authorMatch) {
            result.author = authorMatch[1].replace(/<[^>]+>/g, '').trim();
        }

        let articleHtml = '';
        const articleRegex = /<div\b[^>]*class=["'][^"']*(?:detail-content-body|article__body|detail__body)[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*article__author|<div\b[^>]*class=["'][^"']*box-author)/i;
        let match = html.match(articleRegex);
        if (!match) {
            match = html.match(/<div\b[^>]*class=["'][^"']*(?:detail-content-body|article__body|detail__body)[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*related-news|<\/div>\s*<\/div>\s*<\/div>|<\/article>)/i);
        }
        if (match) {
            articleHtml = match[1];
        } else {
            articleHtml = html; // fallback
        }

        // Clean up ads
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*sda_middle[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi, '');
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*rennab[^>]*>[\s\S]*?<\/div>/gi, '');

        // Extract "Tin liên quan" (.related-news) from full HTML
        const relatedMatch = html.match(/<div\b[^>]*class=["'][^"']*related-news[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) || 
                             html.match(/<div\b[^>]*class=["'][^"']*related-news[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*author-info|<div\b[^>]*class=["'][^"']*article-footer)/i) ||
                             html.match(/<div\b[^>]*data-source=["']related-news["'][^>]*>([\s\S]*?)<\/div>/i);
        
        if (relatedMatch) {
            const inner = relatedMatch[1];
            let itemsHtml = '';
            const itemRegex = /<article\b[^>]*class=["'][^"']*story[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;
            let itemMatch;
            const items = [];
            while ((itemMatch = itemRegex.exec(inner)) !== null) {
                items.push(itemMatch[1]);
            }
            
            for (const itemHtml of items) {
                const linkMatch = itemHtml.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
                if (linkMatch) {
                    const relUrl = linkMatch[1];
                    const relTitle = (linkMatch[2] || '').replace(/<[^>]+>/g, '').trim() || itemHtml.match(/title=["']([^"']+)["']/i)?.[1] || '';
                    const absUrl = relUrl.startsWith('/') ? new URL(relUrl, url).href : relUrl;
                    
                    let imgSrc = '';
                    const imgMatch = itemHtml.match(/<img\b[^>]*src=["']([^"']+)["']/i) || itemHtml.match(/<img\b[^>]*data-src=["']([^"']+)["']/i);
                    if (imgMatch) {
                        imgSrc = imgMatch[1];
                    } else {
                        imgSrc = await fetchOgImage(absUrl);
                    }

                    itemsHtml += createCardHtml(absUrl, relTitle, imgSrc, '');
                }
            }
            
            if (itemsHtml) {
                articleHtml += createSuggestedHtml('BÀI VIẾT LIÊN QUAN', itemsHtml);
            }
        }

        // Clean up any stray related-news blocks from articleHtml
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*related-news[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi, '');
        articleHtml = articleHtml.replace(/<div\b[^>]*data-source=["']related-news["'][^>]*>([\s\S]*?)<\/div>/gi, '');

        return articleHtml;
    }
}
