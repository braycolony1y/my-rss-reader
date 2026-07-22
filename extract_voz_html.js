    // XenForo forums such as VOZ wrap each post in a large <article>
    // containing the avatar, member profile, actions and footer. Extract all posts across
    // the page along with pagination info.
    if (hostname === 'voz.vn' || hostname.endsWith('.voz.vn')) {
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
                    
                    let iconsHtml = reactionImages.map(m => {
                        const attrs = m[1] || m[2];
                        const src = attrs.match(/src=["']([^"']+)["']/i)?.[1] || '';
                        const srcset = attrs.match(/srcset=["']([^"']+)["']/i)?.[1] || '';
                        const alt = attrs.match(/alt=["']([^"']+)["']/i)?.[1] || '';
                        const title = attrs.match(/title=["']([^"']+)["']/i)?.[1] || '';
                        return `<img src="${escapeHtml(src)}" ${srcset ? `srcset="${escapeHtml(srcset)}"` : ''} alt="${escapeHtml(alt)}" title="${escapeHtml(title)}" style="width:18px; height:18px; object-fit:contain; flex-shrink:0;" class="voz-like-icon">`;
                    }).join('');
                    
                    reactionBarHtml = `<div class="voz-post-likes" style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.04); display:flex; align-items:center; gap:8px; font-size:12px; color:#6b7280; overflow:hidden;"><div style="display:flex; align-items:center; margin-right:4px;">${iconsHtml}</div><a href="${escapeHtml(reactionUrl)}" target="_blank" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:inherit; text-decoration:none !important;" class="voz-like-users hover:text-gray-400 transition-colors no-underline">${escapeHtml(reactionUsersText)}</a></div>`;
                }
            }

            let bbContent = extractBalancedElementByClass(artHtml, 'bbWrapper') || (artHtml.match(/<div\b[^>]*class=["'][^"']*bbWrapper[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]);
            
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
                            attachHtml += `<a href="${escapeHtml(href)}" target="_blank" class="block rounded-lg overflow-hidden border border-white/10 hover:border-white/20 transition-colors"><img src="${escapeHtml(href)}" class="max-w-full h-auto object-cover" style="max-height:300px; border-radius:8px;"></a>`;
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
                
                // Fix Youtube/Vimeo iframes aspect ratio
                bbContent = bbContent.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (iframeMatch) => {
                    if (/(youtube|youtube-nocookie|youtu\.be|vimeo|dailymotion)/i.test(iframeMatch)) {
                        let newIframe = iframeMatch.replace(/<iframe\b/i, '<iframe class="w-full aspect-video rounded-xl shadow-sm"');
                        newIframe = newIframe.replace(/\bwidth=(["'])[^"']*\1/i, '');
                        newIframe = newIframe.replace(/\bheight=(["'])[^"']*\1/i, '');
                        return `<div class="my-3 overflow-hidden rounded-xl">${newIframe}</div>`;
                    }
                    return iframeMatch;
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
                bbContent = bbContent.replace(/<div\b[^>]*class=["'][^"']*bbImageWrapper[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi, (match, inner) => {
                    const imgMatch = inner.match(/<img[^>]+>/i);
                    let isSmall = false;
                    
                    if (imgMatch) {
                        const imgTag = imgMatch[0];
                        if (/(smilies|voz\.vn\/[^\/]+\/(?:voz|pepe|pop|stickers|moe|onion))/i.test(imgTag) || /\bsmilie\b/i.test(imgTag)) {
                            isSmall = true;
                        } else {
                            const wMatch = imgTag.match(/\bwidth=["']?(\d+)["']?/i);
                            const hMatch = imgTag.match(/\bheight=["']?(\d+)["']?/i);
                            if (wMatch && parseInt(wMatch[1]) <= 96 && (!hMatch || parseInt(hMatch[1]) <= 96)) {
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
                    
                    return match;
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
            <img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(author)}" loading="lazy" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(author)}&background=random&color=fff&size=80'">
            <span class="voz-post-author">@${escapeHtml(author)}</span>
            <span class="voz-post-rank">${escapeHtml(rank)}</span>
        </div>
        <div class="voz-post-info">
            ${postTime ? `<span class="voz-post-time">${escapeHtml(postTime)}</span>` : ''}
            <a href="${escapeHtml(postLink)}" target="_blank" class="voz-post-index" title="Mở bài viết gốc">#${postNumber}</a>
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
            const fallbackBb = extractBalancedElementByClass(html, 'bbWrapper');
            if (fallbackBb && fallbackBb.length > 30) {
                articleHtml = `<div class="voz-post" id="voz-post-1" data-post-index="1"><div class="voz-post-header"><div class="voz-post-author-group"><span class="voz-post-author">@VOZ Member</span></div><div class="voz-post-info"><a href="${escapeHtml(url)}" target="_blank" class="voz-post-index">#1</a></div></div><div class="voz-post-body">${fallbackBb}</div></div>`;
                result.siteName = result.siteName || 'VOZ';
            }
        }
    } else if (hostname === 'tinhte.vn' || hostname.endsWith('.tinhte.vn')) {
        const articleRegex = /<article\b[^>]*>([\s\S]*?)<\/article>/i;
        const match = html.match(articleRegex);
        if (match) {
            articleHtml = match[1];
        } else {
            const fallbackBb = extractBalancedElementByClass(html, 'bbWrapper');
            if (fallbackBb && fallbackBb.length > 30) {
                articleHtml = fallbackBb;
            }
        }
        result.siteName = result.siteName || 'Tinh tế';
    } else if (hostname === 'theverge.com' || hostname.endsWith('.theverge.com')) {
        let theVergeHtml = '';
        const classRegex = new RegExp('<div\\b[^>]*class=["\'][^"\']*duet--article--article-body-component[^"\']*["\'][^>]*>', 'ig');
        let startMatch;
        while ((startMatch = classRegex.exec(html)) !== null) {
            let index = startMatch.index;
            let tagRegex = /<\/?div\b/ig;
            tagRegex.lastIndex = index + startMatch[0].length;
            let depth = 1;
            let match;
            while ((match = tagRegex.exec(html)) !== null) {
                if (match[0].startsWith('</')) depth--; else depth++;
                if (depth === 0) {
                    theVergeHtml += html.substring(index, match.index + match[0].length + 1) + '\n';
                    classRegex.lastIndex = match.index + match[0].length;
                    break;
                }
