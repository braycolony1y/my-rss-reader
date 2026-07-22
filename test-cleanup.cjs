const fs = require('fs');
const html = fs.readFileSync('test_vnn3_orig.html', 'utf8');
const wikiRegex = /<article\b[^>]*class=["'][^"']*ck-cms-wiki-news-full[^>]*>([\s\S]*?)<\/article>/gi;
const result = html.replace(wikiRegex, '');
console.log("Length before:", html.length, "Length after:", result.length);
