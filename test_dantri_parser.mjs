import DantriSource from './src/sources/DantriSource.js';
import fs from 'fs/promises';
const html = await (await fetch('https://dantri.com.vn/thoi-tiet/mien-bac-giam-mua-nhieu-noi-nang-nong-20260720215519144.htm')).text();
const parser = new DantriSource();
const result = parser.parseArticleHtmlContent(html, 'https://dantri.com.vn/...', {}, {
    extractBalancedElementByClass: (html, cls) => {
        const match = html.match(new RegExp(`<div\\b[^>]*class=["'][^"']*${cls}[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, 'i'));
        return match ? match[0] : ''; // Simplistic extraction
    }
});
console.log(result.substring(0, 1000));
console.log("MATCHES:", result.match(/<img[^>]+>/g));
