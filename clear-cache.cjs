const fs = require('fs');
const dbPath = './database.json';
let db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

// Find and remove the vtv article from cache
const cache = JSON.parse(db.articleCache || '{}');
for (let k in cache) {
    if (k.includes('vtv.vn') || k.includes('vnexpress') || k.includes('nhandan') || k.includes('vov.vn')) {
        delete cache[k];
    }
}
db.articleCache = JSON.stringify(cache);
fs.writeFileSync(dbPath, JSON.stringify(db));
console.log("Caches cleared!");
