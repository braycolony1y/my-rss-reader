import fs from 'fs';
import VtvSource from './src/sources/VtvSource.js';
const html = fs.readFileSync('/tmp/vtv.html', 'utf8');
const source = new VtvSource();
const result = source.parseArticleHtmlContent(html, 'https://vtv.vn/...', {}, {});
console.log(result.includes('Tây Ban Nha đăng quang'));
console.log(result.includes('BÀI VIẾT LIÊN QUAN'));
