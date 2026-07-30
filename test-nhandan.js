import fs from 'fs';
const html = fs.readFileSync('/tmp/nhandan.html', 'utf8');
const articleRegex = /<div\b[^>]*class=["'][^"']*(?:detail-content-body|article__body|detail__body)[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*related-news|<\/div>\s*<\/div>\s*<\/div>|<\/article>)/i;
let match = html.match(articleRegex);
if (!match) {
    match = html.match(/<div\b[^>]*class=["'][^"']*(?:detail-content-body|article__body|detail__body)[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*related-news|<\/div>\s*<\/div>\s*<\/div>|<\/article>)/i);
}
if (match) {
    console.log("Matched length:", match[1].length);
    console.log("Ends with:", match[1].slice(-200));
}
