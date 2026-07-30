const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const articles = typeof db.articles === 'string' ? JSON.parse(db.articles) : (db.articles || []);
const found = articles.filter(a => a.link && a.link.includes('vietnamnet.vn'));
console.log('Vietnamnet articles:', found.length);
if (found.length) {
    console.log(found.slice(0, 3).map(a => a.link));
}
