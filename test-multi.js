const fs = require('fs');
const changes = JSON.parse(fs.readFileSync('index-changes.json', 'utf8'));
const multi = changes.filter(c => c.type === 'multi_replace_file_content');
console.log("Multi count:", multi.length);
