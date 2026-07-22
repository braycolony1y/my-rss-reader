const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// 1. Change to 100% opacity
html = html.replace('class="w-full h-full object-cover opacity-90"', 'class="w-full h-full object-cover opacity-100"');

// 2. Remove read time div
const readTimeRegex = /<div class="mt-4 flex items-center gap-1\.5 text-xs text-gray-400 font-medium opacity-80 group-hover:opacity-100 transition-opacity">[\s\S]*?<\/div>/;
html = html.replace(readTimeRegex, '');

fs.writeFileSync('index.html', html);
console.log("Replacements done!");
