import fs from 'fs';
const raw = fs.readFileSync('article_cache/c58ae79c8042806a46b386efb22da9c50763673807627e46103a7678c3853cec.json', 'utf8');
const data = JSON.parse(raw);
const content = data.content || data.result?.content || data.html || '';
const matches = [...content.matchAll(/data-post-index="(\d+)"/g)].map(m => m[1]);
console.log('Cache Post Indexes:', matches.join(', '));
