const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const articles = typeof db.articles === 'string' ? JSON.parse(db.articles) : (db.articles || []);
const baomoi = articles.filter(a => a.feedUrl === 'https://baomoi.com/');
console.log('Baomoi feed articles:', baomoi.length);
if (baomoi.length > 0) {
    console.log(baomoi.slice(0, 3));
}
