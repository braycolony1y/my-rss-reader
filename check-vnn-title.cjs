const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const articles = typeof db.articles === 'string' ? JSON.parse(db.articles) : (db.articles || []);
const found = articles.filter(a => a.link && a.link.includes('2537956'));
if (found.length) {
    console.log("Title:", found[0].title);
}
