const fs = require('fs');

function stripHtml(html) {
    if (!html) return '';
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function extractVozPosts(html) {
    if (!html) return [];
    const posts = [];
    
    const postBlocks = html.split('<article class="message message--post');
    postBlocks.shift();

    for (let block of postBlocks) {
        const authorMatch = block.match(/data-author="([^"]+)"/);
        const idMatch = block.match(/id="js-post-(\d+)"/);
        const bodyMatch = block.match(/<article class="message-body[^>]*>([\s\S]*?)<\/article>/);

        if (authorMatch && idMatch && bodyMatch) {
            posts.push({
                number: parseInt(idMatch[1]),
                author: stripHtml(authorMatch[1]).trim(),
                content: stripHtml(bodyMatch[1]).trim()
            });
        }
    }
    
    return posts;
}

const html = fs.readFileSync('/home/ubuntu/.gemini/antigravity-ide/brain/8ef46a79-2b25-4b1b-ad15-4a00805f6b9f/.system_generated/steps/21/content.md', 'utf8');
const posts = extractVozPosts(html);
console.log(posts.slice(0, 2));
console.log("Total posts:", posts.length);
