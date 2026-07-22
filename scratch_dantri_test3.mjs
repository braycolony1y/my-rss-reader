import fs from 'fs';
const html = fs.readFileSync('scratch_dantri_article.html', 'utf8');

function extractBalancedElementById(html, id) {
    const startRegex = new RegExp('<([a-z][a-z0-9-]*)\\b[^>]*id=["\']' + id + '["\'][^>]*>', 'i');
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
        const isSelfClosing = /\\/>$/.test(token[0]);
        if (isClosing) {
            depth--;
            if (depth === 0) return html.slice(contentStart, token.index);
        } else if (!isSelfClosing) {
            depth++;
        }
    }
    return '';
}

const content = extractBalancedElementById(html, 'desktop-in-article');
console.log('length:', content.length);
if (content.length > 0) {
    console.log(content.substring(0, 100));
}
