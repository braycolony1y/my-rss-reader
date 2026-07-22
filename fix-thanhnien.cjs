const fs = require('fs');
const path = './src/sources/ThanhNienSource.js';
let content = fs.readFileSync(path, 'utf8');

const regex = /\/\/ Clean up some noise[\s\S]*?return articleHtml;/;

const replacement = `// Clean up some noise
        articleHtml = articleHtml.replace(/<script[\\s\\S]*?<\\/script>/gi, '');
        articleHtml = articleHtml.replace(/<div[^>]*data-type=["']_mgwidget["'][^>]*>[\\s\\S]*?<\\/div>/gi, '');

        const allRelatedItems = [];
        const addItem = (href, title, img, desc) => {
            let absUrl = href;
            try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
            if (!allRelatedItems.some(item => item.href === absUrl)) {
                allRelatedItems.push({ href: absUrl, title, img, desc });
            }
        };

        articleHtml = articleHtml.replace(/<div\\b[^>]*class=["'][^"']*box-relate[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>\\s*<\\/div>/gi, (m, inner) => {
            const linkMatch = inner.match(/<a\\b[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']+)["']/i) || inner.match(/<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/i);
            if (linkMatch) {
                const relUrl = linkMatch[1];
                const relTitle = (linkMatch[2] || '').replace(/<[^>]+>/g, '').trim();
                addItem(relUrl, relTitle, '', '');
            }
            return '';
        });

        // Author name extraction
        const authorMatch = html.match(/<meta property=["']article:author["'] content=["']([^"']+)["']/i) ||
                            html.match(/<a\\b[^>]*class=["']name["'][^>]*title=["']([^"']+)["']/i);
        if (authorMatch && result) {
            result.author = authorMatch[1].trim();
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

        // Extract related articles from detail__related
        const startIndex = html.indexOf('class="detail__related"');
        if (startIndex !== -1) {
            let inner = html.substring(startIndex, startIndex + 5000);
            const endIndex = inner.indexOf('class="detail__cmain-sub"');
            if (endIndex !== -1) {
                inner = inner.substring(0, endIndex);
            } else {
                const scriptIndex = inner.search(/<script|<style/i);
                if (scriptIndex !== -1) {
                    inner = inner.substring(0, scriptIndex);
                }
            }
            
            const itemRegex = /<div\\b[^>]*class=["'][^"']*box-category-item[^"']*["'][^>]*>/gi;
            const items = inner.split(itemRegex).slice(1);
            
            for (const itemHtml of items) {
                const linkMatch = itemHtml.match(/<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/i);
                if (linkMatch) {
                    const relUrl = linkMatch[1];
                    const relTitleMatch = itemHtml.match(/title=["']([^"']+)["']/i);
                    let relTitle = relTitleMatch ? relTitleMatch[1] : (linkMatch[2] || '').replace(/<[^>]+>/g, '').trim();
                    relTitle = relTitle.replace(/<[^>]+>/g, '').trim();

                    const imgMatch = itemHtml.match(/<img\\b[^>]*src=["']([^"']+)["']/i) || itemHtml.match(/<img\\b[^>]*data-src=["']([^"']+)["']/i);
                    const imgSrc = imgMatch ? imgMatch[1] : '';
                    const sapoMatch = itemHtml.match(/<a[^>]*class=["'][^"']*box-category-sapo[^"']*["'][^>]*>([\\s\\S]*?)<\\/a>/i);
                    const desc = sapoMatch ? sapoMatch[1].replace(/<[^>]+>/g, '').trim() : '';
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
console.log("Updated ThanhNienSource.js");
