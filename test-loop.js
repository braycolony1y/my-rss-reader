const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
};
async function test() {
    const url = "https://rss-proxy.k1d.workers.dev/?url=" + encodeURIComponent("https://voz.vn/t/cac-loi-khuyen-cua-cac-hr-va-sep-cu-da-nhau-the-nao-y-domain-vs-da-nang.1265202/unread");
    for (let i = 0; i < 5; i++) {
        const res = await fetch(url, { headers: { ...BROWSER_HEADERS, 'Connection': 'close' } });
        const text = await res.text();
        console.log(`Request ${i}: HTTP ${res.status}, content length: ${text.length}, has posts: ${text.includes('<article class="message message--post')}`);
    }
}
test();
