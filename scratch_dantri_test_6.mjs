import DantriSource from './src/sources/DantriSource.js';
const html = await (await fetch('https://dantri.com.vn/the-thao/chung-ket-world-cup-2026-kem-hap-dan-fifa-tu-pha-vo-luat-le-20260720234313079.htm')).text();
const parser = new DantriSource();
const result = parser.parseArticleHtmlContent(html, 'https://dantri.com.vn/...', {}, {
    extractBalancedElementByClass: (h, cls) => {
        const match = h.match(new RegExp(`<div\\b[^>]*class=["'][^"']*${cls}[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, 'i'));
        return match ? match[0] : '';
    }
});
const imgs = result.match(/<img[^>]+>/g) || [];
console.log("Images parsed:\n" + imgs.join('\n'));
if(imgs.length > 0) {
    const srcMatch = imgs[0].match(/src=["'](.*?)["']/);
    if(srcMatch) {
        console.log("Fetching: " + srcMatch[1]);
        const res = await fetch("http://localhost:3000" + srcMatch[1]);
        console.log("Status: " + res.status);
    }
}
