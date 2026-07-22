import fs from 'fs';
import VozSource from './src/sources/VozSource.js';

const html = fs.readFileSync('raw_thread.html', 'utf-8');
const voz = new VozSource();
const result = {};
const utils = {
    escapeHtml: (str) => str,
    extractBalancedElementByClass: (html, cls) => html.match(new RegExp(`<div\\b[^>]*class=["'][^"']*${cls}[^"']*["'][^>]*>([\\s\\S]*?)</div>`, 'i'))?.[1]
};
const parsed = voz.parseArticleHtmlContent(html, 'https://voz.vn', result, utils);
const matches = [...parsed.matchAll(/data-post-index="(\d+)"/g)].map(m => m[1]);
console.log('Posts parsed:', matches.join(', '));
