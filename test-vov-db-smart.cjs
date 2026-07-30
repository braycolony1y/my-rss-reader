const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const clusters = typeof db.smartClusters === 'string' ? JSON.parse(db.smartClusters) : (db.smartClusters || []);
const found = clusters.filter(c => JSON.stringify(c).includes('post1317400.vov'));
if (found.length) {
    console.log("Found in smartClusters!");
    console.log("Image:", found[0].image);
    console.log("Author:", found[0].author);
} else {
    console.log("Not in smartClusters either!");
}
