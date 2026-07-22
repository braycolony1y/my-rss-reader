(async () => {
    const CF_PROXY_BASE = 'https://rss-proxy.k1d.workers.dev/?url=';
    const targetUrl = 'https://cafef.vn/can-canh-trai-lon-o-thanh-hoa-noi-xay-ra-vu-tai-nan-khien-5-nguoi-chet-188260719231615269.chn';
    const res = await fetch(CF_PROXY_BASE + encodeURIComponent(targetUrl));
    const html = await res.text();
    require('fs').writeFileSync('cafef_proxy.html', html);
})();
