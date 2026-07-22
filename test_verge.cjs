const fs = require('fs');
const html = fs.readFileSync('verge.html', 'utf8');

let theVergeHtml = '';
const classRegex = new RegExp('<div\\b[^>]*class=["\'][^"\']*duet--article--article-body-component[^"\']*["\'][^>]*>', 'ig');
let startMatch;
while ((startMatch = classRegex.exec(html)) !== null) {
    let index = startMatch.index;
    let tagRegex = /<\/?div\b/ig;
    tagRegex.lastIndex = index + startMatch[0].length;
    let depth = 1;
    let match;
    while ((match = tagRegex.exec(html)) !== null) {
        if (match[0].startsWith('</')) depth--; else depth++;
        if (depth === 0) {
            theVergeHtml += html.substring(index, match.index + match[0].length + 1) + '\n';
            classRegex.lastIndex = match.index + match[0].length;
            break;
        }
    }
}
console.log('EXTRACTED LENGTH:', theVergeHtml.length);
if (theVergeHtml) console.log('FIRST:', theVergeHtml.substring(0, 100));
