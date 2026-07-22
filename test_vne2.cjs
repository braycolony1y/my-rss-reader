const fs = require('fs');
const html = fs.readFileSync('vnexpress_article.html', 'utf8');
const fckMatch = html.match(/<article\b[^>]*class=["'][^"']*fck_detail[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
if(fckMatch) {
  console.log("has video tag in fck_detail?", fckMatch[1].includes('<video'));
  console.log("has wrap-player-popcast?", fckMatch[1].includes('wrap-player-popcast'));
}
