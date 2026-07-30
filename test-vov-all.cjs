const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const str = JSON.stringify(db);
const match = str.match(/.{0,50}1317400.{0,50}/g);
console.log(match);
