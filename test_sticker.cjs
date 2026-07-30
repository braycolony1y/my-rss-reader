const targetUrl = 'https://voz.vn/t/tu-de-thi-ngu-van-den-hanh-trinh-nuoi-duong-nhung-steve-jobs-viet-nam.1262887/post-43052785';
const proxyUrl = 'https://rss-proxy.k1d.workers.dev/?url=' + encodeURIComponent(targetUrl);
fetch(proxyUrl).then(r => r.text()).then(html => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(html);
    const post = dom.window.document.querySelector('article[data-content="post-43052785"]');
    if (post) {
        console.log(post.outerHTML);
    } else {
        console.log("Post not found");
    }
});
