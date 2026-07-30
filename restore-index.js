import fs from 'fs';
const transcript = fs.readFileSync('/home/ubuntu/.gemini/antigravity-cli/brain/b75a5fab-6dfb-47d2-a84c-d50b483a7d79/.system_generated/logs/transcript_full.jsonl', 'utf8');
const lines = transcript.split('\n');
const changes = [];
for (const line of lines) {
    if (!line) continue;
    const obj = JSON.parse(line);
    if (obj.tool_calls) {
        for (const call of obj.tool_calls) {
            if (call.name === 'replace_file_content' || call.name === 'multi_replace_file_content') {
                if (call.args.TargetFile && call.args.TargetFile.includes('index.html')) {
                    changes.push({
                        type: call.name,
                        args: call.args
                    });
                }
            }
        }
    }
}
fs.writeFileSync('index-changes.json', JSON.stringify(changes, null, 2));
console.log("Changes written to index-changes.json", changes.length);
