import fs from 'fs';
const lines = fs.readFileSync('/home/ubuntu/.gemini/antigravity-cli/brain/c3422c36-73e6-418e-82b9-c594ee499d60/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
lines.forEach(line => {
    if (line.includes('"type":"USER_INPUT"')) {
        const data = JSON.parse(line);
        console.log('--- USER INPUT ---');
        console.log(data.content);
    }
});
