const fs = require('fs');
const html = fs.readFileSync('test_vnn3_orig.html', 'utf8');
const regex = /<div\b[^>]*class=["'][^"']*related-news[^>]*>([\s\S]*?<\/ul>)\s*<\/div>/gi;
const match = regex.exec(html);
console.log(match ? "Matched!" : "NO MATCH!");
