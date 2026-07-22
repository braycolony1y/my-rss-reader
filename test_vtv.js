import fs from 'fs';

const html = fs.readFileSync('vtv.html', 'utf-8');
const itemRegex = /<article\b[^>]*class=["'][^"']*box-category-item[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;
let itemMatch;
while ((itemMatch = itemRegex.exec(html)) !== null) {
    console.log("Found article:", itemMatch[1]);
}
