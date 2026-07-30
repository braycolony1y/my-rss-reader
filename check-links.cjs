const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const articles = typeof db.articles === 'string' ? JSON.parse(db.articles) : (db.articles || []);
const soha = articles.filter(a => a.link && a.link.includes('soha.vn'));
console.log('Soha link:', soha.length);
const sohaUrl = articles.filter(a => a.url && a.url.includes('soha.vn'));
console.log('Soha url:', sohaUrl.length);
