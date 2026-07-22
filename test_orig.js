const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');
console.log(content.substring(content.indexOf('result.siteName = result.siteName || \\'Tinh tế\\';') - 100, content.indexOf('result.siteName = result.siteName || \\'Tinh tế\\';') + 500));
