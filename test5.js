import { fetch } from 'undici';
const html = await (await fetch('https://voz.vn/t/hoi-nhung-nguoi-dang-cho-mua-ps5-pro.1009139/page-3')).text();
const escapedClass = 'message--post';
const startRegex = new RegExp('<(article)\\b[^>]*class=(["\'])[^"\']*\\b' + escapedClass + '\\b[^"\']*\\2[^>]*>', 'gi');
let start;
let idx = 0;
function extractBalancedElementByClass(html, className) {
    const escapedClass = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startRegex = new RegExp('<([a-z][a-z0-9-]*)\\b[^>]*class=(["\'])[^"\']*\\b' + escapedClass + '\\b[^"\']*\\2[^>]*>', 'i');
    const startMatch = startRegex.exec(html);
    if (!startMatch) return null;
    const tagName = startMatch[1];
    const startIdx = startMatch.index;
    const innerIdx = startIdx + startMatch[0].length;
    const tokenRegex = new RegExp('<\\/?' + tagName + '\\b[^>]*>', 'gi');
    tokenRegex.lastIndex = innerIdx;
    let depth = 1, match, endIdx = -1;
    while ((match = tokenRegex.exec(html)) !== null) {
        if (/^<\//.test(match[0])) { depth--; if (depth === 0) { endIdx = match.index; break; } }
        else if (!/\/>$/.test(match[0])) depth++;
    }
    return endIdx !== -1 ? html.substring(innerIdx, endIdx).trim() : null;
}
while ((start = startRegex.exec(html)) !== null) {
    const tagName = start[1];
    const tokenRegex = new RegExp('<\\/?' + tagName + '\\b[^>]*>', 'gi');
    tokenRegex.lastIndex = start.index + start[0].length;
    let depth = 1, token, endTokenIndex = html.length;
    while ((token = tokenRegex.exec(html))) {
        if (/^<\//.test(token[0])) { depth--; if (depth === 0) { endTokenIndex = token.index + token[0].length; break; } }
        else if (!/\/>$/.test(token[0])) depth++;
    }
    const artHtml = html.slice(start.index, endTokenIndex);
    idx++;
    if (idx === 9) {
        let bbContent = extractBalancedElementByClass(artHtml, 'bbWrapper');
        if (bbContent) {
            bbContent = bbContent.replace(/<div\b[^>]*class=["'][^"']*message-lastEdit[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
            bbContent = bbContent.replace(/<div\b[^>]*class=["'][^"']*contentRow-minor[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
            
            // Reorder to strip wrappers FIRST
            bbContent = bbContent.replace(/<div\b[^>]*class=["'][^"']*bbCodeBlock-title[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi, '$1');
            bbContent = bbContent.replace(/<div\b[^>]*class=["'][^"']*bbCodeBlock-expandLink[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi, '');
            
            bbContent = bbContent.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*class=["'][^"']*bbCodeBlock-sourceJump[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi, '<div class="font-semibold text-blue-600 dark:text-blue-400 mb-1">$2</div>');
            
            bbContent = bbContent.replace(/<blockquote\b[^>]*class=["'][^"']*bbCodeBlock--quote[^"']*["'][^>]*>([\s\S]*?)<\/blockquote>/gi, (match, inner) => {
                return `<div class="pl-3 border-l-4 border-amber-400 dark:border-amber-500/50 bg-amber-50 dark:bg-amber-900/10 py-2 pr-3 my-2 rounded-r-lg text-gray-700 dark:text-gray-300 italic">${inner}</div>`;
            });
            console.log(bbContent);
        }
    }
}
