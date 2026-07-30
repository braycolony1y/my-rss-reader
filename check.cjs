const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const readStates = typeof db.readStates === 'string' ? JSON.parse(db.readStates) : (db.readStates || []);
console.log('ReadStates count:', readStates.length);
if (readStates.length > 0) {
    const lastRead = readStates[readStates.length - 1];
    console.log('Last read link:', lastRead);
    const articles = typeof db.articles === 'string' ? JSON.parse(db.articles) : (db.articles || []);
    const found = articles.find(a => a.link === lastRead);
    console.log('Found in articles:', !!found);
    if (!found) {
        console.log('Checking smartClusters...');
        const smartClusters = typeof db.smartClusters === 'string' ? JSON.parse(db.smartClusters) : (db.smartClusters || []);
        let foundInCluster = false;
        for (const cluster of smartClusters) {
            if (cluster.link === lastRead) foundInCluster = true;
            for (const r of (cluster.relatedArticles || [])) {
                 if (r.link === lastRead) foundInCluster = true;
            }
        }
        console.log('Found in smartClusters:', foundInCluster);
    }
}
