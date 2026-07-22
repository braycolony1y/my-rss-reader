const fs = require('fs');

const extract = fs.readFileSync('extract_voz_html.js', 'utf8');
const vozSource = fs.readFileSync('src/sources/VozSource.js', 'utf8');

// The extract contains: `if (hostname === 'voz.vn' || hostname.endsWith('.voz.vn')) { \n ...`
// We need to extract the inner block.
const blockMatch = extract.match(/if\s*\(hostname\s*===\s*'voz\.vn'[^\{]+\{([\s\S]*)\}\s*else\s*if\s*\(/);
let innerBlock = '';
if (blockMatch) {
    innerBlock = blockMatch[1];
} else {
    // If there is no else if, just strip the outer brackets
    innerBlock = extract.replace(/^[\s\S]*?\{/, '').replace(/\}\s*$/g, '');
}

// We need to inject this into parseArticleHtmlContent method
let newClass = vozSource.replace(/export default class VozSource \{/, `export default class VozSource {
    parseArticleHtmlContent(html, url, result, utils) {
        let articleHtml = '';
        ${innerBlock}
        return articleHtml;
    }
`);

// Clean up the appended garbage
newClass = newClass.replace(/if\s*\(hostname === 'voz\.vn'[\s\S]*$/, '}');

fs.writeFileSync('src/sources/VozSource.js', newClass);
