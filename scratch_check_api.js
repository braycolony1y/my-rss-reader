import fs from 'fs';
const serverJs = fs.readFileSync('server.js', 'utf8');
const lines = serverJs.split('\n');
const start = lines.findIndex(l => l.includes('app.get(\'/api/article-content\''));
const end = lines.findIndex((l, i) => i > start && l.startsWith('});'));
console.log(lines.slice(start, start + 30).join('\n'));
