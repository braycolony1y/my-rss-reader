import fs from 'fs';
import VtvSource from './src/sources/VtvSource.js';
const html = fs.readFileSync('/tmp/vtv.html', 'utf8');
const source = new VtvSource();
const result = source.parseArticleHtmlContent(html, 'https://vtv.vn/...', {}, {});
console.log(result.includes('BÀI VIẾT LIÊN QUAN'));
console.log("Result length:", result.length);
console.log("Cards count:", (result.match(/embedded-suggested-card/g) || []).length);
