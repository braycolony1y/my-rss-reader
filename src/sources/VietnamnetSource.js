export default class VietnamnetSource {
    match(hostname) {
        return hostname.includes('vietnamnet.vn');
    }

    async preProcessHtml(html, utils) {
        let newHtml = html;
        const vnnEmbeds = [...newHtml.matchAll(/<iframe[^>]*src=["'](https:\/\/embed\.vietnamnet\.vn\/[^"']+)["'][^>]*>/gi)];
        for (const match of vnnEmbeds) {
            try {
                const embedRes = await utils.fetchWithTimeout(match[1], { headers: { 'Referer': 'https://vietnamnet.vn/' } }, 3000);
                if (embedRes.ok) {
                    const embedHtml = await embedRes.text();
                    const mp4Match = embedHtml.match(/var\s+mp4\s*=\s*['"]([^'"]+\.mp4[^'"]*)['"]/i);
                    if (mp4Match) {
                        const mp4Url = mp4Match[1];
                        newHtml = newHtml.replace(match[0], `<video src="${mp4Url}" controls playsinline></video>`);
                    }
                }
            } catch(e) {}
        }
        return newHtml;
    }

    async parseArticleHtmlContent(html, url, result, utils) {
        const fetchOgImage = async (absUrl) => {
            if (!utils || !utils.fetchWithTimeout) return '';
            try {
                const res = await utils.fetchWithTimeout(absUrl, {}, 3000);
                if (res.ok) {
                    const text = await res.text();
                    const ogMatch = text.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || text.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
                    if (ogMatch) return ogMatch[1];
                }
            } catch(e) {}
            return '';
        };

        // Extract Time
        const publishDateMatch = html.match(/'ArticlePublishDate':\s*'([^']+)'/i) || html.match(/"articlePublishDate":\s*"([^"]+)"/i) || html.match(/<div\b[^>]*class=["'][^"']*publish-date[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
        if (publishDateMatch) {
            result.date = publishDateMatch[1].trim().replace(/\s+([+-]\d{2}:\d{2})$/, '$1');
        }

        // Extract Author
        const authorMatch = html.match(/<p\b[^>]*class=["'][^"']*article-detail-author__info[^"']*["'][^>]*>\s*<span\b[^>]*class=["'][^"']*name[^"']*["'][^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i) || html.match(/<div\b[^>]*class=["'][^"']*article-detail-author__name[^"']*["'][^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i) || html.match(/<span\b[^>]*class=["'][^"']*article-detail-author__name[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || html.match(/'ea_author_name':\s*'([^']+)'/i) || html.match(/<meta\s+name=["']author["']\s+content=["']([^"']+)["']/i);
        if (authorMatch) {
            result.author = authorMatch[1].trim();
        }
        
        let articleHtml = '';
        const articleRegex = /<div\b[^>]*class=["'][^"']*(?:maincontent|main-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*class=["'][^"']*article-detail-author-wrapper/i;
        let match = html.match(articleRegex);
        if (!match) {
            match = html.match(/<div\b[^>]*class=["'][^"']*(?:maincontent|main-content)[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*article-detail-author-wrapper|<div\b[^>]*id=["']insert-rating)/i);
        }
        if (!match) {
            match = html.match(/<div\b[^>]*class=["'][^"']*(?:maincontent|main-content)[^"']*["'][^>]*>([\s\S]*?)(?:<!-- BEGIN COMPONENT::|<div\b[^>]*id=["']vnnid-box-vote|<div\b[^>]*class=["'][^"']*container__right|<div\b[^>]*class=["'][^"']*collectInfomationBox)/i);
        }
        if (match) {
            articleHtml = match[1];
        } else {
            articleHtml = html; // fallback
        }

        const videoMediaMatch = html.match(/<div\b[^>]*class=["'][^"']*video-detail__media[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
        const videoSaboMatch = html.match(/<div\b[^>]*class=["'][^"']*video-detail__sabo[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
        
        if (videoMediaMatch) {
            let mediaHtml = videoMediaMatch[1];
            let saboHtml = videoSaboMatch ? `<p><strong>${videoSaboMatch[1].trim()}</strong></p>` : '';
            if (!match) articleHtml = ''; // Clear fallback HTML
            articleHtml = mediaHtml + saboHtml + articleHtml;
        }

        if (articleHtml) {
            const allRelatedItems = [];
            const addItem = (href, title, img, desc, isEvent = false) => {
                const absUrl = href.startsWith('/') ? new URL(href, url).href : href;
                const idx = allRelatedItems.findIndex(item => item.href === absUrl);
                if (idx === -1) {
                    if (isEvent) {
                        allRelatedItems.unshift({ href: absUrl, title, img, desc, isEvent: true });
                    } else {
                        allRelatedItems.push({ href: absUrl, title, img, desc, isEvent: false });
                    }
                } else if (isEvent && !allRelatedItems[idx].isEvent) {
                     const [item] = allRelatedItems.splice(idx, 1);
                     item.isEvent = true;
                     allRelatedItems.unshift(item);
                }
            };

            const insertGroupRegex = /<div\b[^>]*class=["'][^"']*ck-cms-insert-neww-group[^>]*>([\s\S]*?<\/article>)\s*<\/div>/gi;
            const insertGroupPromises = [];
            let insertMatch;
            while ((insertMatch = insertGroupRegex.exec(articleHtml)) !== null) {
                const m = insertMatch[0];
                insertGroupPromises.push((async () => {
                    const newsRegex = /<article\b[^>]*class=["'][^"']*ck-cms-insert-news[^>]*>([\s\S]*?)<\/article>/gi;
                    let newsMatch;
                    while ((newsMatch = newsRegex.exec(m)) !== null) {
                        const inner = newsMatch[1];
                        const linkMatch = inner.match(/<div\b[^>]*class=["'][^"']*insert-wiki-title[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) || inner.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*title=(["'])([\s\S]*?)\2/i) || inner.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
                        const imgMatch = inner.match(/<img\b[^>]*data-original=["']([^"']+)["']/i) || inner.match(/<img\b[^>]*src=["']([^"']+)["']/i);
                        const descMatch = inner.match(/<div\b[^>]*class=["'][^"']*insert-wiki-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
                        if (linkMatch) {
                            const relUrl = linkMatch[1];
                            let relTitle = (linkMatch[3] !== undefined && (linkMatch[2] === '"' || linkMatch[2] === "'")) ? linkMatch[3] : linkMatch[2];
                            relTitle = (relTitle || '').replace(/<[^>]+>/g, '').trim();
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

            const wikiNewsFullRegex = /<article\b[^>]*class=["'][^"']*ck-cms-wiki-news-full[^>]*>([\s\S]*?)<\/article>/gi;
            const wikiNewsPromises = [];
            let wikiMatch;
            while ((wikiMatch = wikiNewsFullRegex.exec(articleHtml)) !== null) {
                const inner = wikiMatch[1];
                wikiNewsPromises.push((async () => {
                    const linkMatch = inner.match(/<a\b[^>]*class=["'][^"']*summary__content-title[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) || inner.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*summary__content-title[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
                    const imgMatch = inner.match(/<img\b[^>]*data-original=["']([^"']+)["']/i) || inner.match(/<img\b[^>]*src=["']([^"']+)["']/i);
                    const descMatch = inner.match(/<span\b[^>]*class=["'][^"']*summary__content-desc[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
                    if (linkMatch) {
                        const relUrl = linkMatch[1] || linkMatch[3];
                        const relTitle = (linkMatch[2] || linkMatch[4] || '').replace(/<[^>]+>/g, '').trim();
                        const absUrl = relUrl.startsWith('/') ? new URL(relUrl, url).href : relUrl;
                        let imgSrc = imgMatch ? imgMatch[1] : '';
                        if (!imgSrc || imgSrc.startsWith('data:')) {
                            const dataSrcMatch = inner.match(/<img\b[^>]*data-srcset=["']([^"'\s]+)[^"']*["']/i);
                            if (dataSrcMatch) imgSrc = dataSrcMatch[1];
                        }
                        if (!imgSrc || imgSrc.startsWith('data:')) imgSrc = await fetchOgImage(absUrl);
                        const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
                        addItem(absUrl, relTitle, imgSrc, desc);
                    }
                })());
            }
            articleHtml = articleHtml.replace(wikiNewsFullRegex, '');

            const relatedNewsRegex = /<div\b[^>]*class=["'][^"']*related-news[^>]*>([\s\S]*?<\/ul>)\s*<\/div>/gi;
            const relatedNewsPromises = [];
            let relatedNewsMatch;
            while ((relatedNewsMatch = relatedNewsRegex.exec(html)) !== null) {
                const m = relatedNewsMatch[0];
                relatedNewsPromises.push((async () => {
                    const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
                    let liMatch;
                    while ((liMatch = liRegex.exec(m)) !== null) {
                        const inner = liMatch[1];
                        const linkMatch = inner.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
                        const imgMatch = inner.match(/<img\b[^>]*src=["']([^"']+)["']/i);
                        const descMatch = inner.match(/<div\b[^>]*class=["'][^"']*summary[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
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

            const linkSpecialRegex = /<div\b[^>]*class=["'][^"']*(?:link-special|content-detail__link-special)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
            const linkSpecialPromises = [];
            let linkSpecialMatch;
            while ((linkSpecialMatch = linkSpecialRegex.exec(html)) !== null) {
                const inner = linkSpecialMatch[1];
                const linkMatch = inner.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
                if (linkMatch) {
                    const relUrl = linkMatch[1];
                    const relTitle = (linkMatch[2] || '').replace(/<[^>]+>/g, '').trim();
                    const absUrl = relUrl.startsWith('/') ? new URL(relUrl, url).href : relUrl;
                    linkSpecialPromises.push((async () => {
                        let imgSrc = await fetchOgImage(absUrl);
                        addItem(absUrl, relTitle, imgSrc, '', true);
                    })());
                }
            }

            await Promise.all([...insertGroupPromises, ...wikiNewsPromises, ...relatedNewsPromises, ...linkSpecialPromises]);

            // Clean up old ones
            articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*ck-cms-insert-neww-group[^>]*>([\s\S]*?)<\/div>/gi, '');
            articleHtml = articleHtml.replace(/<article\b[^>]*class=["'][^"']*ck-cms-wiki-news-full[^>]*>([\s\S]*?)<\/article>/gi, '');
            articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*related-news[^>]*>([\s\S]*?<\/ul>)\s*<\/div>/gi, '');
            articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*(?:link-special|content-detail__link-special)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi, '');

            if (allRelatedItems.length > 0) {
                let relatedListHtml = `
<div class="embedded-suggested-articles">
    <div class="embedded-suggested-header">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        BÀI VIẾT LIÊN QUAN
    </div>
    <div class="embedded-suggested-carousel">`;
                for (const item of allRelatedItems) {
                    relatedListHtml += `
                    <div class="embedded-suggested-card">
                        <a href="${item.href}" target="_blank" class="embedded-suggested-overlay"></a>
                        ${item.img ? `<img src="${item.img}" class="embedded-suggested-image" alt="">` : ''}
                        <div class="embedded-suggested-content">
                            <div class="embedded-suggested-title">${item.title}</div>
                            ${item.desc ? `<div class="embedded-suggested-summary">${item.desc}</div>` : ''}
                        </div></div>`;
                }
                relatedListHtml += `</div></div>`;
                articleHtml += relatedListHtml;
            }
        }
        
        return articleHtml;
    }
}
