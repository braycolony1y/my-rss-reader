import fs from 'fs';
import DantriSource from './src/sources/DantriSource.js';

const html = fs.readFileSync('scratch_dantri_article.html', 'utf8');
const source = new DantriSource();
const result = {};
const output = source.parseArticleHtmlContent(html, 'https://dantri.com.vn/', result, {});
console.log(output.substring(0, 500));
console.log('\n======================\n');
console.log(output.match(/<img[^>]*>/gi));
