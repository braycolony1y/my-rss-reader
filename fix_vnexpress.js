const fs = require('fs');
let code = fs.readFileSync('src/sources/VnexpressSource.js', 'utf8');

const newLogic = `
        // Check for Podcast standalone page
        const podcastMatch = html.match(/<audio\\b[^>]*playlist=['"]([^'"]+)['"][^>]*>/i);
        if (podcastMatch) {
            try {
                let data = JSON.parse(podcastMatch[1].replace(/&quot;/g, '"'));
                if (Array.isArray(data) && data.length > 0) {
                    data = data[0];
                    if (result) {
                        if (data.author) result.author = data.author;
                    }
                    let tlHtml = '';
                    if (data.timeline) {
                        // timeline is html string with &lt;li&gt;
                        const unescaped = data.timeline.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
                        tlHtml = '<div class="mt-4 bg-gray-50 dark:bg-gray-800 p-4 rounded-lg"><h4 class="font-bold mb-2">Nội dung chính</h4><ul class="list-disc pl-5 space-y-1">' + unescaped + '</ul></div>';
                    }
                    return \`<div class="my-6 p-4 rounded-lg bg-gray-100 dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700">
                        <div class="flex items-start gap-4 mb-4">
                            \${data.thumbnail ? \`<img src="\${data.thumbnail.replace(/&amp;/g, '&')}" class="w-24 h-24 object-cover rounded-md flex-shrink-0" alt="">\` : ''}
                            <div class="flex-1 min-w-0">
                                <h3 class="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2 truncate">\${data.title}</h3>
                                \${data.author ? \`<p class="text-sm text-gray-500 mb-2">Tác giả: \${data.author}</p>\` : ''}
                            </div>
                        </div>
                        <audio controls src="\${data.src}" class="w-full h-12"></audio>
                        \${tlHtml}
                    </div>\`;
                }
            } catch(e) {}
        }
`;

code = code.replace('        if (articleHtml) {', newLogic + '\n        if (articleHtml) {');
fs.writeFileSync('src/sources/VnexpressSource.js', code);
