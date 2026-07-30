const fs = require('fs');
const db = JSON.parse(fs.readFileSync('.rss_data/rss-data.json', 'utf8'));
const readStates = db.readStates || [];
console.log('Last read link:', readStates[readStates.length - 1]);
const articles = db.articles || [];
const found = articles.find(a => a.link === readStates[readStates.length - 1]);
console.log('Found in articles:', !!found);
