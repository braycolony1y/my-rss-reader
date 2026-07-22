const fs = require('fs');
const json = JSON.parse(fs.readFileSync('voz_debug.json', 'utf8'));
fs.writeFileSync('voz_content.html', json.content || '');
fs.writeFileSync('voz_html.html', json.rawHtml || '');
console.log('done');
