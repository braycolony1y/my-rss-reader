export default class VnexpressSource {
    match(hostname) {
        return hostname.includes('vnexpress.net');
    }

    async preProcessHtml(html, utils) {
        const { fetchWithTimeout } = utils;
        
        // 1. Fetch widget_podcast components dynamically
        const podcastMatches = Array.from(html.matchAll(/<div\b[^>]*data-component-type=["']widget_podcast["'][^>]*data-component-value=["'](\d+)["'][^>]*>/gi));
        for (const match of podcastMatches) {
            const id = match[1];
            try {
                const apiRes = await fetchWithTimeout(`https://gw.vnexpress.net/ar/get_full?article_id=${id}`);
                const data = JSON.parse(apiRes);
                if (data.code === 200 && data.data && data.data.share_url) {
                    const articleHtml = await fetchWithTimeout(data.data.share_url);
                    const popcastMatch = articleHtml.match(/<div\b[^>]*class=["'][^"']*wrap-player-popcast[^"']*["'][^>]*>([\s\S]*?)<\/audio>/i);
                    if (popcastMatch) {
                        html = html.replace(match[0], popcastMatch[0] + '</audio></div>');
                    }
                }
            } catch(e) {}
        }

        // 2. Fetch tin_xemthem components dynamically
        const xemThemMatches = Array.from(html.matchAll(/<div\b[^>]*data-component-type=["']tin_xemthem["'][^>]*data-component-value=["'](\d+)["'][^>]*>/gi));
        for (const match of xemThemMatches) {
            const id = match[1];
            try {
                const apiRes = await fetchWithTimeout(`https://gw.vnexpress.net/ar/get_full?article_id=${id}`);
                const data = JSON.parse(apiRes);
                if (data.code === 200 && data.data && data.data.share_url) {
                    const itemHtml = `
<div class="box-tinlienquanv2">
    <section class="item-news">
        <a href="${data.data.share_url}"></a>
        <h3 class="title-news"><a href="${data.data.share_url}">${data.data.title}</a></h3>
        <img data-src="${data.data.thumbnail_url}">
    </section>
</div>`;
                    html = html.replace(match[0], itemHtml);
                }
            } catch(e) {}
        }
        
        return html;
    }

    parseArticleHtmlContent(html, url, result, utils) {
        let videoData = null;
        
        // Attempt to find VideoObject in JSON-LD
        const ldMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);

        if (ldMatches) {
            for (const match of ldMatches) {
                try {
                    const inner = match.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
                    const json = JSON.parse(inner);
                    if (json['@type'] === 'VideoObject') {
                        videoData = json;
                        break;
                    }
                } catch (e) {
                    // Ignore parse errors for individual tags
                }
            }
        }

        // If we successfully found video metadata
        let videoHtml = '';
        if (videoData && videoData.contentUrl) {
            const poster = videoData.thumbnailUrl ? ` poster="${videoData.thumbnailUrl}"` : '';
            videoHtml = `
                <div class="video-container my-4">
                    <video controls  loop${poster} class="w-full rounded-lg shadow-lg" style="max-width: 100%;">
                        <source src="${videoData.contentUrl}" type="application/x-mpegURL">
                        <source src="${videoData.contentUrl}" type="application/vnd.apple.mpegurl">
                        Trình duyệt của bạn không hỗ trợ thẻ video.
                    </video>
                </div>
                ${videoData.description ? `<p class="mt-4 text-lg font-medium text-gray-800 dark:text-gray-200">${videoData.description}</p>` : ''}
            `;
        }

        // If it's a normal article, try standard VnExpress selectors
        let articleHtml = '';
        const fckMatch = html.match(/<article\b[^>]*class=["'][^"']*fck_detail[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
        if (fckMatch) articleHtml = fckMatch[1];
        else {
            const detailMatch = html.match(/<article\b[^>]*class=["'][^"']*detail-content[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
            if (detailMatch) articleHtml = detailMatch[1];
        }

        // Check for Podcast standalone page
        const podcastMatch = html.match(/<audio\b[^>]*playlist=['"]([^'"]+)['"][^>]*>/i);
        if (podcastMatch) {
            try {
                let data = JSON.parse(podcastMatch[1].replace(/&quot;/g, '"'));
                if (Array.isArray(data) && data.length > 0) {
                    data = data[0];
                    if (result) {
                        if (data.author) result.author = data.author;
                    }
                    let tlHtml = '';
                    if (data.timeline) {
                        const unescaped = data.timeline.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
                        tlHtml = '<div class="mt-4 bg-gray-50 dark:bg-gray-800 p-4 rounded-lg"><h4 class="font-bold mb-2">Nội dung chính</h4><ul class="list-disc pl-5 space-y-1">' + unescaped + '</ul></div>';
                    }
                    articleHtml = `<div class="my-6 p-4 rounded-lg bg-gray-100 dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700">
                        <div class="flex items-start gap-4 mb-4">
                            ${data.thumbnail ? `<img src="${data.thumbnail.replace(/&amp;/g, '&')}" class="w-24 h-24 object-cover rounded-md flex-shrink-0" alt="">` : ''}
                            <div class="flex-1 min-w-0">
                                <h3 class="text-[17px] font-bold text-gray-900 dark:text-gray-100 mb-2 truncate">${data.title}</h3>
                                ${data.author ? `<p class="text-sm text-gray-500 mb-2">Tác giả: ${data.author}</p>` : ''}
                            </div>
                        </div>
                        <audio controls src="${data.src}" class="w-full h-12"></audio>
                        ${tlHtml}
                    </div>` + articleHtml;
                }
            } catch(e) {}
        }

        if (articleHtml) {
            if (videoHtml && !articleHtml.includes('<video')) {
                 articleHtml = videoHtml + articleHtml;
            }
            // Helpers
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

            // 1. Extract wrap-player-popcast
            const popcastBlocks = Array.from(html.matchAll(/<div\b[^>]*class=["'][^"']*wrap-player-popcast[^"']*["'][^>]*>([\s\S]*?)<\/audio>/gi));
            let popcastsHtml = '';
            for (const blockMatch of popcastBlocks) {
                const blockInner = blockMatch[1];
                const audioMatch = blockInner.match(/<audio\b[^>]*src=["']([^"']+)["']/i);
                const titleMatch = blockInner.match(/<span\b[^>]*class=["']text["'][^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>/i);
                const imgMatch = blockInner.match(/<img\b[^>]*src=["']([^"']+)["']/i);
                
                // Remove the raw injected block from articleHtml to prevent duplicate artifacts
                articleHtml = articleHtml.replace(blockMatch[0] + '</div>', '');
                
                if (audioMatch) {
                    const audioUrl = audioMatch[1];
                    const podcastTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Podcast';
                    const imgUrl = imgMatch ? imgMatch[1] : '';
                    
                    popcastsHtml += `
<div class="my-6 p-4 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-start gap-4 shadow-sm border border-gray-200 dark:border-gray-700">
    ${imgUrl ? `<img src="${imgUrl}" class="w-20 h-20 object-cover rounded-md flex-shrink-0" alt="">` : ''}
    <div class="flex-1 min-w-0">
        <h3 class="text-[17px] font-bold text-gray-900 dark:text-gray-100 mb-2 truncate">${podcastTitle}</h3>
        <audio controls src="${audioUrl}" class="w-full h-10"></audio>
    </div>
</div>`;
                }
            }
            if (popcastsHtml) {
                articleHtml = popcastsHtml + articleHtml;
            }

            // 2. Extract box-tinlienquanv2
            let relatedItemsHtml = '';
            const boxLienQuanMatch = html.match(/<div\b[^>]*class=["'][^"']*box-tinlienquanv2[^"']*["'][^>]*>([\s\S]*?)(?:<\/div>\s*<\/div>\s*<\/div>|<\/section>\s*<\/div>)/i);
            if (boxLienQuanMatch) {
                const inner = boxLienQuanMatch[1];
                
                // Remove the raw block to prevent duplicates
                articleHtml = articleHtml.replace(boxLienQuanMatch[0], '');
                
                const sections = inner.split(/<section\b[^>]*class=["'][^"']*item-news/i).slice(1);
                sections.forEach(sec => {
                    const urlMatch = sec.match(/<a\b[^>]*href=["']([^"']+)["']/i);
                    const titleMatch = sec.match(/class=["'][^"']*title-news[^"']*["'][^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>/i) || sec.match(/title=["']([^"']+)["']/i);
                    const imgMatch = sec.match(/<img\b[^>]*data-src=["']([^"']+)["']/i) || sec.match(/<img\b[^>]*src=["']([^"']+)["']/i);
                    const descMatch = sec.match(/<p\b[^>]*class=["'][^"']*description[^"']*["'][^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>/i);
                    
                    if (urlMatch && titleMatch) {
                        const relTitle = titleMatch[1].replace(/<[^>]+>/g, '').trim();
                        const relDesc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
                        const relImg = imgMatch ? imgMatch[1] : '';
                        relatedItemsHtml += createCardHtml(urlMatch[1], relTitle, relImg, relDesc);
                    }
                });
            }
            if (relatedItemsHtml) {
                articleHtml += createSuggestedHtml('BÀI VIẾT LIÊN QUAN', relatedItemsHtml);
            }

            if (result) {
                const authorMatch = html.match(/<p\b[^>]*class=["'][^"']*(?:author_mail|Normal)[^"']*["'][^>]*text-align:\s*right[^>]*>\s*(?:<strong>|<b>)([\s\S]*?)(?:<\/strong>|<\/b>)/i) || 
                                    html.match(/<article\b[^>]*fck_detail[\s\S]*?<p\b[^>]*>\s*(?:<strong>|<b>)\s*([^<]+)\s*(?:<\/strong>|<\/b>)\s*<\/p>\s*(?:<span\b[^>]*id=["']article-end|<\/article>)/i) ||
                                    html.match(/"author":\s*\{\s*"@type":\s*"Person",\s*"name":\s*"([^"]+)"\s*\}/i);
                if (authorMatch) {
                    result.author = (authorMatch[3] || authorMatch[1] || authorMatch[2]).replace(/<[^>]+>/g, '').trim();
                }
            }

            // Clean up author paragraph from HTML since it's displayed at the top
            articleHtml = articleHtml.replace(/<p\b[^>]*class=["'][^"']*(?:author_mail|Normal)[^"']*["'][^>]*text-align:\s*right[^>]*>\s*(?:<strong>|<b>)[\s\S]*?(?:<\/strong>|<\/b>)\s*<\/p>/gi, '');
            articleHtml = articleHtml.replace(/<p\b[^>]*>\s*(?:<strong>|<b>)\s*([^<]+)\s*(?:<\/strong>|<\/b>)\s*<\/p>(?=\s*(?:<span\b[^>]*id=["']article-end|<\/article>))/gi, '');

            // Unhide embedded videos and strip their duplicate thumbnails
            articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*box_img_video[^"']*["'][^>]*>[\s\S]*?(?=<div\b[^>]*id=["']embed_video_)/gi, '');
            articleHtml = articleHtml.replace(/(<div\b[^>]*id=["']embed_video_[^>]*?)style=["']([^"']*)display:\s*none;?([^"']*)["']([^>]*>)/gi, '$1style="$2$3"$4');
            articleHtml = articleHtml.replace(/(<div\b[^>]*id=["']parser_player_[^>]*?)style=["']([^"']*)display:\s*none;?([^"']*)["']([^>]*>)/gi, '$1style="$2$3 display: block;"$4');

            return articleHtml;
        }

        // Try JSON-LD author globally if still not found
        if (result && !result.author) {
            const authorMatch = html.match(/"author":\s*\{\s*"@type":\s*"Person",\s*"name":\s*"([^"]+)"\s*\}/i);
            if (authorMatch) {
                result.author = authorMatch[1].replace(/<[^>]+>/g, '').trim();
            }
        }

        if (videoHtml) {
            return videoHtml;
        }

        // Return false to allow fallback strategies if no known body wrapper matches
        return false;
    }
}
