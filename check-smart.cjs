const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const smartClusters = typeof db.smartClusters === 'string' ? JSON.parse(db.smartClusters) : (db.smartClusters || []);
console.log('Smart Clusters:', smartClusters.length);

const sohaClusters = smartClusters.filter(c => c.link.includes('soha.vn') || (c.relatedArticles || []).some(r => r.link.includes('soha.vn')));
console.log('Soha in smartClusters:', sohaClusters.length);
if (sohaClusters.length > 0) {
    console.log('Sample soha:', sohaClusters[0].link);
}
