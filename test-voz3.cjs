const fs = require('fs');

function absUrl(url) {
    if (!url) return '';
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) return 'https://voz.vn' + url;
    return url;
}

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

async function test() {
    const url = "https://voz.vn/t/toyota-dau-tu-360-trieu-usd-lam-nha-may-san-xuat-xe-hybrid-electric-tai-viet-nam.1261194/unread";
    const res = await fetch(url);
    const html = await res.text();
    
    const splitRegex = /<article\b[^>]*class=["'][^"']*message--post[^"']*["'][^>]*>/gi;
    let match;
    const matches = [];
    while ((match = splitRegex.exec(html)) !== null) {
        matches.push(match);
    }
    
    if (matches.length === 0) {
        console.log("No posts found in HTML!");
        return;
    }
    
    for (let idx = 0; idx < 1; idx++) {
        const start = matches[idx];
        const endTokenIndex = (idx + 1 < matches.length) ? matches[idx + 1].index : html.length;
        const artHtml = html.slice(start.index, endTokenIndex);
        
        // 1. Time extraction
        let postTime = '';
        const attrMainMatch = artHtml.match(/<ul\b[^>]*class=["'][^"']*message-attribution-main[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i) || artHtml.match(/<div\b[^>]*class=["'][^"']*message-attribution-main[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [null, artHtml];
        const timeMatch = attrMainMatch[1].match(/<time\b[^>]*>([\s\S]*?)<\/time>/i);
        if (timeMatch) {
            postTime = timeMatch[1].replace(/<[^>]+>/g, '').trim();
        } else {
            const dateStringMatch = attrMainMatch[1].match(/data-date-string=["']([^"']+)["']/i);
            if (dateStringMatch) postTime = dateStringMatch[1];
        }

        // 2. Post number extraction
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

        // 3. Reaction bar extraction
        let reactionBarHtml = '';
        const reactionsBarIndex = artHtml.indexOf('reactionsBar js-reactionsList');
        if (reactionsBarIndex !== -1) {
            const reactionsChunk = artHtml.substring(reactionsBarIndex, reactionsBarIndex + 3000);
            const reactionImages = [...reactionsChunk.matchAll(/<span\b[^>]*class=["'][^"']*reaction-image[^"']*["'][^>]*>[\s\S]*?<img\b([^>]+)>[\s\S]*?<\/span>|<img\b([^>]*class=["'][^"']*reaction-image[^"']*["'][^>]*)>/gi)];
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
                    return `<img src="${escapeHtml(src)}" ${srcset ? `srcset="${escapeHtml(srcset)}"` : ''} alt="${escapeHtml(alt)}" title="${escapeHtml(title)}" class="w-[18px] h-[18px] object-contain shrink-0">`;
                }).join('');
                
                reactionBarHtml = `<div class="voz-post-reactions mt-2 pt-2 border-t border-white/[0.04] flex items-center gap-2 text-[12px] text-gray-500 overflow-hidden"><div class="flex items-center -space-x-1 shrink-0 drop-shadow-sm">${iconsHtml}</div><a href="${escapeHtml(reactionUrl)}" target="_blank" class="truncate hover:text-gray-400 transition-colors text-inherit no-underline">${escapeHtml(reactionUsersText)}</a></div>`;
            }
        }

        const postNumberMatch = artHtml.match(/#(\d+)\s*<\/a>/i) || artHtml.match(/>#(\d+)</i) || artHtml.match(/post-(\d+)/i);
        let postNumber = extractedPostNumber || (postNumberMatch ? postNumberMatch[1] : (idx + 1));

        console.log({
            postTime,
            extractedPostNumber,
            postNumber,
            reactionBarHtml
        });
        
        console.log("HTML length:", artHtml.length);
        console.log("Attr opposite block:", attrOppositeMatch[1].slice(0, 500));
    }
}
test().catch(console.error);
