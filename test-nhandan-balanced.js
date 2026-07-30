import fs from 'fs';
const html = fs.readFileSync('/tmp/nhandan.html', 'utf8');

function extractBalancedElementByClass(html, className) {
    const escapedClass = String(className).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startRegex = new RegExp('<([a-z][a-z0-9-]*)\\b[^>]*class=(["\'])[^"\']*\\b' + escapedClass + '\\b[^"\']*\\2[^>]*>', 'i');
    const start = startRegex.exec(html);
    if (!start) return '';
    const tagName = start[1];
    const contentStart = start.index + start[0].length;
    const tokenRegex = new RegExp('<\\/?' + tagName + '\\b[^>]*>', 'gi');
    tokenRegex.lastIndex = start.index;
    let depth = 0;
    let token;
    while ((token = tokenRegex.exec(html))) {
        const isClosing = /^<\//.test(token[0]);
        const isSelfClosing = /\/>$/.test(token[0]);
        if (isClosing) {
            depth--;
            if (depth === 0) return html.slice(contentStart, token.index);
        } else if (!isSelfClosing) {
            depth++;
        }
    }
    return '';
}

let res = extractBalancedElementByClass(html, 'detail-content-body') || extractBalancedElementByClass(html, 'article__body') || extractBalancedElementByClass(html, 'detail__body');
console.log("Balanced length:", res.length);
console.log("Ends with:", res.slice(-200));
