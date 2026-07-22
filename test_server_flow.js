import fetch from 'node-fetch';
import sourceRegistry from './src/sources/index.js';

function cleanArticleMarkup(markup) {
    if (!markup) return '';
    const noisePattern = /class=["'][^"']*(?:advertisement|qc-|quangcao|banner|sponsored|promo|tracking|share|social|author-box|related|suggest|relate)[^"']*["']/i;
    let containerMatch;
    while ((containerMatch = markup.match(/<(div|section|aside|ul|li)\b[^>]*>/i)) !== null) {
        const startIdx = containerMatch.index;
        const tag = containerMatch[1];
        if (noisePattern.test(containerMatch[0])) {
            let depth = 1;
            let endIdx = startIdx + containerMatch[0].length;
            const regex = new RegExp(`<\/?${tag}\\b`, 'gi');
            regex.lastIndex = endIdx;
            let match;
            while ((match = regex.exec(markup)) !== null) {
                if (match[0].startsWith('</')) depth--;
                else depth++;
                if (depth === 0) {
                    endIdx = regex.lastIndex;
                    break;
                }
            }
            if (depth === 0) {
                markup = markup.slice(0, startIdx) + markup.slice(endIdx);
                continue;
            } else {
                markup = markup.replace(containerMatch[0], '');
                continue;
            }
        }
        markup = markup.replace(containerMatch[0], containerMatch[0].replace(/class=["'][^"']*["']/, ''));
    }
    return markup;
}

async function testUrl(url) {
    console.log("Testing:", url);
    const html = await (await fetch(url)).text();
    let sourceHandler = sourceRegistry.getHandler(url);
    const fetchWithTimeout = (url, options, timeout) => fetch(url, options);
    let newHtml = html;
    if (sourceHandler && sourceHandler.preProcessHtml) {
        newHtml = await sourceHandler.preProcessHtml(html, { fetchWithTimeout });
    }
    const result = { url };
    
    let isCustomSource = false;
    let articleHtml = '';
    if (sourceHandler && sourceHandler.parseArticleHtmlContent) {
        const parsedContent = sourceHandler.parseArticleHtmlContent(newHtml, url, result, { fetchWithTimeout });
        articleHtml = parsedContent instanceof Promise ? await parsedContent : parsedContent;
        isCustomSource = true;
    }
    
    console.log("isCustomSource:", isCustomSource);
    
    if (!isCustomSource) {
        articleHtml = cleanArticleMarkup(articleHtml);
    } else {
        articleHtml = articleHtml.replace(/<(?:script|style|template|nav|form|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|template|nav|form|noscript)>/gi, '');
    }
    console.log("HAS RELATED:", articleHtml.includes('BÀI VIẾT LIÊN QUAN') || articleHtml.includes('TIN LIÊN QUAN') || articleHtml.includes('embedded-suggested-articles'));
    console.log("AUTHOR:", result.author);
}

testUrl('https://thanhnien.vn/thu-tuong-va-hoang-gia-tay-ban-nha-du-chung-ket-so-19-ket-noi-messi-yamal-185260717185916662.htm');
testUrl('https://vietnamnet.vn/hi-huu-2-phu-nu-di-nham-xe-may-ve-nha-2536602.html');
