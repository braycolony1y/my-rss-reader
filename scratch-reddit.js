const { execFile } = require('child_process');
const util = require('util');
const path = require('path');
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
    
    // First element is usually the POST
    const post = jsonArray[0];
    if (post && post.type === 'POST') {
        html += `
        <div class="reddit-post">
            <div class="reddit-post-header">
                <strong>u/${escapeHtml(post.author)}</strong>
                <span class="reddit-score">&uarr; ${post.score}</span>
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
        
        // Handle nesting
        if (depth > currentDepth) {
            html += '<div class="reddit-replies">';
        } else if (depth < currentDepth) {
            html += '</div>'.repeat(currentDepth - depth);
        }
        currentDepth = depth;
        
        html += `
        <div class="reddit-comment" data-depth="${depth}">
            <div class="reddit-comment-header">
                <strong>u/${escapeHtml(item.author)}</strong>
                <span class="reddit-score">&uarr; ${item.score}</span>
            </div>
            <div class="reddit-comment-body">${escapeHtml(item.text).replace(/\n/g, '<br>')}</div>
        </div>
        `;
    }
    
    // Close remaining replies
    if (currentDepth >= 0) {
        html += '</div>'.repeat(currentDepth + 1);
    }
    
    html += '</div></div>';
    return html;
}

async function fetchRedditViaOpenCli(url) {
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
    
    // Try to parse the stdout json
    let jsonArray;
    try {
        const jsonStart = stdout.indexOf('[');
        const jsonEnd = stdout.lastIndexOf(']') + 1;
        const jsonStr = stdout.substring(jsonStart, jsonEnd);
        jsonArray = JSON.parse(jsonStr);
    } catch (e) {
        throw new Error("Failed to parse opencli reddit output as JSON");
    }
    
    const htmlContent = parseRedditJsonToHtml(jsonArray);
    
    const post = jsonArray[0];
    
    return {
        url: url,
        title: post && post.title ? post.title : 'Reddit Post', // Need to see if title is returned in the API
        author: post ? post.author : '',
        date: '',
        image: '',
        siteName: 'reddit.com',
        content: htmlContent,
        readerType: 'forum-post',
        source: 'opencli-reddit'
    };
}

fetchRedditViaOpenCli('https://www.reddit.com/r/FuturesTrading/comments/1v8el2s/what_is_your_favorite_time_frame_chart_for/').then(r => console.log(r)).catch(e => console.error(e));
