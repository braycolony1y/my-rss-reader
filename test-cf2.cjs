async function test() {
    const BROWSER_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8'
    };
    const url = "https://voz.vn/t/tien-trong-dan-rat-nhieu.1261189/post-42970590";
    const CF_PROXY_BASE = 'https://rss-proxy.k1d.workers.dev/?url=';
    const fetchUrl = CF_PROXY_BASE + encodeURIComponent(url);
    const res = await fetch(fetchUrl, { headers: BROWSER_HEADERS });
    const html = await res.text();
    
    function escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }
    
    const splitRegex = /<article\b[^>]*class=["'][^"']*message--post[^"']*["'][^>]*>/gi;
    let match;
    const matches = [];
    while ((match = splitRegex.exec(html)) !== null) {
        matches.push(match);
    }
    
    if (matches.length > 0) {
        // Find the exact post
        let artHtml = '';
        for (let idx=0; idx<matches.length; idx++) {
            const start = matches[idx];
            const endTokenIndex = (idx + 1 < matches.length) ? matches[idx + 1].index : html.length;
            const currentArtHtml = html.slice(start.index, endTokenIndex);
            if (currentArtHtml.includes('42970590')) {
                artHtml = currentArtHtml;
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
                    return `<img src="${escapeHtml(src)}" ${srcset ? `srcset="${escapeHtml(srcset)}"` : ''} alt="${escapeHtml(alt)}" title="${escapeHtml(title)}" style="width:18px; height:18px; object-fit:contain; flex-shrink:0;" class="voz-reaction-icon">`;
                }).join('');
                
                reactionBarHtml = `<div class="voz-post-reactions" style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.04); display:flex; align-items:center; gap:8px; font-size:12px; color:#6b7280; overflow:hidden;"><div style="display:flex; align-items:center; margin-right:4px;">${iconsHtml}</div><a href="${escapeHtml(reactionUrl)}" target="_blank" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:inherit; text-decoration:none;" class="hover:text-gray-400 transition-colors">${escapeHtml(reactionUsersText)}</a></div>`;
            }
        }
        
        console.log(reactionBarHtml);
    }
}
test().catch(console.error);
