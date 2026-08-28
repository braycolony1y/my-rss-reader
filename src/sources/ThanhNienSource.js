function readAttribute(tag, name) {
    const match = String(tag || '').match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'));
    return match ? match[1].replace(/&amp;/gi, '&').trim() : '';
}

function normalizeVideoAssetUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const candidate = raw.startsWith('//') ? `https:${raw}` : (/^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`);
    try {
        const parsed = new URL(candidate);
        return /^https?:$/.test(parsed.protocol) ? parsed.href : '';
    } catch (e) {
        return '';
    }
}

export function extractThanhNienPrimaryVideo(html) {
    const playerTags = String(html || '').match(/<(?:div|figure|video)\b[^>]*>/gi) || [];
    const playerTag = playerTags.find(tag => /^VideoStream$/i.test(readAttribute(tag, 'type')) && readAttribute(tag, 'data-vid'));
    if (!playerTag) return null;

    const url = normalizeVideoAssetUrl(readAttribute(playerTag, 'data-vid'));
    if (!url || !/\.(?:mp4|m3u8|webm|ogg)(?:$|[?#])/i.test(url)) return null;

    return {
        url,
        poster: normalizeVideoAssetUrl(readAttribute(playerTag, 'data-thumb'))
    };
}

export default class ThanhNienSource {
    match(hostname) {
        return hostname.includes('thanhnien.vn');
    }

    async parseArticleHtmlContent(html, url, result, utils) {
        let articleHtml = '';

        // Thanh Nien video articles keep their primary player outside the
        // regular detail-content container. Preserve its media metadata so
        // the shared reader can render a native, non-autoplaying player.
        const primaryVideo = extractThanhNienPrimaryVideo(html);
        if (primaryVideo && result) {
            const video = { ...primaryVideo, title: result.title || 'Video' };
            result.videos ||= [];
            const existingIndex = result.videos.findIndex(item => item.url === video.url);
            if (existingIndex === -1) result.videos.unshift(video);
            else result.videos[existingIndex] = { ...result.videos[existingIndex], ...video };
            result.videoUrl = video.url;
            result.videoPoster = video.poster;
        }
        
        // Extract content from detail-content
        // It ends at <div data-check-position="body_end">
        const articleBodyMatch = html.match(/<div\b[^>]*class=["'][^"']*detail-content[^"']*["'][^>]*>([\s\S]*?)<div\b[^>]*data-check-position=["']body_end["']/i);
        
        if (articleBodyMatch) {
            articleHtml = articleBodyMatch[1];
        } else {
            const match = html.match(/<div\b[^>]*class=["'][^"']*detail-cmain[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*detail__related[^"']*["']|<div\b[^>]*class=["']detail-tags)/i);
            articleHtml = match ? match[1] : html;
        }

        // Clean up some noise
        articleHtml = articleHtml.replace(/<script[\s\S]*?<\/script>/gi, '');
        articleHtml = articleHtml.replace(/<div[^>]*data-type=["']_mgwidget["'][^>]*>[\s\S]*?<\/div>/gi, '');

        const allRelatedItems = [];
        const addItem = (href, title, img, desc) => {
            let absUrl = href;
            try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
            if (!allRelatedItems.some(item => item.href === absUrl)) {
                allRelatedItems.push({ href: absUrl, title, img, desc });
            }
        };

        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*box-relate[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi, (m, inner) => {
            const linkMatch = inner.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']+)["']/i) || inner.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
            if (linkMatch) {
                const relUrl = linkMatch[1];
                const relTitle = (linkMatch[2] || '').replace(/<[^>]+>/g, '').trim();
                addItem(relUrl, relTitle, '', '');
            }
            return '';
        });

        // Author name extraction
        const authorMatch = html.match(/<meta property=["']article:author["'] content=["']([^"']+)["']/i) ||
                            html.match(/<a\b[^>]*class=["']name["'][^>]*title=["']([^"']+)["']/i);
        if (authorMatch && result) {
            result.author = authorMatch[1].trim();
        }
        
        // Author avatar extraction
        const authorAvatarMatch = html.match(/<a[^>]*class=["'][^"']*avatar author-data[^"']*["'][^>]*>\s*<img[^>]*src=["']([^"']+)["']/i);
        if (authorAvatarMatch && result) {
            result.authorAvatar = authorAvatarMatch[1];
        }

        const createSuggestedHtml = (title, itemsHtml) => {
            if (!itemsHtml) return '';
            return `
<div class="embedded-suggested-articles">
    <div class="embedded-suggested-header">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        ${title}
    </div>
    <div class="embedded-suggested-carousel">
        ${itemsHtml}
    </div>
</div>`;
        };

        const createCardHtml = (href, title, img, desc) => {
            let absUrl = href;
            try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
            return `
            <div class="embedded-suggested-card">
                <a href="${absUrl}" target="_blank" class="embedded-suggested-overlay"></a>
                ${img ? `<img src="${img}" class="embedded-suggested-image" alt="">` : ''}
                <div class="embedded-suggested-content">
                    <div class="embedded-suggested-title">${title}</div>
                    ${desc ? `<div class="embedded-suggested-summary">${desc}</div>` : ''}
                </div></div>`;
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
            
            const itemRegex = /<div\b[^>]*class=["'][^"']*box-category-item[^"']*["'][^>]*>/gi;
            const items = inner.split(itemRegex).slice(1);
            
            for (const itemHtml of items) {
                const linkMatch = itemHtml.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
                if (linkMatch) {
                    const relUrl = linkMatch[1];
                    const relTitleMatch = itemHtml.match(/title=["']([^"']+)["']/i);
                    let relTitle = relTitleMatch ? relTitleMatch[1] : (linkMatch[2] || '').replace(/<[^>]+>/g, '').trim();
                    relTitle = relTitle.replace(/<[^>]+>/g, '').trim();

                    const imgMatch = itemHtml.match(/<img\b[^>]*src=["']([^"']+)["']/i) || itemHtml.match(/<img\b[^>]*data-src=["']([^"']+)["']/i);
                    const imgSrc = imgMatch ? imgMatch[1] : '';
                    const sapoMatch = itemHtml.match(/<a[^>]*class=["'][^"']*box-category-sapo[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
                    const desc = sapoMatch ? sapoMatch[1].replace(/<[^>]+>/g, '').trim() : '';
                    addItem(relUrl, relTitle, imgSrc, desc);
                }
            }
        }

        if (allRelatedItems.length > 0) {
            if (utils && utils.fetchWithTimeout) {
                const fetchPromises = allRelatedItems.map(async (item) => {
                    if (!item.img) {
                        try {
                            const response = await utils.fetchWithTimeout(item.href, {}, 2500);
                            if (response.ok) {
                                const relatedHtml = await response.text();
                                const ogImageMatch = relatedHtml.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                                                     relatedHtml.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
                                if (ogImageMatch) {
                                    item.img = ogImageMatch[1];
                                }
                            }
                        } catch (e) {
                            // ignore timeout/error
                        }
                    }
                });
                await Promise.all(fetchPromises);
            }

            let itemsHtml = '';
            for (const item of allRelatedItems) {
                itemsHtml += createCardHtml(item.href, item.title, item.img, item.desc);
            }
            articleHtml += createSuggestedHtml('BÀI VIẾT LIÊN QUAN', itemsHtml);
        }

        return articleHtml;
    }
}
