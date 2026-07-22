import VozSource from './src/sources/VozSource.js';

const url = 'https://voz.vn/t/xe-khach-lao-khoi-cao-toc-phap-van-cau-gie-4-nguoi-tu-vong.1261254/post-42973327';

async function test() {
    const html = await (await fetch(url)).text();
    const source = new VozSource();
    const result = {};
    const utils = {
        fetchWithCookies: async (u) => html,
        CF_PROXY_BASE: 'https://proxy.example.com/',
        extractImageFromHtml: () => null,
        isInvalidImage: () => false
    };
    source.parseArticleHtmlContent(html, url, result, utils);
    console.log(JSON.stringify(result.content.substring(0, 1000), null, 2));
}
test();
