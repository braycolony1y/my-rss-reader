import { JSDOM } from 'jsdom';

export default class BBCSource {
    match(hostname) {
        return hostname.includes('bbc.co.uk') || hostname.includes('bbc.com');
    }

    parseArticleHtmlContent(html, url, result, utils) {
        const dom = new JSDOM(html);
        const document = dom.window.document;
        
        // BBC wraps the main content in <article> or <main>
        const article = document.querySelector('article') || document.querySelector('main');
        if (!article) return false;

        const allRelatedItems = [];
        const addItem = (itemUrl, title, img, desc) => {
            try {
                const absUrl = new URL(itemUrl, url).href;
                if (absUrl && !allRelatedItems.some(item => item.href === absUrl)) {
                    allRelatedItems.push({ href: absUrl, title, img, desc });
                }
            } catch(e) {}
        };

        // Extract "Related topics" and "More on this story"
        const headings = article.querySelectorAll('h2');
        headings.forEach(h2 => {
            const text = h2.textContent.toLowerCase();
            if (text.includes('related topics') || text.includes('more on this story')) {
                // Find the nearest ul or section next to it or parent
                const parent = h2.parentElement;
                if (parent) {
                    // Find all links in the same container or next siblings
                    let container = parent.nextElementSibling;
                    if (!container || !container.querySelector('a')) {
                        container = parent.parentElement;
                    }
                    if (container) {
                        const links = container.querySelectorAll('a');
                        links.forEach(a => {
                            const href = a.getAttribute('href');
                            const title = a.textContent.trim();
                            if (href && title) {
                                addItem(href, title, '', '');
                            }
                        });
                        container.remove();
                    }
                }
                h2.remove();
            }
        });

        // Remove any remaining unwanted elements like social share, etc.
        const removeSelectors = [
            '[data-component="share-panel"]',
            '[data-component="byline-block"]',
            '[data-testid="byline"]',
            '[data-component="sport-player-rater"]',
            '[data-component="rating"]'
        ];
        removeSelectors.forEach(sel => {
            article.querySelectorAll(sel).forEach(el => el.remove());
        });

        // Extract the title
        const h1 = document.querySelector('h1');
        const title = h1 ? h1.textContent.trim() : '';
        if (title) result.title = title;
        if (h1) h1.remove();

        // Clean image containers (BBC uses picture/source)
        article.querySelectorAll('figure').forEach(fig => {
            const img = fig.querySelector('img');
            const source = fig.querySelector('source');
            let src = '';
            if (source && source.getAttribute('srcset')) {
                // Get highest resolution from srcset
                const srcset = source.getAttribute('srcset');
                const parts = srcset.split(',').map(s => s.trim().split(' '));
                src = parts[parts.length - 1][0];
            } else if (img) {
                src = img.getAttribute('src');
            }
            
            if (src) {
                const caption = fig.querySelector('figcaption');
                const capText = caption ? caption.textContent.trim() : '';
                fig.outerHTML = `<div class="my-4"><img class="w-full rounded-xl" src="${src}" alt="${utils.escapeHtml(capText)}"></div>`;
            }
        });

        let articleHtml = article.innerHTML;

        if (allRelatedItems.length > 0) {
            let itemsHtml = '';
            for (const item of allRelatedItems) {
                itemsHtml += `<div class="styled-rel-card my-6 px-4 py-3.5 rounded-xl border-l-4 border-l-blue-600 dark:border-l-blue-500 bg-gray-50 dark:bg-gray-800/80 border border-gray-200/80 dark:border-gray-700 shadow-sm not-prose transition hover:shadow-md hover:border-l-blue-700">
                    <div class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-2">
                        <span>📰 Related</span>
                    </div>
                    <a href="${utils.escapeHtml(item.href)}" target="_blank" class="font-bold text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 text-base md:text-lg block leading-snug no-underline transition">${utils.escapeHtml(item.title)} →</a>
                </div>`;
            }
            articleHtml += `<div class="mt-8 border-t border-gray-200 dark:border-gray-700 pt-6">
                <h3 class="text-xl font-black text-gray-900 dark:text-gray-100 mb-4 tracking-tight">Bài viết liên quan / Xem thêm</h3>
                ${itemsHtml}
            </div>`;
        }

        return articleHtml;
    }
}
