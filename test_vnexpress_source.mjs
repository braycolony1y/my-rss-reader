import fs from 'fs';
import VnexpressSource from './src/sources/VnexpressSource.js';

const html = fs.readFileSync('vnexpress_test.html', 'utf8');

const source = new VnexpressSource();
const result = {};

const parsedHtml = source.parseArticleHtmlContent(
    html, 
    'https://vnexpress.net/khoanh-khac-nguoi-dan-thao-chay-khi-nui-lo-o-trung-quoc-5098705.html', 
    result, 
    {}
);

console.log('\n--- PARSED HTML ---');
console.log(parsedHtml);
console.log('\n--- MUTATED RESULT ---');
console.log(result);
