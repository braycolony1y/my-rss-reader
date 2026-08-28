export default class DantriSource {
    match(hostname) {
        return hostname === 'dantri.com.vn' || hostname.endsWith('.dantri.com.vn');
    }

    parseArticleHtmlContent(html, url, result, utils) {
        let videoData = null;

        // Try to find video from window.DT_GLOBAL in dt360 format
        const dtGlobalMatch = html.match(/window\.DT_GLOBAL\s*=\s*(.*?});/);
        if (dtGlobalMatch) {
            try {
                const streamMatch = html.match(/"streamLocalPath"\s*:\s*"([^"]+\.m3u8)"/);
                const thumbMatch = html.match(/"avatar"\s*:\s*"([^"]+\.jpg)"/);
                if (streamMatch) {
                    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
                    const title = titleMatch ? titleMatch[1].replace(' | Báo Dân trí', '').trim() : '';

                    const m3u8Url = 'https://vcdn.dantri.com.vn' + streamMatch[1];
                    const poster = thumbMatch ? ` poster="https://vcdn.dantri.com.vn${thumbMatch[1]}"` : '';
                    const videoHtml = `
                        ${title ? `<h1 class="article-title font-bold text-2xl mb-4">${title}</h1>` : ''}
                        <div class="video-container my-4">
                            <video controls  loop${poster} class="w-full rounded-lg shadow-lg" style="max-width: 100%;">
                                <source src="${m3u8Url}" type="application/x-mpegURL">
                                <source src="${m3u8Url}" type="application/vnd.apple.mpegurl">
                                Trình duyệt của bạn không hỗ trợ thẻ video.
                            </video>
                        </div>
                    `;
                    return videoHtml;
                }
            } catch (e) {
                // Ignore parse errors
            }
        }

        // Handle text articles
        if (result) {
            const imgMatch = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
            if (imgMatch) {
                result.image = imgMatch[1];
            }
            const authorMatch = html.match(/<a[^>]*rel=["']author["'][^>]*>([^<]+)<\/a>/i);
            if (authorMatch) {
                result.author = authorMatch[1].trim();
            }
        }

        let articleHtml = '';
        
        const extractBalancedByAttr = (attr, val) => {
            const escapedVal = String(val).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
            const startRegex = new RegExp('<([a-z][a-z0-9-]*)\\b[^>]*' + attr + '=["\']' + escapedVal + '["\'][^>]*>', 'i');
            const start = startRegex.exec(html);
            if (!start) return '';
            const tagName = start[1];
            const contentStart = start.index + start[0].length;
            const tokenRegex = new RegExp('<\\/?' + tagName + '\\b[^>]*>', 'gi');
            tokenRegex.lastIndex = start.index;
            let depth = 0;
            let token;
            while ((token = tokenRegex.exec(html))) {
                const isClosing = /^<\//.test(token[0]);
                const isSelfClosing = /\/>$/.test(token[0]);
                if (isClosing) {
                    depth--;
                    if (depth === 0) return html.slice(contentStart, token.index);
                } else if (!isSelfClosing) {
                    depth++;
                }
            }
            return '';
        };

        articleHtml = extractBalancedByAttr('data-slot', 'content');
        if (!articleHtml && utils && utils.extractBalancedElementByClass) {
            articleHtml = utils.extractBalancedElementByClass(html, 'singular-content');
        }
        
        if (articleHtml) {
            // Pre-process lazy images and proxy them to avoid hotlink blocking
            articleHtml = articleHtml.replace(/<img\b((?:[^>"']|"[^"]*"|'[^']*')*?)>/gi, (match, attrs) => {
                const dataSrcMatch = attrs.match(/data-src=["']([^"']+)["']/i);
                const dataOriginalMatch = attrs.match(/data-original=["']([^"']+)["']/i);
                const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
                
                const realSrc = (dataSrcMatch && dataSrcMatch[1]) || (dataOriginalMatch && dataOriginalMatch[1]) || (srcMatch && srcMatch[1]);
                
                if (realSrc && !realSrc.startsWith('data:')) {
                    // Remove existing src attribute and append new one
                    let cleanedAttrs = attrs.replace(/\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')
                                            .replace(/\bdata-src\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')
                                            .replace(/\bdata-original\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')
                                            .replace(/\bdata-lazy-src\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')
                                            .replace(/\bdata-srcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')
                                            .replace(/\bsrcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')
                                            .replace(/\bonerror\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')
                                            .replace(/\breferrerpolicy\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
                    return `<img src="${realSrc}" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='/api/proxy-image?url=${encodeURIComponent(realSrc)}';" ${cleanedAttrs}>`;
                }
                return match;
            });

            // Fix videos
            articleHtml = articleHtml.replace(/<video\b((?:[^>"']|"[^"]*"|'[^']*')*?)>/gi, (match, attrs) => {
                const dataSrcMatch = attrs.match(/data-src=["']([^"']+)["']/i);
                const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
                let realSrc = (dataSrcMatch && dataSrcMatch[1]) || (srcMatch && srcMatch[1]);
                if (realSrc) {
                    const mediaSlug = realSrc
                        .split(/[?#]/)[0]
                        .split('/')
                        .pop()
                        ?.replace(/\.mp4$/i, '');
                    const structuredVideo = (result?.videos || []).find(video =>
                        video?.url && mediaSlug && video.url.includes('/' + mediaSlug + '/')
                    ) || ((result?.videos || []).length === 1 ? result.videos[0] : null);

                    if (structuredVideo?.url) {
                        // Dantri's inline data-src points at a legacy MP4 path
                        // that can return 404. VideoObject.contentUrl is the
                        // authoritative, CORS-enabled HLS stream.
                        realSrc = structuredVideo.url;
                    } else if (realSrc.startsWith('/') && /\.mp4(?:$|[?#])/i.test(realSrc)) {
                        realSrc = 'https://vcdn.dantri.com.vn/vod' + realSrc
                            .replace(/\.mp4([?#].*)?$/i, '/playlist.m3u8$1');
                    } else if (realSrc.startsWith('/')) {
                        realSrc = 'https://vcdn.dantri.com.vn' + realSrc;
                    }
                    let cleanedAttrs = attrs.replace(/\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')
                                            .replace(/\bdata-src\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
                    if (!cleanedAttrs.includes('controls')) cleanedAttrs += ' controls';
                    if (!/\bplaysinline\b/i.test(cleanedAttrs)) cleanedAttrs += ' playsinline';
                    if (!/\bpreload\s*=/i.test(cleanedAttrs)) cleanedAttrs += ' preload="metadata"';
                    return `<video src="${realSrc}" ${cleanedAttrs}></video>`;
                }
                return match;
            });
        } else {
            return false; // Let it fallback if we couldn't parse text properly
        }

        // Helper to create suggested articles UI
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
            const proxyImg = img ? (img.startsWith('/api/') ? img : `/api/proxy-image?url=${encodeURIComponent(img)}`) : '';
            return `
            <div class="embedded-suggested-card">
                <a href="${absUrl}" target="_blank" class="embedded-suggested-overlay"></a>
                ${proxyImg ? `<img src="${proxyImg}" class="embedded-suggested-image" alt="">` : ''}
                <div class="embedded-suggested-content">
                    <div class="embedded-suggested-title">${title}</div>
                    ${desc ? `<div class="embedded-suggested-summary">${desc}</div>` : ''}
                </div></div>`;
        };

        const allRelatedItems = [];
        const addItem = (href, title, img, desc) => {
            let absUrl = href;
            try { absUrl = href.startsWith('/') ? new URL(href, url).href : href; } catch(e) {}
            if (!allRelatedItems.some(item => item.href === absUrl)) {
                allRelatedItems.push({ href: absUrl, title, img, desc });
            }
        };

        const relatedRegex = /<article\b[^>]*data-content-name=["']article-related["'][^>]*>([\s\S]*?)<\/article>/gi;
        let match;
        while ((match = relatedRegex.exec(html)) !== null) {
            const itemHtml = match[1];
            const linkMatch = itemHtml.match(/<a\b[^>]*href=["']([^"']+)["']/i);
            const titleMatch = itemHtml.match(/<h3[^>]*>.*?<a[^>]*>([\s\S]*?)<\/a>.*?<\/h3>/i) || itemHtml.match(/title=["']([^"']+)["']/i);
            const imgMatch = itemHtml.match(/data-src=["']([^"']+)["']/i) || itemHtml.match(/<img\b[^>]*src=["']([^"']+)["']/i);
            
            if (linkMatch && titleMatch) {
                addItem(linkMatch[1], titleMatch[1].replace(/<[^>]+>/g, '').trim(), imgMatch ? imgMatch[1] : '', '');
            }
        }

        if (allRelatedItems.length > 0) {
            let itemsHtml = '';
            for (const item of allRelatedItems) {
                itemsHtml += createCardHtml(item.href, item.title, item.img, item.desc);
            }
            articleHtml += createSuggestedHtml('BÀI VIẾT LIÊN QUAN', itemsHtml);
        }

        return articleHtml;
    }
}
