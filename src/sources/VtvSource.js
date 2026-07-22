export default class VtvSource {
    match(hostname) {
        return hostname.includes('vtv.vn');
    }

    parseArticleHtmlContent(html, url, result, utils) {
        let articleHtml = '';
        
        // Extract article body
        const articleBodyMatch = html.match(/<div\b[^>]*class=["'][^"']*detail-content[^"']*["'][^>]*>([\s\S]*?)<div\b[^>]*data-check-position=["']body_end["']/i) ||
                                 html.match(/<div\b[^>]*class=["'][^"']*detail-content[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*VCSortableInPreviewMode[^"']*["'][^>]*type=["']RelatedNewsBox["']|<div\b[^>]*class=["'][^"']*admWrapsite["'])/i);
                                 
        if (articleBodyMatch) {
            articleHtml = articleBodyMatch[1];
        } else {
            const match = html.match(/<div\b[^>]*class=["'][^"']*noidung[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*tin-lien-quan["']|<div\b[^>]*class=["'][^"']*tags["'])/i);
            articleHtml = match ? match[1] : html;
        }

        // Helper to create suggested articles UI
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

        // Extract "Tin liên quan" from box-category-item
        let itemsHtml = '';
        const itemRegex = /<article\b[^>]*class=["'][^"']*box-category-item[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;
        let itemMatch;
        while ((itemMatch = itemRegex.exec(html)) !== null) {
            const itemHtml = itemMatch[1];
            const linkMatch = itemHtml.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
            if (linkMatch) {
                const relUrl = linkMatch[1];
                let relTitle = (linkMatch[2] || '').replace(/<[^>]+>/g, '').trim();
                if (!relTitle) {
                    const titleMatch = itemHtml.match(/title=["']([^"']+)["']/i);
                    relTitle = titleMatch ? titleMatch[1] : '';
                }
                const imgMatch = itemHtml.match(/<img\b[^>]*src=["']([^"']+)["']/i);
                const imgSrc = imgMatch ? imgMatch[1] : '';
                
                // Get summary if exists
                const sapoMatch = itemHtml.match(/<div\b[^>]*data-type=["']sapo["'][^>]*>([\s\S]*?)<\/div>/i) || itemHtml.match(/<div\b[^>]*class=["'][^"']*box-category-sapo[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
                const desc = sapoMatch ? sapoMatch[1].replace(/<[^>]+>/g, '').trim() : '';
                
                itemsHtml += createCardHtml(relUrl, relTitle, imgSrc, desc);
            }
        }
        
        if (itemsHtml) {
            articleHtml += createSuggestedHtml('BÀI VIẾT LIÊN QUAN', itemsHtml);
        }

        return articleHtml;
    }
}
