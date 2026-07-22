import fs from 'fs';
import VtvSource from './src/sources/VtvSource.js';

const html = fs.readFileSync('vtv.html', 'utf-8');
const source = new VtvSource();

if (source.match('vtv.vn')) {
    const result = source.parseArticleHtmlContent(html, 'https://vtv.vn/mot-giao-vien-truong-thpt-chuyen-tuyen-quang-lien-quan-vu-gian-lan-thi-cu-den-dau-thu-100260717183037249.htm', {}, {});
    console.log("Parsed result length:", result.length);
    
    if (result.includes('Trường THPT Chuyên Tuyên Quang')) {
        console.log("SUCCESS: Image caption / text is present");
    }
    
    if (result.includes('<img')) {
        console.log("SUCCESS: Images are present in the output");
    }

    if (result.includes('embedded-suggested-articles')) {
        console.log("SUCCESS: Related articles section created");
        const relStart = result.indexOf('embedded-suggested-articles');
        console.log(result.substring(relStart - 20, relStart + 500));
    }
}
