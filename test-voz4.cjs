const fs = require('fs');

async function test() {
    const BROWSER_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8'
    };
    const url = "https://voz.vn/t/toyota-dau-tu-360-trieu-usd-lam-nha-may-san-xuat-xe-hybrid-electric-tai-viet-nam.1261194/unread";
    const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: 'follow' });
    const html = await res.text();
    
    const splitRegex = /<article\b[^>]*class=["'][^"']*message--post[^"']*["'][^>]*>/gi;
    let match;
    const matches = [];
    while ((match = splitRegex.exec(html)) !== null) {
        matches.push(match);
    }
    
    if (matches.length === 0) {
        console.log("No posts found in HTML! HTML length:", html.length);
        console.log("Status:", res.status);
        console.log("Headers:", res.headers.get('server'));
        console.log("First 500 chars:", html.slice(0, 500));
        return;
    }
    
    console.log(`Found ${matches.length} posts!`);
    
    const start = matches[0];
    const endTokenIndex = (1 < matches.length) ? matches[1].index : html.length;
    const artHtml = html.slice(start.index, endTokenIndex);
    
    const attrMainMatch = artHtml.match(/<ul\b[^>]*class=["'][^"']*message-attribution-main[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i) || artHtml.match(/<div\b[^>]*class=["'][^"']*message-attribution-main[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [null, artHtml];
    console.log("attrMainMatch matched length:", attrMainMatch[1].length);
    console.log("Main match chunk:", attrMainMatch[1].slice(0, 300));
    
    const attrOppositeMatch = artHtml.match(/<ul\b[^>]*class=["'][^"']*message-attribution-opposite[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i) || artHtml.match(/<div\b[^>]*class=["'][^"']*message-attribution-opposite[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [null, artHtml];
    console.log("attrOppositeMatch matched length:", attrOppositeMatch[1].length);
    console.log("Opposite match chunk:", attrOppositeMatch[1].slice(0, 300));
}
test().catch(console.error);
