export default class VozSource {

    async getBestImage(targetUrl, fetchFn, rssFallback, utils) {
        if (targetUrl.includes('voz.vn/t/')) {
            targetUrl = targetUrl.replace(/\/unread\/?$/, '').replace(/\/page-\d+/i, '');
        }
        let html = '';
        let ok = false;
        try {
            let directHtml = await utils.fetchWithCookies(targetUrl, 6000);
            if (directHtml && !directHtml.includes('Just a moment')) {
                html = directHtml;
                ok = true;
            }
        } catch (e) { }

        if (!ok) {
            let fetchUrl = utils.CF_PROXY_BASE + encodeURIComponent(targetUrl);
            const res = await fetchFn(fetchUrl);
            if (!res.ok) {
                if (rssFallback && !utils.isInvalidImage(rssFallback)) return rssFallback;
                return null;
            }
            html = await res.text();
        }
        let scopeHtml = html;

        if (rssFallback && rssFallback.includes('dantri.com.vn')) rssFallback = null;
        const postMatch = html.match(/<article[^>]*message--post[^>]*>[\s\S]*?<div class="bbWrapper">([\s\S]*?)<\/div>\s*<div class="js-selectToQuoteEnd">/i) || html.match(/<div class="bbWrapper">([\s\S]*?)<\/div>\s*<div class="js-selectToQuoteEnd">/i);
        if (postMatch) scopeHtml = postMatch[1];




        const extLinks = scopeHtml.match(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>[\s\S]*?<\/a>/ig) || [];

        for (let linkTag of extLinks) {
            if (linkTag.includes('theNEXTvoz') || linkTag.includes('VOZVNApp')) continue;

            let extMatch = linkTag.match(/href=["'](https?:\/\/[^"']+)["']/i);
            if (extMatch && extMatch[1]) {
                let extUrl = extMatch[1];
                extUrl = extUrl.replace(/^https?:\/\/amp\./i, 'https://').replace(/\/amp\/?$/i, '');

                if (!extUrl.includes('voz.vn') && !extUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                    try {
                        let extFetchUrl = utils.CF_PROXY_BASE + encodeURIComponent(extUrl);
                        let extRes = await fetchFn(extFetchUrl);
                        let extHtml = '';

                        let img = null;
                        if (extRes.ok) {
                            extHtml = await extRes.text();
                            img = utils.extractImageFromHtml(extHtml, extUrl);
                        }

                        if (!img) {
                            let fallbackUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(extUrl)}`;
                            let fallbackRes = await fetchFn(fallbackUrl);
                            if (fallbackRes.ok) {
                                extHtml = await fallbackRes.text();
                                img = utils.extractImageFromHtml(extHtml, extUrl);
                            }
                        }

                        if (img) {
                            return img.startsWith('/') ? new URL(img, extUrl).href : img;
                        }
                    } catch (e) { }
                    continue;
                } else if (extUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                    return extUrl;
                }
            }
        }

        const imgTags = scopeHtml.match(/<img[^>]+>/ig) || [];
        for (let imgTag of imgTags) {
            let m = imgTag.match(/(?:data-url|data-src|src)=["']([^"']+)["']/i);
            if (m && m[1]) {
                let src = m[1];
                if (src.includes('avatar') || src.includes('smilies') || src.includes('reaction')) continue;
                if (src.startsWith('data:')) continue;
                return src.startsWith('/') ? new URL(src, targetUrl).href : src;
            }
        }

        return 'NO_FALLBACK';
    }

    match(hostname) {
        return hostname === 'voz.vn' || hostname.endsWith('.voz.vn');
    }

    cleanUrl(urlObj) {
        if (urlObj.pathname.startsWith('/t/')) {
            let path = urlObj.pathname.replace(/\/unread\/?$/, '').replace(/\/$/, '');
            path = path.replace(/\/page-\d+/i, '');
            return urlObj.origin + path + '/unread';
        }
        return null;
    }

    parseJinaReaderText(markdown) {
        const firstPostMarker = markdown.match(/(?:^|\n)\s*\*?\s*\[#1\]\([^\n)]+\)\s*\n+/m);
        if (firstPostMarker) {
            const bodyStart = (firstPostMarker.index || 0) + firstPostMarker[0].length;
            let body = markdown.slice(bodyStart);
            const endPatterns = [
                /\n_via\s+/i,
                /\n\*\s+!\[[^\]]*(?:Ưng|reaction)/i,
                /\nReactions?:/i,
                /\n\[!\[Image[^\]]*\]\(https?:\/\/[^)]+\/avatars\//i
            ];
            const ends = endPatterns.map(pattern => body.search(pattern)).filter(index => index >= 0);
            if (ends.length) body = body.slice(0, Math.min(...ends));
            if (body.trim()) {
                return {
                    markdown: body.trim(),
                    readerType: 'forum-post'
                };
            }
        }
        return null;
    }

    parseArticleHtmlContent(html, url, result, utils) {
        let articleHtml = '';
        const h1Match = html.match(/<h1[^>]*class=["'][^"']*p-title-value[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
        if (h1Match) {
            result.title = h1Match[1].replace(/<[^>]+>/g, '').trim();
        }
        
        const baseUrl = new URL(url);
        const absUrl = (href) => href ? (href.startsWith('http') ? href : baseUrl.origin + (href.startsWith('/') ? href : '/' + href)) : null;
        const pageNumMatch = url.match(/\/page-(\d+)/i);
        let currentPage = pageNumMatch ? parseInt(pageNumMatch[1], 10) : 1;

        const pages = [];
        const pageRegex = /<li\b[^>]*class=["'][^"']*pageNav-page[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>(\d+)<\/a>[\s\S]*?<\/li>/gi;
        let pm;
        while ((pm = pageRegex.exec(html)) !== null) {
            const href = pm[1];
            const pNum = parseInt(pm[2], 10);
            const isCurrent = pm[0].includes('pageNav-page--current') || pNum === currentPage;
            if (isCurrent) currentPage = pNum;
            pages.push({ page: pNum, url: absUrl(href), isCurrent });
        }
        const uniquePagesMap = new Map();
        pages.forEach(p => { if (!uniquePagesMap.has(p.page)) uniquePagesMap.set(p.page, p); });
        const sortedPages = Array.from(uniquePagesMap.values()).sort((a,b) => a.page - b.page);

        const prevMatch = html.match(/<a\b[^>]*class=["'][^"']*pageNav-jump[^>]*pageNav-jump--prev[^"']*["'][^>]*href=["']([^"']+)["']/i) || html.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*pageNav-jump[^>]*pageNav-jump--prev/i);
        const nextMatch = html.match(/<a\b[^>]*class=["'][^"']*pageNav-jump[^>]*pageNav-jump--next[^"']*["'][^>]*href=["']([^"']+)["']/i) || html.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*pageNav-jump[^>]*pageNav-jump--next/i);
        const prevUrl = prevMatch ? absUrl(prevMatch[1]) : null;
        const nextUrl = nextMatch ? absUrl(nextMatch[1]) : null;

        result.pagination = {
            currentPage,
            pages: sortedPages.length ? sortedPages : [{ page: currentPage, url, isCurrent: true }],
            prevUrl,
            nextUrl
        };

        const posts = [];
        const escapedClass = 'message--post';
        const startRegex = new RegExp('<(article)\\b[^>]*class=(["\'])[^"\']*\\b' + escapedClass + '\\b[^"\']*\\2[^>]*>', 'gi');
        let start;
        let idx = 0;
        while ((start = startRegex.exec(html)) !== null) {
            const tagName = start[1];
            const tokenRegex = new RegExp('<\\/?' + tagName + '\\b[^>]*>', 'gi');
            tokenRegex.lastIndex = start.index + start[0].length;
            let depth = 1;
            let token;
            let endTokenIndex = html.length;
            while ((token = tokenRegex.exec(html))) {
                const isClosing = /^<\//.test(token[0]);
                const isSelfClosing = /\/>$/.test(token[0]);
                if (isClosing) {
                    depth--;
                    if (depth === 0) {
                        endTokenIndex = token.index + token[0].length;
                        startRegex.lastIndex = endTokenIndex;
                        break;
                    }
                } else if (!isSelfClosing) {
                    depth++;
                }
            }
            const artHtml = html.slice(start.index, endTokenIndex);
            const authorMatch = artHtml.match(/data-author=["']([^"']+)["']/i) || artHtml.match(/class=["']username[^>]*>([^<]+)/i);
            const author = authorMatch ? authorMatch[1].trim() : 'Member';

            const rankMatch = artHtml.match(/<h5\b[^>]*class=["'][^"']*userTitle[^"']*["'][^>]*>([\s\S]*?)<\/h5>/i) || artHtml.match(/class=["'][^"']*userTitle[^"']*["'][^>]*>([^<]+)/i);
            const rank = rankMatch ? rankMatch[1].replace(/<[^>]+>/g, '').trim() : 'Member';

            const avatarMatch = artHtml.match(/<img\b[^>]*src=["']([^"']*avatar[^"']*)["'][^>]*>/i) || artHtml.match(/class=["'][^"']*avatar\b[^>]*>[\s\S]*?src=["']([^"']+)["']/i);
            const avatarUrl = avatarMatch ? avatarMatch[1] : `https://ui-avatars.com/api/?name=${encodeURIComponent(author)}&background=random&color=fff&size=96`;

            let postTime = '';
            const attrMainMatch = artHtml.match(/<ul\b[^>]*class=["'][^"']*message-attribution-main[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i) || artHtml.match(/<div\b[^>]*class=["'][^"']*message-attribution-main[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [null, artHtml];
            const timeMatch = attrMainMatch[1].match(/<time\b[^>]*>([\s\S]*?)<\/time>/i);
            if (timeMatch) {
                postTime = timeMatch[1].replace(/<[^>]+>/g, '').trim();
            } else {
                const dateStringMatch = attrMainMatch[1].match(/data-date-string=["']([^"']+)["']/i);
                if (dateStringMatch) postTime = dateStringMatch[1];
            }

            const postIdMatch = artHtml.match(/(?:data-content|data-lb-id|id)=["'](?:js-)?post-(\d+)["']/i);
            const attrOppositeMatch = artHtml.match(/<ul\b[^>]*class=["'][^"']*message-attribution-opposite[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i) || artHtml.match(/<div\b[^>]*class=["'][^"']*message-attribution-opposite[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [null, artHtml];
            let postLink = postIdMatch ? `https://voz.vn/p/${postIdMatch[1]}` : url;
            let extractedPostNumber = null;
            
            const anchorMatches = [...attrOppositeMatch[1].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
            for (const m of anchorMatches) {
                const text = m[1].replace(/<[^>]+>/g, '').trim();
                if (/^#\d+$/.test(text)) {
                    extractedPostNumber = text.substring(1);
                    const hrefMatch = m[0].match(/href=["']([^"']+)["']/i);
                    if (hrefMatch) postLink = absUrl(hrefMatch[1]);
                    break;
                }
            }

            let reactionBarHtml = '';
            const reactionsBarIndex = artHtml.indexOf('reactionsBar js-reactionsList');
            if (reactionsBarIndex !== -1) {
                const reactionsChunk = artHtml.substring(reactionsBarIndex, reactionsBarIndex + 3000);
                const reactionImages = [...reactionsChunk.matchAll(/<img\b([^>]*class=["'][^"']*(?:reaction-image|reaction\b)[^"']*["'][^>]*)>|<span\b[^>]*class=["'][^"']*(?:reaction-image|reaction\b)[^"']*["'][^>]*>[\s\S]*?<img\b([^>]+)>[\s\S]*?<\/span>/gi)];
                const linkMatch = reactionsChunk.match(/<a\b[^>]*class=["'][^"']*reactionsBar-link[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
                
                if (reactionImages.length > 0 && linkMatch) {
                    const reactionUsersText = linkMatch[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                    const reactionUrl = absUrl(linkMatch[1]);
                    
                    let uniqueSrcs = new Set();
                    let iconsHtml = reactionImages.map(m => {
                        const attrs = m[1] || m[2];
                        const src = attrs.match(/src=["']([^"']+)["']/i)?.[1] || '';
                        const srcset = attrs.match(/srcset=["']([^"']+)["']/i)?.[1] || '';
                        const alt = attrs.match(/alt=["']([^"']+)["']/i)?.[1] || '';
                        const title = attrs.match(/title=["']([^"']+)["']/i)?.[1] || '';
                        if (!src || uniqueSrcs.has(src)) return '';
                        uniqueSrcs.add(src);
                        return `<img src="${utils.escapeHtml(src)}" ${srcset ? `srcset="${utils.escapeHtml(srcset)}"` : ''} alt="${utils.escapeHtml(alt)}" title="${utils.escapeHtml(title)}" class="voz-like-icon object-contain shrink-0" style="width: 18px; height: 18px; ">`;
                    }).join('');
                    
                    reactionBarHtml = `<div class="voz-post-likes flex items-center gap-1.5 mt-2 text-xs text-gray-400 min-w-0"><div class="flex items-center gap-0.5">${iconsHtml}</div><a href="${utils.escapeHtml(reactionUrl)}" target="_blank" class="voz-like-users flex-1 truncate hover:text-gray-300 transition-colors" style="line-height: 18px;">${utils.escapeHtml(reactionUsersText)}</a></div>`;
                }
            }

            let bbContent = utils.extractBalancedElementByClass(artHtml, 'bbWrapper') || (artHtml.match(/<div\b[^>]*class=["'][^"']*bbWrapper[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]);
            
            if (bbContent) {
                // Clean inline styles and dimensions that break responsive design
                bbContent = bbContent.replace(/<(span|div|table|td|tr|p|b|i|u|tbody|thead|th|img)\b([^>]*)>/gi, (m, tag, rest) => {
                    rest = rest.replace(/\sstyle=(["'])[\s\S]*?\1/gi, '');
                    if (/^(table|td|img|th)$/i.test(tag)) {
                        rest = rest.replace(/\swidth=(["'])[\s\S]*?\1/gi, '');
                        rest = rest.replace(/\sheight=(["'])[\s\S]*?\1/gi, '');
                    }
                    return `<${tag}${rest}>`;
                });
            }

            // Extract message signature if present
            const signatureMatch = artHtml.match(/<aside\b[^>]*class=["'][^"']*message-signature[^"']*["'][^>]*>([\s\S]*?)<\/aside>/i);
            if (signatureMatch) {
                const sigHtml = `<aside class="message-signature mt-6 pt-4 border-t border-white/10 text-gray-500 text-sm italic">${signatureMatch[1]}</aside>`;
                bbContent = (bbContent || '') + sigHtml;
            }
            // Extract attachments
            const attachmentsMatch = artHtml.match(/<section\b[^>]*class=["'][^"']*message-attachments[^"']*["'][^>]*>([\s\S]*?)<\/section>/i);
            if (attachmentsMatch) {
                const attachChunk = attachmentsMatch[1];
                const attachImages = [...attachChunk.matchAll(/<a\b[^>]*class=["'][^"']*file-preview[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<img\b([^>]+)>[\s\S]*?<\/a>/gi)];
                if (attachImages.length > 0) {
                    let attachHtml = '<div class="voz-attachments mt-4 flex flex-wrap gap-2">';
                    attachImages.forEach(m => {
                        const href = absUrl(m[1]);
                        const attrs = m[2];
                        const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
                        if (srcMatch) {
                            attachHtml += `<a href="${utils.escapeHtml(href)}" target="_blank" class="block rounded-lg overflow-hidden border border-white/10 hover:border-white/20 transition-colors"><img src="${utils.escapeHtml(href)}" class="max-w-full h-auto object-cover" style="max-height:300px; border-radius:8px;"></a>`;
                        }
                    });
                    attachHtml += '</div>';
                    if (bbContent) {
                        bbContent += attachHtml;
                    } else {
                        bbContent = attachHtml;
                    }
                }
            }
            if (bbContent) {
                // Strip XenForo click-to-expand overlays
                bbContent = bbContent.replace(/<div\b[^>]*class=["'][^"']*bbCodeBlock-expandLink[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
                
                // Strip link from "theNEXTvoz" app signature
                bbContent = bbContent.replace(/<a\b[^>]*>(\s*theNEXTvoz\s*)<\/a>/gi, '$1');
                
                // Fix iframes and videos aspect ratio
                bbContent = bbContent.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (iframeMatch) => {
                    let wMatch = iframeMatch.match(/\bwidth=(["'])([^"']*)\1/i);
                    let hMatch = iframeMatch.match(/\bheight=(["'])([^"']*)\1/i);
                    let w = wMatch ? parseInt(wMatch[2]) : null;
                    let h = hMatch ? parseInt(hMatch[2]) : null;
                    
                    let arStyle = "aspect-ratio: 16 / 9;";
                    if (w && h && !isNaN(w) && !isNaN(h)) {
                        arStyle = `aspect-ratio: ${w} / ${h};`;
                    }
                    
                    let newIframe = iframeMatch.replace(/<iframe\b/i, `<iframe class="w-full rounded-xl shadow-sm" style="${arStyle}"`);
                    newIframe = newIframe.replace(/\bwidth=(["'])[^"']*\1/i, '');
                    newIframe = newIframe.replace(/\bheight=(["'])[^"']*\1/i, '');
                    return `<div class="my-3 overflow-hidden rounded-xl">${newIframe}</div>`;
                });
                
                // Fix TikTok embed
                bbContent = bbContent.replace(/<div\b[^>]*class=["'][^"']*bbOembed[^"']*["'][^>]*data-media-site-id=["']tiktok["'][^>]*data-media-key=["']([^"']+)["'][^>]*>[\s\S]*?<\/div>/gi, (match, mediaKey) => {
                    return `<div class="my-3 flex justify-center"><iframe style="max-width: 400px; min-width: 325px; aspect-ratio: auto !important; height: 720px !important;" class="w-full rounded-xl shadow-sm" src="https://www.tiktok.com/player/v1/${mediaKey}?lang=vi-VN" frameborder="0" allow="fullscreen" sandbox="allow-scripts allow-popups allow-same-origin"></iframe></div>`;
                });

                // Fix Instagram embed
                bbContent = bbContent.replace(/<div\b[^>]*data-media-site-id=["']instagram["'][^>]*data-media-key=["']([^"']+)["'][^>]*>[\s\S]*?<\/blockquote>\s*<\/div>/gi, (match, mediaKey) => {
                    return `<div class="my-3 flex justify-center"><iframe style="max-width: 400px; min-width: 325px; height: 600px !important;" class="w-full rounded-xl shadow-sm bg-white" src="https://www.instagram.com/p/${mediaKey}/embed/captioned/" frameborder="0" allow="fullscreen" sandbox="allow-scripts allow-popups allow-same-origin"></iframe></div>`;
                });

                bbContent = bbContent.replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, (videoMatch) => {
                    let wMatch = videoMatch.match(/\bwidth=(["'])([^"']*)\1/i);
                    let hMatch = videoMatch.match(/\bheight=(["'])([^"']*)\1/i);
                    let w = wMatch ? parseInt(wMatch[2]) : null;
                    let h = hMatch ? parseInt(hMatch[2]) : null;
                    
                    let arStyle = "aspect-ratio: 16 / 9;";
                    if (w && h && !isNaN(w) && !isNaN(h)) {
                        arStyle = `aspect-ratio: ${w} / ${h};`;
                    }
                    
                    let newVideo = videoMatch.replace(/<video\b/i, `<video class="w-full rounded-xl shadow-sm" style="${arStyle}" controls`);
                    newVideo = newVideo.replace(/\bwidth=(["'])[^"']*\1/i, '');
                    newVideo = newVideo.replace(/\bheight=(["'])[^"']*\1/i, '');
                    return `<div class="my-3 overflow-hidden rounded-xl">${newVideo}</div>`;
                });

                // Fix Unfurl Favicon images getting too big
                bbContent = bbContent.replace(/<img\b[^>]*class=["'][^"']*bbCodeBlockUnfurl-icon[^"']*["'][^>]*>/gi, (imgMatch) => {
                    return imgMatch.replace(/class=["']([^"']*)["']/i, 'class="$1 w-4 h-4 object-contain inline-block align-middle mr-1.5"');
                });
                // Format quote title cleanly without nested anchors/spans or emojis
                bbContent = bbContent.replace(/<div\b[^>]*class=["'][^"']*bbCodeBlock-title[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi, (m, c) => {
                    const text = c.replace(/<[^>]+>/g, '').trim();
                    return `<div class="voz-quote-title font-semibold text-gray-700 dark:text-gray-300 text-xs mb-1.5">${text}</div>`;
                });
                // Simplify blockquote hierarchy by just adding classes
                bbContent = bbContent.replace(/<blockquote\b[^>]*>/gi, match => {
                    if (match.includes('voz-quote')) return match;
                    return `<blockquote class="voz-quote my-2 p-3 rounded-xl border-l-4 border-l-amber-500 bg-black/30 text-sm text-gray-300 leading-relaxed shadow-sm">`;
                });
                
                // Fix bbImageWrapper: large images stay as responsive blocks, small emoticons become inline
                bbContent = bbContent.replace(/<div\b([^>]*class=["'][^"']*bbImageWrapper[^"']*["'][^>]*)>([\s\S]*?)<\/div>/gi, (match, attrs, inner) => {
                    const imgMatch = inner.match(/<img[^>]+>/i);
                    let isSmall = false;
                    
                    if (imgMatch) {
                        const imgTag = imgMatch[0];
                        if (/(smilies|voz\.vn\/[^\/]+\/(?:voz|pepe|pop|stickers|moe|onion))/i.test(imgTag) || /\bsmilie\b/i.test(imgTag)) {
                            isSmall = true;
                        } else {
                            const wMatch = imgTag.match(/\bwidth=["']?(\d+)["']?/i);
                            const hMatch = imgTag.match(/\bheight=["']?(\d+)["']?/i);
                            if (wMatch && parseInt(wMatch[1]) <= 150 && (!hMatch || parseInt(hMatch[1]) <= 150)) {
                                isSmall = true;
                            }
                        }
                    }
                    
                    if (isSmall) {
                        let newInner = inner;
                        if (imgMatch) {
                            let imgTag = imgMatch[0];
                            imgTag = imgTag.replace(/\bclass=["']([^"']*)["']/i, (m, cls) => `class="${cls.replace(/\bbbImage\b/gi, '').trim()} voz-small-img"`);
                            if (!imgTag.includes('voz-small-img')) {
                                imgTag = imgTag.replace(/<img\b/i, '<img class="voz-small-img"');
                            }
                            newInner = newInner.replace(imgMatch[0], imgTag);
                        }
                        return `<span class="voz-small-img-wrapper">${newInner}</span>`;
                    }
                    
                    // Force the wrapper to be a span so it flows inline if it happens to be a small image 
                    // without explicit width/height attributes (like external gifs).
                    // We also ensure the img inside gets inline-block to prevent Tailwind's block reset from breaking lines.
                    let newInner = inner;
                    if (imgMatch) {
                        let imgTag = imgMatch[0];
                        if (!imgTag.includes('inline-block')) {
                            imgTag = imgTag.replace(/<img\b/i, '<img style="display: inline-block !important;" ');
                        }
                        newInner = newInner.replace(imgMatch[0], imgTag);
                    }
                    
                    return `<span ${attrs} style="display: inline-block !important; margin: 0 !important;">${newInner}</span>`;
                });
            } else {
                bbContent = artHtml;
            }

            const postNumberMatch = artHtml.match(/#(\d+)\s*<\/a>/i) || artHtml.match(/>#(\d+)</i) || artHtml.match(/post-(\d+)/i);
            let postNumber = extractedPostNumber || (postNumberMatch ? postNumberMatch[1] : (idx + 1 + ((currentPage - 1) * 20)));

            posts.push(`
<div class="voz-post" id="voz-post-${postNumber}" data-post-index="${postNumber}">
    <div class="voz-post-header">
        <div class="voz-post-author-group">
            <img src="${utils.escapeHtml(avatarUrl)}" alt="${utils.escapeHtml(author)}" loading="lazy" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(author)}&background=random&color=fff&size=80'">
            <span class="voz-post-author">@${utils.escapeHtml(author)}</span>
            <span class="voz-post-rank">${utils.escapeHtml(rank)}</span>
        </div>
        <div class="voz-post-info">
            ${postTime ? `<span class="voz-post-time">${utils.escapeHtml(postTime)}</span>` : ''}
            <a href="${utils.escapeHtml(postLink)}" target="_blank" class="voz-post-index" title="Mở bài viết gốc">#${postNumber}</a>
        </div>
    </div>
    <div class="voz-post-body">${bbContent}</div>
    ${reactionBarHtml}
</div>`.trim());
            idx++;
        }
        if (posts.length > 0) {
            articleHtml = posts.join('\n');
            result.siteName = result.siteName || 'VOZ';
        } else {
            const fallbackBb = utils.extractBalancedElementByClass(html, 'bbWrapper');
            if (fallbackBb && fallbackBb.length > 30) {
                articleHtml = `<div class="voz-post" id="voz-post-1" data-post-index="1"><div class="voz-post-header"><div class="voz-post-author-group"><span class="voz-post-author">@VOZ Member</span></div><div class="voz-post-info"><a href="${utils.escapeHtml(url)}" target="_blank" class="voz-post-index">#1</a></div></div><div class="voz-post-body">${fallbackBb}</div></a>`;
                result.siteName = result.siteName || 'VOZ';
            }
        }
    
        return articleHtml;
    }
}
