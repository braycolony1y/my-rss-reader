const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const articles = typeof db.articles === 'string' ? JSON.parse(db.articles) : (db.articles || []);
const found = articles.filter(a => a.link && a.link.includes('post1317400.vov'));
if (found.length) {
    console.log("Image:", found[0].image);
    console.log("Author:", found[0].author);
}
