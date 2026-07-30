import fs from 'fs';
const html = fs.readFileSync('index.html', 'utf8');
const lines = html.split('\n');
const start = 2850;
const end = 3050;

let depth = 0;
for (let i = start - 1; i < end; i++) {
    const line = lines[i];
    let pos = 0;
    while (true) {
        const openIdx = line.indexOf('<div', pos);
        const closeIdx = line.indexOf('</div', pos);
        
        if (openIdx === -1 && closeIdx === -1) break;
        
        if (openIdx !== -1 && (closeIdx === -1 || openIdx < closeIdx)) {
            depth++;
            console.log(`Line ${i + 1}: OPEN (depth ${depth})`);
            pos = openIdx + 4;
        } else if (closeIdx !== -1) {
            console.log(`Line ${i + 1}: CLOSE (depth ${depth})`);
            depth--;
            pos = closeIdx + 5;
        }
    }
}
