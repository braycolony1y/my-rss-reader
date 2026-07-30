const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const articles = typeof db.articles === 'string' ? JSON.parse(db.articles) : (db.articles || []);
const vne = articles.filter(a => a.link && a.link.includes('vnexpress.net'));
console.log('VNE articles:', vne.length);
if (vne.length > 0) {
    console.log('Sample links:', vne.slice(0, 5).map(a => a.link));
}
