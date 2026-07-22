import fs from 'fs';
import VietnamnetSource from './src/sources/VietnamnetSource.js';

async function test() {
    const url = 'https://vietnamnet.vn/danh-tinh-tai-xe-o-to-7-cho-khong-nhuong-duong-cho-xe-cuu-thuong-suot-5km-2536738.html';
    const html = fs.readFileSync('vnn_related_test.html', 'utf8');
    
    const source = new VietnamnetSource();
    const result = {};
    const utils = {};
    const parsed = source.parseArticleHtmlContent(html, url, result, utils);
    
    fs.writeFileSync('vnn_parsed.html', parsed);
    console.log("Wrote parsed HTML to vnn_parsed.html");
}
test();
