import fs from 'fs';
let content = fs.readFileSync('index.html', 'utf8');

// The function we want to edit: checkVozNewPostsInBackground
// First find it.
const funcIndex = content.indexOf('checkVozNewPostsInBackground(article) {');
if (funcIndex === -1) {
    console.log("NOT FOUND");
    process.exit(1);
}

console.log("FOUND!");
