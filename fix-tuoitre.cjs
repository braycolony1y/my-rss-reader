const fs = require('fs');
const path = './src/sources/TuoitreSource.js';
let content = fs.readFileSync(path, 'utf8');

const regex = /\/\/ 1\. Process inline RelatedOneNews[\s\S]*?return articleHtml;/;

const replacement = `        const allRelatedItems = [];
        const addItem = (href, title, img, desc) => {
            let absUrl = href;
            try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
            if (!allRelatedItems.some(item => item.href === absUrl)) {
                allRelatedItems.push({ href: absUrl, title, img, desc });
            }
        };

        // 1. Process inline RelatedOneNews
        articleHtml = articleHtml.replace(/<div\\b[^>]*type=["']RelatedOneNews["'][^>]*>([\\s\\S]*?)<\\/div>\\s*<\\/div>/gi, (m, inner) => {
            const linkMatch = inner.match(/<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/i);
            if (linkMatch) {
                const relUrl = linkMatch[1];
                const relTitle = (linkMatch[2] || '').replace(/<[^>]+>/g, '').trim();
                const descMatch = inner.match(/<p\\b[^>]*class=["'][^"']*VCObjectBoxRelatedNewsItemSapo[^"']*["'][^>]*>([\\s\\S]*?)<\\/p>/i);
                const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
                addItem(relUrl, relTitle, '', desc);
            }
            return '';
        });

        // 2. Extract detail__related (Tin liên quan)
        const relatedMatch = html.match(/<div\\b[^>]*class=["'][^"']*detail__related[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>\\s*<\\/div>\\s*<\\/div>/i);
        if (relatedMatch) {
            const inner = relatedMatch[1];
            const itemRegex = /<article\\b[^>]*class=["'][^"']*box-category-item[^"']*["'][^>]*>([\\s\\S]*?)<\\/article>/gi;
            let itemMatch;
            while ((itemMatch = itemRegex.exec(inner)) !== null) {
                const itemHtml = itemMatch[1];
                const linkMatch = itemHtml.match(/<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/i);
                if (linkMatch) {
                    const relUrl = linkMatch[1];
                    const relTitle = (linkMatch[2] || '').replace(/<[^>]+>/g, '').trim() || (itemHtml.match(/title=["']([^"']+)["']/i) || [])[1] || '';
                    const imgMatch = itemHtml.match(/<img\\b[^>]*src=["']([^"']+)["']/i);
                    const imgSrc = imgMatch ? imgMatch[1] : '';
                    addItem(relUrl, relTitle, imgSrc, '');
                }
            }
        }

        // Clean up remaining noise
        articleHtml = articleHtml.replace(/<div\\b[^>]*type=["']RelatedNewsBox["'][^>]*>[\\s\\S]*?<\\/div>\\s*<\\/div>\\s*<\\/div>/gi, '');

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
console.log("Updated TuoitreSource.js");
