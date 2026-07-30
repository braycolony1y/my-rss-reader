import { JSDOM } from 'jsdom';
import fetch from 'node-fetch';

async function test() {
    const BBCSource = (await import('./src/sources/BBCSource.js')).default;
    const utils = { escapeHtml: (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') };
    const html = await (await fetch('https://www.bbc.com/vietnamese/articles/cgljy6epjzwo')).text();
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const article = document.querySelector('article') || document.querySelector('main');
    
    // Dump text of top 10 elements inside article
    const children = article.children;
    for(let i = 0; i < 15 && i < children.length; i++) {
        console.log(`[${i}] <${children[i].tagName}> class="${children[i].className}": ${children[i].textContent.slice(0, 100)}`);
    }
}
test();
