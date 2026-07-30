const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const readStates = typeof db.readStates === 'string' ? JSON.parse(db.readStates) : (db.readStates || []);
const gnews = readStates.filter(l => l.includes('news.google.com'));
console.log('Google news in readStates:', gnews.length);
if (gnews.length > 0) {
    console.log(gnews.slice(0, 5));
}
