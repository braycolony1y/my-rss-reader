const fs = require('fs');
const html = fs.readFileSync('vnexpress_article.html', 'utf8');
const fckMatch = html.match(/<article\b[^>]*class=["'][^"']*fck_detail[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
if(fckMatch) {
  const text = fckMatch[1];
  const lines = text.split('\n');
  console.log(lines.slice(-20).join('\n'));
}
