const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const clusters = typeof db.smartClusters === 'string' ? JSON.parse(db.smartClusters) : (db.smartClusters || []);
const found = clusters.filter(c => JSON.stringify(c).includes('185260722112835258'));
console.log('Found in smartClusters:', found.length);
if (found.length) {
    console.log(found[0].link);
}
