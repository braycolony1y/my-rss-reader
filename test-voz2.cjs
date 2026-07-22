const fs = require('fs');

async function test() {
    const url = "https://voz.vn/t/thanh-nien-bi-tam-giam-vi-chui-boi-tren-mang.813038/"; // example
    const res = await fetch(url);
    const html = await res.text();
    
    const splitRegex = /<article\b[^>]*class=["'][^"']*message--post[^"']*["'][^>]*>/gi;
    let match;
    const matches = [];
    while ((match = splitRegex.exec(html)) !== null) {
        matches.push(match);
    }
    
    for (let idx = 0; idx < 1; idx++) {
        const start = matches[idx];
        const endTokenIndex = (idx + 1 < matches.length) ? matches[idx + 1].index : html.length;
        const artHtml = html.slice(start.index, endTokenIndex);
        
        let postTime = '';
        const attrMainMatch = artHtml.match(/<[^>]*class=["'][^"']*message-attribution-main[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|ul|li)>/i) || [null, artHtml];
        const timeMatch = attrMainMatch[1].match(/<time\b[^>]*>([\s\S]*?)<\/time>/i);
        if (timeMatch) {
            postTime = timeMatch[1].replace(/<[^>]+>/g, '').trim();
        } else {
            const dateStringMatch = attrMainMatch[1].match(/data-date-string=["']([^"']+)["']/i);
            if (dateStringMatch) postTime = dateStringMatch[1];
        }

        const postIdMatch = artHtml.match(/(?:data-content|data-lb-id|id)=["'](?:js-)?post-(\d+)["']/i);
        const attrOppositeMatch = artHtml.match(/<[^>]*class=["'][^"']*message-attribution-opposite[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|ul|li)>/i) || [null, artHtml];
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
            const reactionImages = [...reactionsChunk.matchAll(/<span\b[^>]*class=["'][^"']*reaction-image[^"']*["'][^>]*>[\s\S]*?<img\b([^>]+)>[\s\S]*?<\/span>|<img\b([^>]*class=["'][^"']*reaction-image[^"']*["'][^>]*)>/gi)];
            const linkMatch = reactionsChunk.match(/<a\b[^>]*class=["'][^"']*reactionsBar-link[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
            
            if (reactionImages.length > 0 && linkMatch) {
                const reactionUsersText = linkMatch[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                const reactionUrl = linkMatch[1];
                
                let iconsHtml = reactionImages.map(m => {
                    const attrs = m[1] || m[2];
                    const src = attrs.match(/src=["']([^"']+)["']/i)?.[1] || '';
                    const srcset = attrs.match(/srcset=["']([^"']+)["']/i)?.[1] || '';
                    const alt = attrs.match(/alt=["']([^"']+)["']/i)?.[1] || '';
                    const title = attrs.match(/title=["']([^"']+)["']/i)?.[1] || '';
                    return `<img src="${src}" ${srcset ? `srcset="${srcset}"` : ''} alt="${alt}" title="${title}" class="w-[18px] h-[18px] object-contain shrink-0">`;
                }).join('');
                
                reactionBarHtml = `<div class="voz-post-reactions mt-2 pt-2 border-t border-white/[0.04] flex items-center gap-2 text-[12px] text-gray-500 overflow-hidden"><div class="flex items-center -space-x-1 shrink-0 drop-shadow-sm">${iconsHtml}</div><a href="${reactionUrl}" target="_blank" class="truncate hover:text-gray-400 transition-colors text-inherit no-underline">${reactionUsersText}</a></div>`;
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
    }
}
test().catch(console.error);
