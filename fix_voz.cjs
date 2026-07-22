const fs = require('fs');
const extract = fs.readFileSync('extract_voz_html.js', 'utf8');

// The extract contains: `if (hostname === 'voz.vn' || hostname.endsWith('.voz.vn')) { \n ...`
// We need to extract the inner block.
const blockMatch = extract.match(/if\s*\(hostname\s*===\s*'voz\.vn'[^\{]+\{([\s\S]*?)\}\s*else\s*if\s*\(/);
let innerBlock = '';
if (blockMatch) {
    innerBlock = blockMatch[1];
}

const cleanVozSource = `export default class VozSource {
    match(hostname) {
        return hostname === 'voz.vn' || hostname.endsWith('.voz.vn');
    }

    cleanUrl(urlObj) {
        if (urlObj.pathname.startsWith('/t/')) {
            let path = urlObj.pathname.replace(/\\/unread\\/?$/, '').replace(/\\/$/, '');
            path = path.replace(/\\/page-\\d+/i, '');
            return urlObj.origin + path + '/unread';
        }
        return null;
    }

    parseJinaReaderText(markdown) {
        const firstPostMarker = markdown.match(/(?:^|\\n)\\s*\\*?\\s*\\[#1\\]\\([^\\n)]+\\)\\s*\\n+/m);
        if (firstPostMarker) {
            const bodyStart = (firstPostMarker.index || 0) + firstPostMarker[0].length;
            let body = markdown.slice(bodyStart);
            const endPatterns = [
                /\\n_via\\s+/i,
                /\\n\\*\\s+!\\[[^\\]]*(?:Ưng|reaction)/i,
                /\\nReactions?:/i,
                /\\n\\[!\\[Image[^\\]]*\\]\\(https?:\\/\\/[^)]+\\/avatars\\//i
            ];
            const ends = endPatterns.map(pattern => body.search(pattern)).filter(index => index >= 0);
            if (ends.length) body = body.slice(0, Math.min(...ends));
            if (body.trim()) {
                return {
                    markdown: body.trim(),
                    readerType: 'forum-post'
                };
            }
        }
        return null;
    }

    parseArticleHtmlContent(html, url, result, utils) {
        let articleHtml = '';
        ${innerBlock}
        return articleHtml;
    }
}
`;

fs.writeFileSync('src/sources/VozSource.js', cleanVozSource);
