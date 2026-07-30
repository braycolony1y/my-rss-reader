const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const articles = typeof db.articles === 'string' ? JSON.parse(db.articles) : (db.articles || []);
const baomoi = articles.filter(a => a.feedTitle && a.feedTitle.toLowerCase().includes('baomoi'));
console.log('BaoMoi articles:', baomoi.length);
if (baomoi.length > 0) {
    console.log('Sample links:', baomoi.slice(0, 5).map(a => a.link));
}
