import fs from 'fs';
const file = 'src/tasks/backgroundUpdateTask.js';
let content = fs.readFileSync(file, 'utf8');

// The current logic:
// const imgMatches = [...content.matchAll(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi)];
// We need to only extract from the first post. The first post is from id="voz-post-1" to id="voz-post-2" or the end.

const replaceLogic = `
                        let firstPostContent = content;
                        const post2Index = content.indexOf('id="voz-post-2"');
                        if (post2Index !== -1) {
                            firstPostContent = content.substring(0, post2Index);
                        }
                        const imgMatches = [...firstPostContent.matchAll(/<img\\b[^>]*src=["']([^"']+)["'][^>]*>/gi)];
`;

content = content.replace(/const imgMatches = \[\.\.\.content\.matchAll\(.*\)\];/, replaceLogic.trim());
fs.writeFileSync(file, content);
