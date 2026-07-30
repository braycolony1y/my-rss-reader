const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const str = JSON.stringify(db);
const match = str.match(/.{0,50}1852607.{0,50}/g);
console.log(match);
