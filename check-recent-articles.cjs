const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const articles = typeof db.articles === 'string' ? JSON.parse(db.articles) : (db.articles || []);
console.log('Top 10 articles:');
for (const a of articles.slice(0, 10)) {
    console.log(a.link, a.isManualContent);
}
