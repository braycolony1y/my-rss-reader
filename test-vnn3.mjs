import VietnamnetSource from './src/sources/VietnamnetSource.js';
import fs from 'fs';

async function test() {
    const url = "https://vietnamnet.vn/canh-tuong-tan-hoang-o-son-la-lai-chau-sau-tran-lu-du-o-to-bi-vo-nat-2536753.html";
    const res = await fetch(url);
    const html = await res.text();
    
    console.log("Found Sạt lở đất:", html.includes("Sạt lở đất vùi lấp 5 bà cháu"));
    
    const source = new VietnamnetSource();
    const utils = { fetchWithTimeout: (url, opts, t) => fetch(url, opts) };
    const preHtml = await source.preProcessHtml(html, utils);
    const parsed = await source.parseArticleHtmlContent(preHtml, url, {}, utils);
    
    fs.writeFileSync('test_vnn3_orig.html', html);
    fs.writeFileSync('test_vnn3_parsed.html', parsed);
    console.log("Done");
}
test();
