const targetUrl = 'https://voz.vn/t/tu-de-thi-ngu-van-den-hanh-trinh-nuoi-duong-nhung-steve-jobs-viet-nam.1262887/post-43052503';
const proxyUrl = 'https://rss-proxy.k1d.workers.dev/?url=' + encodeURIComponent(targetUrl);
fetch(proxyUrl).then(r => r.text()).then(html => {
    const match = html.match(/<div class="bbCodeBlock bbCodeBlock--spoiler">([\s\S]*?)<\/div>\s*<\/div>/);
    if(match) console.log(match[0]);
});
