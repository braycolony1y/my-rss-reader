import fs from 'fs';
const html = fs.readFileSync('/tmp/vov.html', 'utf8');
const ogImageMatch = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                                     html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
console.log(ogImageMatch);
