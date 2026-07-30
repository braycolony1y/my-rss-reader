import fs from 'fs';
const html = fs.readFileSync('/tmp/vov.html', 'utf8');
const authorMatch = html.match(/<div\b[^>]*class=["'][^"']*author[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*([^<]+?)\s*(?:<\/[^>]+>\s*)*<\/div>/i);
console.log(authorMatch ? authorMatch[1].trim() : null);
