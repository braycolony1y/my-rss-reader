export default class TheVergeSource {
    match(hostname) {
        return hostname === 'theverge.com' || hostname.endsWith('.theverge.com');
    }

    parseArticleHtmlContent(html, url, result) {
        let theVergeHtml = '';
        const classRegex = new RegExp('<div\\b[^>]*class=["\'][^"\']*duet--article--article-body-component[^"\']*["\'][^>]*>', 'ig');
        let startMatch;
        while ((startMatch = classRegex.exec(html)) !== null) {
            let index = startMatch.index;
            let tagRegex = /<\/?div\b/ig;
            tagRegex.lastIndex = index + startMatch[0].length;
            let depth = 1;
            let match;
            while ((match = tagRegex.exec(html)) !== null) {
                if (match[0].startsWith('</')) depth--; else depth++;
                if (depth === 0) {
                    theVergeHtml += html.substring(index, match.index + match[0].length + 1) + '\n';
                    classRegex.lastIndex = match.index + match[0].length;
                    break;
                }
            }
        }
        let articleHtml = '';
        if (theVergeHtml) {
            articleHtml = theVergeHtml;
            // Add Tailwind classes to make The Verge's custom components look decent
            articleHtml = articleHtml.replace(/class=["']([^"']*duet--article--scorecard[^"']*)["']/gi, 'class="$1 bg-gray-100 dark:bg-[#252525] p-6 rounded-2xl shadow-sm my-8 border border-gray-200 dark:border-gray-700"');
            articleHtml = articleHtml.replace(/class=["']([^"']*duet--article--highlight[^"']*)["']/gi, 'class="$1 bg-gray-50 dark:bg-[#2a2a2a] p-6 rounded-xl border border-gray-200 dark:border-gray-700 my-6 shadow-sm"');
            articleHtml = articleHtml.replace(/class=["']([^"']*duet--article--dangerously-set-cms-markup[^"']*)["']/gi, 'class="$1 prose dark:prose-invert max-w-none"');
        } else {
            const articleRegex = /<article\b[^>]*>([\s\S]*?)<\/article>/i;
            const match = html.match(articleRegex);
            if (match) articleHtml = match[1];
        }
        result.siteName = result.siteName || 'The Verge';
        return articleHtml;
    }
}
