const fs = require('fs');
const path = './src/sources/VtvSource.js';
let content = fs.readFileSync(path, 'utf8');

const regex = /\/\/ Clean up some noise[\s\S]*?return articleHtml;/;

const replacement = `// Clean up some noise
        articleHtml = articleHtml.replace(/<div[^>]*class=["'][^"']*VCSortableInPreviewMode[^"']*["'][^>]*type=["']Photo["'][^>]*>[\\s\\S]*?<\\/div>\\s*<\\/div>/gi, '');

        const allRelatedItems = [];
        const addItem = (href, title, img, desc) => {
            let absUrl = href;
            try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
            if (!allRelatedItems.some(item => item.href === absUrl)) {
                allRelatedItems.push({ href: absUrl, title, img, desc });
            }
        };

        articleHtml = articleHtml.replace(/<div\\b[^>]*type=["']insertnews["'][^>]*>([\\s\\S]*?)<\\/div>\\s*<\\/div>/gi, (m, inner) => {
            const linkMatch = inner.match(/<a\\b[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']+)["']/i);
            if (linkMatch) {
                addItem(linkMatch[1], linkMatch[2].trim(), '', '');
            }
            return '';
        });

        const authorMatch = html.match(/<p\\b[^>]*class=["'][^"']*author[^"']*["'][^>]*>([\\s\\S]*?)<\\/p>/i) ||
                            html.match(/<div\\b[^>]*class=["'][^"']*author[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>/i);
        if (authorMatch && result) {
            result.author = authorMatch[1].replace(/<[^>]+>/g, '').trim();
        }

        const createSuggestedHtml = (title, itemsHtml) => {
            if (!itemsHtml) return '';
            return \`
<div class="embedded-suggested-articles">
    <div class="embedded-suggested-header">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        \${title}
    </div>
    <div class="embedded-suggested-carousel">
        \${itemsHtml}
    </div>
</div>\`;
        };

        const createCardHtml = (href, title, img, desc) => {
            let absUrl = href;
            try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
            return \`
            <a href="\${absUrl}" class="embedded-suggested-card font-bold text-gray-900" target="_blank">
                \${img ? \`<img src="\${img}" class="embedded-suggested-image" alt="">\` : ''}
                <div class="embedded-suggested-content">
                    <div class="embedded-suggested-title">\${title}</div>
                    \${desc ? \`<div class="embedded-suggested-summary">\${desc}</div>\` : ''}
                </div>
            </a>\`;
        };

        const relatedMatch = html.match(/<div\\b[^>]*class=["'][^"']*news-list[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>\\s*<\\/div>/i);
        if (relatedMatch) {
            const inner = relatedMatch[1];
            const itemRegex = /<li\\b[^>]*>([\\s\\S]*?)<\\/li>/gi;
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
console.log("Updated VtvSource.js");
