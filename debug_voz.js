import VozSource from './src/sources/VozSource.js';
import * as utils from './src/utils.js';

async function run() {
    const s = new VozSource();
    const p1 = await utils.fetchWithCookies('https://voz.vn/t/trung-quoc-mo-hinh-ai-trung-quoc-co-the-vuot-san-pham-chu-luc-cua-anthropic.1261492/');
    const p3 = await utils.fetchWithCookies('https://voz.vn/t/trung-quoc-mo-hinh-ai-trung-quoc-co-the-vuot-san-pham-chu-luc-cua-anthropic.1261492/page-3');

    const m1 = p1.match(/<article data-content="post-42983698"[^>]*>[\s\S]*?(<div class="message-footer"[^>]*>[\s\S]*?)<\/article>/);
    if (m1) console.log("PAGE 1 REACTION HTML:\n", m1[1].match(/<div class="reactionsBar[^>]*>[\s\S]*?<\/div>\s*<\/div>/)?.[0]);

    const m3 = p3.match(/<article data-content="post-42984170"[^>]*>[\s\S]*?(<div class="message-footer"[^>]*>[\s\S]*?)<\/article>/);
    if (m3) console.log("PAGE 3 REACTION HTML:\n", m3[1].match(/<div class="reactionsBar[^>]*>[\s\S]*?<\/div>\s*<\/div>/)?.[0]);
}
run();
