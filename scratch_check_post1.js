import fs from 'fs';
const raw = fs.readFileSync('article_cache/c58ae79c8042806a46b386efb22da9c50763673807627e46103a7678c3853cec.json', 'utf8');
const data = JSON.parse(raw);
const content = data.content || data.result?.content || data.html || '';

const post1 = content.substring(
    content.indexOf('id="voz-post-1"'),
    content.indexOf('id="voz-post-2"')
);
console.log(post1);
