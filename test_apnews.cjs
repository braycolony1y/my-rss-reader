(async () => {
    const CF_PROXY_BASE = 'https://rss-proxy.k1d.workers.dev/?url=';
    const targetUrl = 'https://apnews.com/article/tate-brothers-social-influencers-arrest-82b6638219839dcf653c09309da66f16';
    const res = await fetch(CF_PROXY_BASE + encodeURIComponent(targetUrl), { headers: { 'User-Agent': 'Mozilla/5.0' }});
    const html = await res.text();
    require('fs').writeFileSync('apnews.html', html);
})();
