import { extractImageFromHtml } from './server.js';
async function test() {
    const res = await fetch("https://rss-proxy.k1d.workers.dev/?url=https%3A%2F%2Ftuoitre.vn%2Ftai-xe-o-to-un-canh-sat-giao-thong-de-bo-chay-o-ha-noi-la-ai-100260721121827304.htm");
    const html = await res.text();
    const img = extractImageFromHtml(html, "https://tuoitre.vn/tai-xe-o-to-un-canh-sat-giao-thong-de-bo-chay-o-ha-noi-la-ai-100260721121827304.htm");
    console.log("Extracted:", img);
}
test();
