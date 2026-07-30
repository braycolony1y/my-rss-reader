import fs from 'fs';
const html = fs.readFileSync('/tmp/tuoitre.html', 'utf8');

const historyMatch = html.match(/<div\b[^>]*class=["'][^"']*detail__history[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|div\s+class=["']view-more)/i);
if (historyMatch) {
    const titleBoxMatch = historyMatch[1].match(/<h2\b[^>]*class=["']title-box["'][^>]*>([\s\S]*?)<\/h2>/i);
    if (titleBoxMatch) {
        console.log("Found:", titleBoxMatch[1]);
    } else {
        console.log("No title-box");
    }
} else {
    console.log("No historyMatch");
}
