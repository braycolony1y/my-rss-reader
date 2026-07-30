const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
console.log('Blocked:', db.blockedArticleKeywords);
