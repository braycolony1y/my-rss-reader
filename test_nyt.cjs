(async () => {
    const CF_PROXY_BASE = 'https://rss-proxy.k1d.workers.dev/?url=';
    const targetUrl = 'https://www.nytimes.com/2026/07/19/world/europe/russia-ukraine-strikes.html';
    const res = await fetch(CF_PROXY_BASE + encodeURIComponent(targetUrl));
    const html = await res.text();
    require('fs').writeFileSync('nyt.html', html);
})();
