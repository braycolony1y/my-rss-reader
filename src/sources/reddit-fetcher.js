import { execFile } from 'child_process';
import util from 'util';
import path from 'path';
const execFileAsync = util.promisify(execFile);

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function parseRedditJsonToHtml(jsonArray) {
    if (!Array.isArray(jsonArray) || jsonArray.length === 0) return '';
    
    let html = '<div class="reddit-thread">';
    let currentDepth = -1;
    
    const post = jsonArray[0];
    if (post && post.type === 'POST') {
        html += `
        <div class="reddit-post">
            <div class="reddit-post-header flex items-center justify-end mb-2">
                <strong>u/${escapeHtml(post.author)}</strong>
                <span class="reddit-score mx-2 text-gray-700 dark:text-gray-300 font-medium">&uarr; ${post.score}</span>
                <img src="https://ui-avatars.com/api/?name=${escapeHtml(post.author)}&background=random&color=fff&size=48" alt="" class="w-6 h-6 rounded-full inline-block align-middle" onerror="this.style.display='none'">
            </div>
            <div class="reddit-post-body">${escapeHtml(post.text).replace(/\n/g, '<br>')}</div>
        </div>
        <div class="reddit-comments-section">
            <h3>Comments</h3>
        `;
    }
    
    for (let i = 1; i < jsonArray.length; i++) {
        const item = jsonArray[i];
        if (!item || !item.type.startsWith('L')) continue;
        
        const depth = parseInt(item.type.substring(1), 10);
        
        if (depth > currentDepth) {
            html += '<div class="reddit-replies">';
        } else if (depth < currentDepth) {
            html += '</div>'.repeat(currentDepth - depth);
        }
        currentDepth = depth;
        
        html += `
        <div class="reddit-comment" data-depth="${depth}">
            <div class="reddit-comment-header flex items-center justify-end mb-2">
                <strong>u/${escapeHtml(item.author)}</strong>
                <span class="reddit-score mx-2 text-gray-700 dark:text-gray-300 text-sm">&uarr; ${item.score}</span>
                <img src="https://ui-avatars.com/api/?name=${escapeHtml(item.author)}&background=random&color=fff&size=48" alt="" class="w-5 h-5 rounded-full inline-block align-middle" onerror="this.style.display='none'">
            </div>
            <div class="reddit-comment-body">${escapeHtml(item.text).replace(/\n/g, '<br>')}</div>
        </div>
        `;
    }
    
    if (currentDepth >= 0) {
        html += '</div>'.repeat(currentDepth + 1);
    }
    
    html += '</div></div>';
    return html;
}

export async function fetchRedditViaOpenCli(url) {
    const match = url.match(/\/comments\/([a-zA-Z0-9]+)/);
    if (!match) throw new Error("Could not find Reddit post ID in URL");
    const postId = match[1];
    
    const executable = path.resolve('./node_modules/.bin/opencli');
    const { stdout } = await execFileAsync(executable, [
        'reddit', 'read', postId, '-f', 'json'
    ], {
        timeout: 45000,
        maxBuffer: 12 * 1024 * 1024
    });
    
    let jsonArray;
    try {
        const jsonStart = stdout.indexOf('[');
        const jsonEnd = stdout.lastIndexOf(']') + 1;
        const jsonStr = stdout.substring(jsonStart, jsonEnd);
        jsonArray = JSON.parse(jsonStr);
    } catch (e) {
        throw new Error("Failed to parse opencli reddit output as JSON");
    }
    
    const post = jsonArray[0];
    let title = 'Reddit Post';
    if (post) {
        if (post.title) {
            title = post.title;
        } else if (post.text) {
            const firstNewline = post.text.indexOf('\n');
            if (firstNewline > 0) {
                title = post.text.substring(0, firstNewline).trim();
                post.text = post.text.substring(firstNewline).trim();
            } else {
                title = post.text.substring(0, 80) + '...';
            }
        }
    }
    
    const htmlContent = parseRedditJsonToHtml(jsonArray);
    
    return {
        url: url,
        title: title,
        author: post ? post.author : '',
        date: '',
        image: post && post.author ? `https://unavatar.io/reddit/${post.author}` : '',
        siteName: 'reddit.com',
        content: htmlContent,
        readerType: 'forum-post',
        source: 'opencli'
    };
}
