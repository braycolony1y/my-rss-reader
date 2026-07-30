const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const feeds = typeof db.feeds === 'string' ? JSON.parse(db.feeds) : (db.feeds || []);
console.log('Feeds:', feeds.map(f => f.url));
