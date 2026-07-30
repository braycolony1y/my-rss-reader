import fs from 'fs';
import TuoitreSource from './src/sources/TuoitreSource.js';
const html = fs.readFileSync('/tmp/tuoitre.html', 'utf8');

const source = new TuoitreSource();
const resultHtml = source.parseArticleHtmlContent(html, 'https://tuoitre.vn/...', {}, {});
console.log(resultHtml.includes("Dòng sự kiện"));
console.log(resultHtml.slice(0, 500));
