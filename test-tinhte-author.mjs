import TinhteSource from './src/sources/TinhteSource.js';

async function test() {
    const html = await (await fetch('https://tinhte.vn/thread/fb-web-dang-sap-roi-ha-anh-em.4161846/')).text();
    const result = new TinhteSource().parseArticleHtmlContent(html, 'https://tinhte.vn/thread/fb-web-dang-sap-roi-ha-anh-em.4161846/');
    console.log('Author:', result.author);
}
test();
