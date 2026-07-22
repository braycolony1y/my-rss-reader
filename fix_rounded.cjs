const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

html = html.replace(/rounded-\[16px\]/g, 'rounded-2xl');
html = html.replace(/rounded-\[12px\]/g, 'rounded-xl');
html = html.replace(/rounded-\[8px\]/g, 'rounded-lg');
// Note: we leave rounded-[24px] or 32px for the specific apple parts if they exist, or maybe the user wants EVERYTHING rounded like before. 
// I'll revert rounded-[24px] to rounded-3xl just in case.
html = html.replace(/rounded-\[24px\]/g, 'rounded-3xl');

fs.writeFileSync('index.html', html);
