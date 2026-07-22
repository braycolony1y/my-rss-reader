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
    
    const splitRegex = /<article\b[^>]*class=["'][^"']*message--post[^"']*["'][^>]*>/gi;
    let match;
    const matches = [];
    while ((match = splitRegex.exec(html)) !== null) {
        matches.push(match);
    }
    
    if (matches.length > 0) {
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
        
        function extractBalancedElementByClass(html, className) {
            const startRegex = new RegExp(`<[^>]*\\bclass=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, 'i');
            const startMatch = html.match(startRegex);
            if (!startMatch) return null;
            
            const startIndex = startMatch.index;
            let currentIdx = startIndex + startMatch[0].length;
            let depth = 1;
            
            while (depth > 0 && currentIdx < html.length) {
                const nextOpen = html.indexOf('<div', currentIdx);
                const nextClose = html.indexOf('</div', currentIdx);
                
                if (nextClose === -1) break;
                
                if (nextOpen !== -1 && nextOpen < nextClose) {
                    depth++;
                    currentIdx = nextOpen + 4;
                } else {
                    depth--;
                    currentIdx = nextClose + 6;
                }
            }
            
            if (depth === 0) {
                return html.slice(startIndex + startMatch[0].length, currentIdx - 6); // Extract inner HTML
            }
            return null;
        }

        console.log("----- BB WRAPPER -----");
        console.log(extractBalancedElementByClass(artHtml, 'bbWrapper'));
        console.log("----------------------");
    }
}
test().catch(console.error);
