import fs from 'fs';
import { JSDOM } from 'jsdom';
import VnexpressSource from './src/sources/VnexpressSource.js';
const html = fs.readFileSync('/tmp/vne.html', 'utf8');

const source = new VnexpressSource();
let resultHtml = source.parseArticleHtmlContent(html, 'https://vnexpress.net/...', {}, {});

function cleanArticleMarkup(markup) {
    let cleaned = String(markup || '');
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
    cleaned = cleaned.replace(/<(?:script|style|template|nav|aside|form|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|template|nav|aside|form|noscript)>/gi, '');

    cleaned = cleaned.replace(/<(img|iframe)\b[^>]*>/gi, (el, tag) => {
        if (tag.toLowerCase() === 'img') {
            if (!cleaned.includes('voz-post') && /(class|src)=["'][^"']*(avatar|author|logo|smilie|emoji)[^"']*["']/i.test(el)) return '';
            if (cleaned.includes('voz-post') && /(class|src)=["'][^"']*logo[^"']*["']/i.test(el) && !/avatar/i.test(el)) return '';
        }
        const realSrcMatch = el.match(/\s(?:data-large-src|data-original|data-src|data-url|data-zoom-image|data-img-src)=(?:"([^"]*)"|'([^']*)')/i);
        if (realSrcMatch) {
            let newEl = el.replace(/\bsrc=(?:"[^"]*"|'[^']*')/i, '');
            newEl = newEl.replace(/\b(?:data-large-src|data-original|data-src|data-url|data-zoom-image|data-img-src)=(?:"[^"]*"|'[^']*')/gi, '');
            const url = realSrcMatch[1] || realSrcMatch[2];
            return `<${tag} src="${url}" ${newEl.replace(new RegExp(`^<${tag}\\s*`, 'i'), '')}`;
        }
        if (tag.toLowerCase() === 'img' && /src=(?:"data:image\/[^"]*"|'data:image\/[^']*')/i.test(el)) return '';
        return el;
    });
    
    return cleaned;
}

const finalHtml = cleanArticleMarkup(resultHtml);
const match = finalHtml.match(/<iframe[^>]*>/i);
console.log("Iframe:", match ? match[0] : null);
