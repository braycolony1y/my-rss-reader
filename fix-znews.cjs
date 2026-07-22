const fs = require('fs');
const path = './src/sources/ZnewsSource.js';
let content = fs.readFileSync(path, 'utf8');

const regex = /\/\/ Extract related articles[\s\S]*?return articleHtml;/;

const replacement = `// Combine related articles
        const allRelatedItems = [];
        const addItem = (href, title, img, desc) => {
            let absUrl = href;
            try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
            if (!allRelatedItems.some(item => item.href === absUrl)) {
                allRelatedItems.push({ href: absUrl, title, img, desc });
            }
        };

        // Extract inline related
        articleHtml = articleHtml.replace(/<table\\b[^>]*class=["'][^"']*inner-article[^"']*["'][^>]*>([\\s\\S]*?)<\\/table>/gi, (m, inner) => {
            const linkMatch = inner.match(/<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/i);
            if (linkMatch) {
                const title = linkMatch[2].replace(/<[^>]+>/g, '').trim();
                addItem(linkMatch[1], title, '', '');
            }
            return '';
        });

        // Extract bottom related
        const relatedMatch = html.match(/<div\\b[^>]*class=["'][^"']*article-list[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>\\s*<\\/div>/i) ||
                             html.match(/<section\\b[^>]*class=["'][^"']*section-latest[^"']*["'][^>]*>([\\s\\S]*?)<\\/section>/i);
        
        if (relatedMatch) {
            const inner = relatedMatch[1];
            const itemRegex = /<article\\b[^>]*class=["'][^"']*article-item[^"']*["'][^>]*>([\\s\\S]*?)<\\/article>/gi;
            let itemMatch;
            while ((itemMatch = itemRegex.exec(inner)) !== null) {
                const itemHtml = itemMatch[1];
                const linkMatch = itemHtml.match(/<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/i);
                if (linkMatch) {
                    const relUrl = linkMatch[1];
                    const relTitle = (linkMatch[2] || '').replace(/<[^>]+>/g, '').trim() || (itemHtml.match(/title=["']([^"']+)["']/i) || [])[1] || '';
                    const imgMatch = itemHtml.match(/<img\\b[^>]*src=["']([^"']+)["']/i) || itemHtml.match(/<img\\b[^>]*data-src=["']([^"']+)["']/i);
                    const imgSrc = imgMatch ? imgMatch[1] : '';
                    const descMatch = itemHtml.match(/<p\\b[^>]*class=["'][^"']*article-summary[^"']*["'][^>]*>([\\s\\S]*?)<\\/p>/i);
                    const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
                    addItem(relUrl, relTitle, imgSrc, desc);
                }
            }
        }

        if (allRelatedItems.length > 0) {
            let itemsHtml = '';
            for (const item of allRelatedItems) {
                itemsHtml += createCardHtml(item.href, item.title, item.img, item.desc);
            }
            articleHtml += createSuggestedHtml('BÀI VIẾT LIÊN QUAN', itemsHtml);
        }

        return articleHtml;`;

content = content.replace(regex, replacement);
fs.writeFileSync(path, content);
console.log("Updated ZnewsSource.js");
