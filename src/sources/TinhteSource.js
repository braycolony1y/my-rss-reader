export default class TinhteSource {
    match(hostname) {
        return hostname === 'tinhte.vn' || hostname.endsWith('.tinhte.vn');
    }

    parseArticleHtmlContent(html, url, result, utils) {
        let articleHtml = '';
        
        // Try parsing JSON payload from Next.js
        const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (nextDataMatch) {
            try {
                const data = JSON.parse(nextDataMatch[1]);
                let post = null;
                
                const findPost = (d) => {
                    if (d && typeof d === 'object') {
                        if (d.post_body_html) return d;
                        for (let k in d) {
                            const res = findPost(d[k]);
                            if (res) return res;
                        }
                    }
                    return null;
                };
                
                post = findPost(data);
                
                if (post) {
                    articleHtml = post.post_body_html || '';
                    if (post.poster_username) {
                        result.author = post.poster_username;
                    }
                    
                    // Process Tinhte_Galleria to extract original images
                    articleHtml = articleHtml.replace(/<ul[^>]*class="[^"]*Tinhte_Galleria[^"]*"[^>]*>([\s\S]*?)<\/ul>/ig, (match, inner) => {
                        let newInner = inner.replace(/<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<img[^>]*>[\s\S]*?<\/a>/ig, (aMatch, href) => {
                            return `<img src="${utils.escapeHtml(href)}">`;
                        });
                        return `<div class="tinhte-galleria">${newInner}</div>`;
                    });

                    // Process Tinhte_PhotoCompare to create a slider
                    articleHtml = articleHtml.replace(/<span[^>]*class="[^"]*Tinhte_PhotoCompare[^"]*"[^>]*>([\s\S]*?)<\/span>/ig, (match, inner) => {
                        const images = [];
                        const imgRegex = /<img[^>]*src="([^"]+)"[^>]*>/ig;
                        let imgMatch;
                        while ((imgMatch = imgRegex.exec(inner)) !== null) {
                            images.push(imgMatch[1]);
                        }
                        if (images.length >= 2) {
                            return `<div class="tinhte-photo-compare">
                                <img src="${utils.escapeHtml(images[0])}" class="compare-base" />
                                <img src="${utils.escapeHtml(images[1])}" class="compare-overlay" />
                                <input type="range" min="0" max="100" value="50" class="compare-slider" />
                                <div class="compare-handle"><div class="compare-handle-line"></div><div class="compare-handle-arrows">&harr;</div></div>
                            </div>`;
                        }
                        return match;
                    });

                    // Process YouTube embeds
                    articleHtml = articleHtml.replace(/<span[^>]*data-s9e-mediaembed="youtube"[^>]*>[\s\S]*?<iframe[^>]*src="([^"]+)"[^>]*>[\s\S]*?<\/iframe>[\s\S]*?<\/span>/ig, (match, src) => {
                        return `<iframe src="${utils.escapeHtml(src)}" width="100%" style="aspect-ratio: 16/9; border: none; border-radius: 8px; margin: 16px 0;" allowfullscreen></iframe>`;
                    });

                    // Fix Survey iframe ratio
                    articleHtml = articleHtml.replace(/<div[^>]*class="[^"]*TinhteMods_Survey[^"]*"[^>]*>([\s\S]*?)<\/div>/ig, (match, inner) => {
                        return `<div class="tinhte-survey" style="width: 100%; min-height: 500px; margin: 20px 0;">${inner.replace(/<iframe/i, '<iframe style="width: 100%; min-height: 500px; border: none; border-radius: 12px;"')}</div>`;
                    });

                    // Fix LinkExpander (Related Articles)
                    articleHtml = articleHtml.replace(/<a[^>]*class="[^"]*LinkExpander[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/ig, (match, href, inner) => {
                        const titleMatch = inner.match(/<h2[^>]*class="title"[^>]*>([\s\S]*?)<\/h2>/i) || inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
                        const descMatch = inner.match(/<div[^>]*class="description"[^>]*>([\s\S]*?)<\/div>/i);
                        let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Bài viết liên quan';
                        let desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
                        
                        return `<div class="styled-rel-card my-6 px-4 py-3.5 rounded-xl border-l-4 border-l-blue-600 bg-gray-50 dark:bg-gray-800/80 border border-gray-200/80 dark:border-gray-700 shadow-sm transition hover:shadow-md hover:border-l-blue-700">
                                    <div class="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-2">📰 Mời anh em xem thêm</div>
                                    <a href="${utils.escapeHtml(href)}" target="_blank" class="font-bold text-gray-900 font-bold text-gray-900 block leading-snug no-underline transition text-lg">${utils.escapeHtml(title)} →</a>
                                    ${desc ? `<p class="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">${utils.escapeHtml(desc)}</p>` : ''}
                                </div>`;
                    });

                    // Style event info blocks if any
                    articleHtml = articleHtml.replace(/(?:<[^>]+>\s*)*(Thông tin sự kiện:?)[\s\S]*?(?:Thời gian:?.*?)[\s\S]*?(?:Địa điểm:?.*?)(?:<\/[^>]+>)+/gi, (match) => {
                        return `<div class="styled-rel-card my-6 px-4 py-3.5 rounded-xl border-l-4 border-l-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/80 dark:border-emerald-800 shadow-sm transition hover:shadow-md">
                                    ${match.replace(/(Thông tin sự kiện:?)/i, '<strong class="text-emerald-700 dark:text-emerald-400 block text-lg mb-2">$1</strong>')
                                           .replace(/(Thời gian:?)/i, '<br><strong class="text-gray-900 dark:text-gray-200">$1</strong>')
                                           .replace(/(Địa điểm:?)/i, '<br><strong class="text-gray-900 dark:text-gray-200">$1</strong>')}
                                </div>`;
                    });

                    if (post.attachments && Array.isArray(post.attachments)) {
                        post.attachments.forEach(att => {
                            if (att.links && att.links.permalink && !att.attachment_is_video) {
                                articleHtml += `<br><img src="${utils.escapeHtml(att.links.permalink)}" alt="${utils.escapeHtml(att.filename || '')}">`;
                            }
                        });
                    }
                }
            } catch (e) {
                console.error("Failed to parse Tinhte JSON", e);
            }
        }
        
        if (!articleHtml) {
            const articleRegex = /<article\b[^>]*>([\s\S]*?)<\/article>/i;
            const match = html.match(articleRegex);
            if (match) {
                articleHtml = match[1];
            } else {
                const fallbackBb = utils.extractBalancedElementByClass(html, 'bbWrapper');
                if (fallbackBb && fallbackBb.length > 30) {
                    articleHtml = fallbackBb;
                }
            }
        }
        
        result.siteName = result.siteName || 'Tinh tế';
        return articleHtml;
    }
}
