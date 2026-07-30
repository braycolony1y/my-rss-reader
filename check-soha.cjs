const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const articles = typeof db.articles === 'string' ? JSON.parse(db.articles) : (db.articles || []);
const soha = articles.filter(a => a.link && a.link.includes('soha.vn'));
console.log('Soha articles:', soha.length);
if (soha.length > 0) {
    console.log('Sample links:', soha.slice(0, 5).map(a => a.link));
}
