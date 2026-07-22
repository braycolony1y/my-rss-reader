import fs from 'fs';
import VozSource from './src/sources/VozSource.js';

async function run() {
    const res = await fetch('https://voz.vn/t/bat-giu-doi-tuong-o-ha-noi-ca-do-bong-da-qua-mang-8xbet.1261735/', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await res.text();
    const voz = new VozSource();
    const result = {};
    const utils = {
        escapeHtml: (str) => str,
        extractBalancedElementByClass: (html, cls) => {
            const m = html.match(new RegExp(`<div\\b[^>]*class=["'][^"']*${cls}[^"']*["'][^>]*>([\\s\\S]*?)</div>`, 'i'));
            return m ? m[1] : null;
        }
    };
    const parsed = voz.parseArticleHtmlContent(html, 'https://voz.vn', result, utils);
    const matches = [...parsed.matchAll(/data-post-index="(\d+)"/g)].map(m => m[1]);
    console.log(matches.join(', '));
}
run();
