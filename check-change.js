const fs = require('fs');
const changes = JSON.parse(fs.readFileSync('index-changes.json', 'utf8'));
const c = changes[106];
console.log("Target:\n", c.args.TargetContent.substring(0, 1000));
console.log("\nReplacement:\n", c.args.ReplacementContent.substring(0, 1000));
