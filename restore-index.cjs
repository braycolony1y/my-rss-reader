const fs = require('fs');
const changes = JSON.parse(fs.readFileSync('index-changes.json', 'utf8'));
let html = fs.readFileSync('/home/ubuntu/my-rss-reader/index.html', 'utf8');

for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    if (c.type === 'replace_file_content') {
        const target = c.args.TargetContent;
        const repl = c.args.ReplacementContent;
        if (target && repl) {
            if (html.includes(target)) {
                html = html.replace(target, repl);
            } else {
                console.log("Could not find target in change " + i + ": " + c.args.Description);
            }
        }
    } else if (c.type === 'multi_replace_file_content') {
        const chunks = c.args.ReplacementChunks;
        for (let j = 0; j < chunks.length; j++) {
            const chunk = chunks[j];
            const target = chunk.TargetContent;
            const repl = chunk.ReplacementContent;
            if (html.includes(target)) {
                html = html.replace(target, repl);
            } else {
                console.log("Could not find target in multi chunk " + j + " of change " + i);
            }
        }
    }
}

fs.writeFileSync('/home/ubuntu/my-rss-reader/index.html', html);
console.log("Restored!");
