import fs from 'fs';
const html = fs.readFileSync('/tmp/vov.html', 'utf8');
const authorMatch = html.match(/<a\b[^>]*href=["']\/author\?[^>]+>([^<]+)<\/a>/i) || 
                    html.match(/<div\b[^>]*class=["'][^"']*article-author[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
const author = authorMatch ? authorMatch[1].replace(/<[^>]+>/g, '').trim() : null;
console.log(author);
