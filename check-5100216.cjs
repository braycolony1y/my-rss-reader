const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const articles = typeof db.articles === 'string' ? JSON.parse(db.articles) : (db.articles || []);
const found = articles.filter(a => JSON.stringify(a).includes('5100216'));
console.log('Found:', found.length);
if (found.length) {
    console.log(found[0]);
}
