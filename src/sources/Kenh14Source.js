export default class Kenh14Source {
    match(hostname) {
        return hostname.includes('kenh14.vn');
    }

    async getBestImage(targetUrl, fetchFn, rssFallback, utils) {
        try {
            const fetchUrl = utils.CF_PROXY_BASE + encodeURIComponent(targetUrl);
            const res = await fetchFn(fetchUrl);
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

    async parseArticleHtmlContent(html, url, result, utils) {
        let detailContent = utils.extractBalancedElementByClass(html, 'detail-content');
        if (!detailContent) return false;

        const removeBalanced = (htmlStr, className) => {
            const regex = new RegExp(`<div\\b[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>`, 'i');
            let match;
            let attempts = 0;
            while ((match = regex.exec(htmlStr)) !== null && attempts++ < 20) {
                const startIndex = match.index;
                let count = 1;
                let i = startIndex + match[0].length;
                while (count > 0 && i < htmlStr.length) {
                    const nextDivOpen = htmlStr.toLowerCase().indexOf('<div', i);
                    const nextDivClose = htmlStr.toLowerCase().indexOf('</div', i);
                    if (nextDivClose === -1) break;
                    
                    if (nextDivOpen !== -1 && nextDivOpen < nextDivClose) {
                        count++;
                        i = nextDivOpen + 4;
                    } else {
                        count--;
                        i = nextDivClose + 5;
                    }
                }
                const closeTagEnd = htmlStr.indexOf('>', i);
                const endIndex = closeTagEnd !== -1 ? closeTagEnd + 1 : i;
                htmlStr = htmlStr.substring(0, startIndex) + htmlStr.substring(endIndex);
            }
            return htmlStr;
        };

        detailContent = removeBalanced(detailContent, 'link-source-detail');
        detailContent = removeBalanced(detailContent, 'knc-rate-link');
        detailContent = removeBalanced(detailContent, 'klw-new-tags');
        detailContent = removeBalanced(detailContent, 'same-category-stream');
        detailContent = removeBalanced(detailContent, 'tincungmucfocus');

        // Kenh14 inserts a visible label for an in-article advertising slot.
        // It is page chrome rather than editorial copy, so never render it in
        // the reader. The surrounding article paragraphs must remain intact.
        detailContent = detailContent.replace(
            /<(p|div|span|section)\b[^>]*>\s*Quảng cáo\s*<\/\1>/giu,
            ''
        );
        
        const fetchOgImage = async (absUrl) => {
            if (!utils || !utils.fetchWithTimeout) return '';
            try {
                const res = await utils.fetchWithTimeout(absUrl, {}, 3000);
                if (res.ok) {
                    const text = await res.text();
                    const ogMatch = text.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || text.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
                    if (ogMatch) return ogMatch[1];
                }
            } catch(e) {}
            return '';
        };

        const allRelatedItems = [];
        const addItem = (href, title, img, desc) => {
            let absUrl = href;
            try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
            if (!allRelatedItems.some(item => item.href === absUrl)) {
                allRelatedItems.push({ href: absUrl, title, img, desc });
            }
        };

        const promises = [];

        detailContent = detailContent.replace(/<div\b[^>]*class=["'][^"']*knc-relate-wrapper[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi, (match, inner) => {
            const links = [...inner.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
            for (const l of links) {
                promises.push((async () => {
                    const href = l[1];
                    const titleText = l[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                    if (!titleText) return;
                    let absUrl = href;
                    try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
                    
                    const imgSrc = await fetchOgImage(absUrl);
                    addItem(absUrl, titleText, imgSrc, '');
                })());
            }
            return ''; // Remove from original position
        });

        await Promise.all(promises);
        
        let headerHtml = '';
        const sapo = utils.extractBalancedElementByClass(html, 'knc-sapo');
        if (sapo) {
            headerHtml += `<p class="font-bold text-lg mb-4 text-gray-800 dark:text-gray-200">${sapo.trim()}</p>\n`;
        }
        
        let finalHtml = headerHtml + detailContent;
        
        if (allRelatedItems.length > 0) {
            let relatedListHtml = `\n<div class="embedded-suggested-articles">\n    <div class="embedded-suggested-header">\n        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>\n        BÀI VIẾT LIÊN QUAN\n    </div>\n    <div class="embedded-suggested-carousel">`;
            for (const item of allRelatedItems) {
                relatedListHtml += `\n                <div class="embedded-suggested-card">\n                    <a href="${item.href}" target="_blank" class="embedded-suggested-overlay"></a>\n                    ${item.img ? `<img src="${item.img}" class="embedded-suggested-image" alt="">` : ''}\n                    <div class="embedded-suggested-content">\n                        <div class="embedded-suggested-title">${item.title}</div>\n                        ${item.desc ? `<div class="embedded-suggested-summary">${item.desc}</div>` : ''}\n                    </div></div>`;
            }
            relatedListHtml += `</div></div>`;
            finalHtml += relatedListHtml;
        }
        
        return finalHtml;
    }
}
