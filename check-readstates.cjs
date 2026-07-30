const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const readStates = typeof db.readStates === 'string' ? JSON.parse(db.readStates) : (db.readStates || []);
const found = readStates.find(l => l.includes('198260722084520983'));
console.log('Found in readStates:', found);
