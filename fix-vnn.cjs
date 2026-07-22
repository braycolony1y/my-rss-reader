const fs = require('fs');
const path = './src/sources/VietnamnetSource.js';
let content = fs.readFileSync(path, 'utf8');

const regex = /if \(articleHtml\) \{([\s\S]*?)\}\s*return articleHtml;/;

const replacement = `if (articleHtml) {
            const allRelatedItems = [];
            const addItem = (href, title, img, desc) => {
                const absUrl = href.startsWith('/') ? new URL(href, url).href : href;
                if (!allRelatedItems.some(item => item.href === absUrl)) {
                    allRelatedItems.push({ href: absUrl, title, img, desc });
                }
            };

            const insertGroupRegex = /<div\\b[^>]*class=["'][^"']*ck-cms-insert-neww-group[^>]*>([\\s\\S]*?<\\/article>)\\s*<\\/div>/gi;
            const insertGroupPromises = [];
            let insertMatch;
            while ((insertMatch = insertGroupRegex.exec(articleHtml)) !== null) {
                const m = insertMatch[0];
                insertGroupPromises.push((async () => {
                    const newsRegex = /<article\\b[^>]*class=["'][^"']*ck-cms-insert-news[^>]*>([\\s\\S]*?)<\\/article>/gi;
                    let newsMatch;
                    while ((newsMatch = newsRegex.exec(m)) !== null) {
                        const inner = newsMatch[1];
                        const linkMatch = inner.match(/<a\\b[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']+)["']/i) || inner.match(/<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/i);
                        const imgMatch = inner.match(/<img\\b[^>]*data-original=["']([^"']+)["']/i) || inner.match(/<img\\b[^>]*src=["']([^"']+)["']/i);
                        const descMatch = inner.match(/<div\\b[^>]*class=["'][^"']*insert-wiki-description[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>/i);
                        if (linkMatch) {
                            const relUrl = linkMatch[1];
                            const relTitle = (linkMatch[2] || '').replace(/<[^>]+>/g, '').trim();
                            const absUrl = relUrl.startsWith('/') ? new URL(relUrl, url).href : relUrl;
                            let imgSrc = imgMatch ? imgMatch[1] : '';
                            if (!imgSrc) imgSrc = await fetchOgImage(absUrl);
                            const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
                            addItem(absUrl, relTitle, imgSrc, desc);
                        }
                    }
                })());
            }
            articleHtml = articleHtml.replace(insertGroupRegex, '');

            const wikiNewsFullRegex = /<article\\b[^>]*class=["'][^"']*ck-cms-wiki-news-full[^>]*>([\\s\\S]*?)<\\/article>/gi;
            const wikiNewsPromises = [];
            let wikiMatch;
            while ((wikiMatch = wikiNewsFullRegex.exec(articleHtml)) !== null) {
                const inner = wikiMatch[1];
                wikiNewsPromises.push((async () => {
                    const linkMatch = inner.match(/<a\\b[^>]*class=["'][^"']*summary__content-title[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/i) || inner.match(/<a\\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*summary__content-title[^"']*["'][^>]*>([\\s\\S]*?)<\\/a>/i);
                    const imgMatch = inner.match(/<img\\b[^>]*data-original=["']([^"']+)["']/i) || inner.match(/<img\\b[^>]*src=["']([^"']+)["']/i);
                    const descMatch = inner.match(/<span\\b[^>]*class=["'][^"']*summary__content-desc[^"']*["'][^>]*>([\\s\\S]*?)<\\/span>/i);
                    if (linkMatch) {
                        const relUrl = linkMatch[1] || linkMatch[3];
                        const relTitle = (linkMatch[2] || linkMatch[4] || '').replace(/<[^>]+>/g, '').trim();
                        const absUrl = relUrl.startsWith('/') ? new URL(relUrl, url).href : relUrl;
                        let imgSrc = imgMatch ? imgMatch[1] : '';
                        if (!imgSrc || imgSrc.startsWith('data:')) {
                            const dataSrcMatch = inner.match(/<img\\b[^>]*data-srcset=["']([^"'\\s]+)[^"']*["']/i);
                            if (dataSrcMatch) imgSrc = dataSrcMatch[1];
                        }
                        if (!imgSrc || imgSrc.startsWith('data:')) imgSrc = await fetchOgImage(absUrl);
                        const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
                        addItem(absUrl, relTitle, imgSrc, desc);
                    }
                })());
            }
            articleHtml = articleHtml.replace(wikiNewsFullRegex, '');

            const relatedNewsRegex = /<div\\b[^>]*class=["'][^"']*related-news[^>]*>([\\s\\S]*?<\\/ul>)\\s*<\\/div>/gi;
            const relatedNewsPromises = [];
            let relatedNewsMatch;
            while ((relatedNewsMatch = relatedNewsRegex.exec(html)) !== null) {
                const m = relatedNewsMatch[0];
                relatedNewsPromises.push((async () => {
                    const liRegex = /<li\\b[^>]*>([\\s\\S]*?)<\\/li>/gi;
                    let liMatch;
                    while ((liMatch = liRegex.exec(m)) !== null) {
                        const inner = liMatch[1];
                        const linkMatch = inner.match(/<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/i);
                        const imgMatch = inner.match(/<img\\b[^>]*src=["']([^"']+)["']/i);
                        const descMatch = inner.match(/<div\\b[^>]*class=["'][^"']*summary[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>/i);
                        if (linkMatch) {
                            const relUrl = linkMatch[1];
                            const relTitle = (linkMatch[2] || '').replace(/<[^>]+>/g, '').trim();
                            const absUrl = relUrl.startsWith('/') ? new URL(relUrl, url).href : relUrl;
                            let imgSrc = imgMatch ? imgMatch[1] : '';
                            if (!imgSrc) imgSrc = await fetchOgImage(absUrl);
                            const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
                            addItem(absUrl, relTitle, imgSrc, desc);
                        }
                    }
                })());
            }

            await Promise.all([...insertGroupPromises, ...wikiNewsPromises, ...relatedNewsPromises]);

            if (allRelatedItems.length > 0) {
                let relatedListHtml = \`
<div class="embedded-suggested-articles">
    <div class="embedded-suggested-header">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        BÀI VIẾT LIÊN QUAN
    </div>
    <div class="embedded-suggested-carousel">\`;
                for (const item of allRelatedItems) {
                    relatedListHtml += \`
                    <a href="\${item.href}" class="embedded-suggested-card font-bold text-gray-900" target="_blank">
                        \${item.img ? \`<img src="\${item.img}" class="embedded-suggested-image" alt="">\` : ''}
                        <div class="embedded-suggested-content">
                            <div class="embedded-suggested-title">\${item.title}</div>
                            \${item.desc ? \`<div class="embedded-suggested-summary">\${item.desc}</div>\` : ''}
                        </div>
                    </a>\`;
                }
                relatedListHtml += \`</div></div>\`;
                articleHtml += relatedListHtml;
            }
        }
        
        return articleHtml;`;

content = content.replace(regex, replacement);
fs.writeFileSync(path, content);
console.log("Updated VietnamnetSource.js");
