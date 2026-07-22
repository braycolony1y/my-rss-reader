export default class VietnamplusSource {
    match(hostname) {
        return hostname.includes('vietnamplus.vn');
    }

    parseArticleHtmlContent(html, url, result, utils) {
        let articleHtml = '';

        let avatarHtml = '';
        if (utils && utils.extractBalancedElementByClass) {
            const avatarContent = utils.extractBalancedElementByClass(html, 'article__avatar');
            if (avatarContent && (avatarContent.includes('<video') || avatarContent.includes('<iframe'))) {
                avatarHtml = `<div class="article-avatar">${avatarContent}</div>`;
            }
        }

        const articleBodyMatch = html.match(/<div\b[^>]*class=["'][^"']*article__body[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*article__tag|<div\b[^>]*class=["'][^"']*article__author)/i);
        if (articleBodyMatch) {
            articleHtml = articleBodyMatch[1];
            // Remove the last </div> if it is unmatched due to regex stopping at article__tag
            const lastDiv = articleHtml.lastIndexOf('</div>');
            if (lastDiv !== -1) {
                articleHtml = articleHtml.substring(0, lastDiv);
            }
            if (avatarHtml) {
                articleHtml = avatarHtml + articleHtml;
            }
        } else if (avatarHtml) {
            articleHtml = avatarHtml;
        } else {
            return false;
        }

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

        const allRelatedItems = [];
        const addItem = (href, title, img, desc) => {
            let absUrl = href;
            try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
            if (!allRelatedItems.some(item => item.href === absUrl)) {
                allRelatedItems.push({ href: absUrl, title, img, desc });
            }
        };

        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*article-relate[^"']*["'][^>]*>([\s\S]*?)<\/article>\s*<\/div>/gi, (m, inner) => {
            const fullInner = inner + '</article>';
            const items = fullInner.split(/<article\b[^>]*>/i).slice(1);
            for (const itemHtml of items) {
                const linkMatch = itemHtml.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']+)["']/i) || itemHtml.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
                if (linkMatch) {
                    const relUrl = linkMatch[1];
                    const relTitle = (linkMatch[2] || '').replace(/<[^>]+>/g, '').trim();
                    
                    let imgSrc = '';
                    const dataSrcMatch = itemHtml.match(/data-src=["']([^"']+)["']/i);
                    if (dataSrcMatch) {
                        imgSrc = dataSrcMatch[1];
                    } else {
                        const imgMatch = itemHtml.match(/<img\b[^>]*src=["']([^"']+)["']/i);
                        if (imgMatch) imgSrc = imgMatch[1];
                    }

                    addItem(relUrl, relTitle, imgSrc, '');
                }
            }
            return '';
        });

        if (allRelatedItems.length > 0) {
            let itemsHtml = '';
            for (const item of allRelatedItems) {
                itemsHtml += createCardHtml(item.href, item.title, item.img, item.desc);
            }
            articleHtml += createSuggestedHtml('BÀI VIẾT LIÊN QUAN', itemsHtml);
        }

        return articleHtml;
    }
}
