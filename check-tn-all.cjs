const fs = require('fs');
const db = JSON.parse(fs.readFileSync('./database.json', 'utf8'));
const str = JSON.stringify(db).toLowerCase();
console.log('Contains thanhnien?', str.includes('thanhnien.vn'));
console.log('Contains 1852607?', str.includes('1852607'));
