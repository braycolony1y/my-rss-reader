const fs = require('fs');
const changes = JSON.parse(fs.readFileSync('index-changes.json', 'utf8'));
let html = fs.readFileSync('/home/ubuntu/my-rss-reader/index.html', 'utf8');

for (let i = 100; i < changes.length; i++) {
    const c = changes[i];
    if (c.type === 'replace_file_content') {
        const target = c.args.TargetContent;
        if (target) {
            if (html.includes(target)) {
                console.log("Found target for change " + i);
            } else {
                console.log("Could NOT find target in change " + i + ": " + c.args.Description);
            }
        }
    }
}
