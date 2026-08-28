import * as cheerio from 'cheerio/slim';

export default class BBCSource {
    match(hostname) {
        return hostname.includes('bbc.co.uk') || hostname.includes('bbc.com');
    }

    parseArticleHtmlContent(html, url, result, utils) {
        const $ = cheerio.load(html);
        
        // BBC wraps the main content in <article> or <main>
        let article = $('article').first();
        if (!article.length) article = $('main').first();
        if (!article.length) return false;

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
        article.find('h2').each((_, h2Element) => {
            const h2 = $(h2Element);
            const text = h2.text().toLowerCase();
            if (text.includes('related topics') || text.includes('more on this story')) {
                // Find the nearest ul or section next to it or parent
                const parent = h2.parent();
                if (parent.length) {
                    // Find all links in the same container or next siblings
                    let container = parent.next();
                    if (!container.length || !container.find('a').length) {
                        container = parent.parent();
                    }
                    if (container.length) {
                        container.find('a').each((__, linkElement) => {
                            const link = $(linkElement);
                            const href = link.attr('href');
                            const title = link.text().trim();
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

        const removeSelectors = [
            '[data-component="share-panel"]',
            '[data-component="byline-block"]',
            '[data-testid="byline"]',
            '[data-component="sport-player-rater"]',
            '[data-component="rating"]'
        ];
        removeSelectors.forEach(sel => {
            article.find(sel).remove();
        });

        // Remove "Được đăng" and "Thời gian đọc" divs
        article.find('div, time').each((_, element) => {
            const node = $(element);
            const text = node.text().trim().toLowerCase();
            if (text.startsWith('được đăng') || text.startsWith('thời gian đọc')) {
                node.remove();
            }
        });

        // Extract the title
        const h1 = $('h1').first();
        const title = h1.length ? h1.text().trim() : '';
        if (title) result.title = title;
        if (h1.length) h1.remove();

        // Clean image containers (BBC uses picture/source)
        article.find('figure').each((_, figureElement) => {
            const figure = $(figureElement);
            const img = figure.find('img').first();
            const source = figure.find('source').first();
            let src = '';
            if (source.length && source.attr('srcset')) {
                // Get highest resolution from srcset
                const srcset = source.attr('srcset');
                const parts = srcset.split(',').map(s => s.trim().split(' '));
                src = parts[parts.length - 1][0];
            } else if (img.length) {
                src = img.attr('src');
            }
            
            if (src) {
                const caption = figure.find('figcaption').first();
                const capText = caption.length ? caption.text().trim() : '';
                figure.replaceWith(`<div class="my-4"><img class="w-full rounded-xl" src="${utils.escapeHtml(src)}" alt="${utils.escapeHtml(capText)}"></div>`);
            }
        });

        let articleHtml = article.html();

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
                <h3 class="text-xl font-black text-gray-900 dark:text-gray-100 mb-4 tracking-tight">Đọc nhiều nhất</h3>
                ${itemsHtml}
            </div>`;
        }

        return articleHtml;
    }
}
