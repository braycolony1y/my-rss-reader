async function test() {
    const BROWSER_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8'
    };
    const url = "https://voz.vn/t/tien-trong-dan-rat-nhieu.1261189/post-42970565";
    const CF_PROXY_BASE = 'https://rss-proxy.k1d.workers.dev/?url=';
    const fetchUrl = CF_PROXY_BASE + encodeURIComponent(url);
    const res = await fetch(fetchUrl, { headers: BROWSER_HEADERS });
    const html = await res.text();
    
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
            if (currentArtHtml.includes('42970565')) {
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
            
            console.log("Found", reactionImages.length, "images");
            
            if (reactionImages.length > 0 && linkMatch) {
                const reactionUsersText = linkMatch[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                const reactionUrl = linkMatch[1];
                
                let iconsHtml = reactionImages.map(m => {
                    const attrs = m[1] || m[2];
                    const src = attrs.match(/src=["']([^"']+)["']/i)?.[1] || '';
                    const srcset = attrs.match(/srcset=["']([^"']+)["']/i)?.[1] || '';
                    const alt = attrs.match(/alt=["']([^"']+)["']/i)?.[1] || '';
                    const title = attrs.match(/title=["']([^"']+)["']/i)?.[1] || '';
                    return `<img src="${src}" srcset="${srcset}" alt="${alt}" title="${title}" class="w-[18px] h-[18px] object-contain shrink-0">`;
                }).join('');
                
                console.log("ICONS HTML:", iconsHtml);
                console.log("USERS:", reactionUsersText);
            } else {
                console.log("Matches:", reactionImages.length > 0, !!linkMatch);
            }
        }
    }
}
test().catch(console.error);
