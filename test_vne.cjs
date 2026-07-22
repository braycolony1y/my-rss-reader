const fs = require('fs');
const html = fs.readFileSync('vnexpress_article.html', 'utf8');
const fckMatch = html.match(/<article\b[^>]*class=["'][^"']*fck_detail[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
console.log(fckMatch ? fckMatch[1].substring(0, 500) : 'no fck_detail');
