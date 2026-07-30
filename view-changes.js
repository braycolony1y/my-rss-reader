const fs = require('fs');
const changes = JSON.parse(fs.readFileSync('index-changes.json', 'utf8'));
const lastChanges = changes.slice(-10);
lastChanges.forEach((c, i) => {
    console.log(`\n--- Change ${changes.length - 10 + i} (${c.type}) ---`);
    console.log("Description:", c.args.Description);
    console.log("Instruction:", c.args.Instruction);
    if (c.args.ReplacementContent) {
        console.log("Replaced:", c.args.TargetContent.trim().substring(0, 50) + "...");
        console.log("With:", c.args.ReplacementContent.trim().substring(0, 50) + "...");
    }
});
