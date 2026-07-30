export default class SohaSource {
    match(hostname) {
        return hostname.includes('soha.vn');
    }

    parseArticleHtmlContent(html, url, result, utils) {
        let articleHtml = '';
        const articleBodyMatch = html.match(/<div\b[^>]*class=["'][^"']*detail-body[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*(?:tags|bottom-info|author|tin-lien-quan)[^"']*["']|$)/i);
        
        if (articleBodyMatch) {
            articleHtml = articleBodyMatch[1];
        } else {
            // fallback
            const match = html.match(/<div\b[^>]*class=["'][^"']*detail-body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
            articleHtml = match ? match[1] : html;
        }

        // Clean up unnecessary related links/info if any
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*link-content-footer[^>]*>[\s\S]*?<\/div>/gi, '');
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*VCSortableInPreviewMode[^>]*type=["']RelatedNewsBox["'][^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi, '');
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*relationnews[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, '');
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*gg-news[^>]*>[\s\S]*?<\/div>/gi, '');
        articleHtml = articleHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        articleHtml = articleHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        articleHtml = articleHtml.replace(/<div class="hidden" id="box-thread-detail"[\s\S]*?<\/div>/gi, '');

        // Extract VideoStream
        articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*VCSortableInPreviewMode[^"']*["'][^>]*type=["']VideoStream["'][^>]*>([\s\S]*?)<\/div>(?:(?=<p)|(?=<div)|$)/gi, (match, inner) => {
            const vidMatch = match.match(/data-vid=["']([^"']+)["']/i);
            const thumbMatch = match.match(/data-thumb=["']([^"']+)["']/i);
            if (vidMatch) {
                let vidSrc = vidMatch[1];
                if (!vidSrc.startsWith('http')) vidSrc = 'https://' + vidSrc;
                const poster = thumbMatch ? ` poster="${thumbMatch[1]}"` : '';
                return `
                <div class="video-container my-4">
                    <video controls  loop${poster} class="w-full rounded-lg shadow-lg" style="max-width: 100%;">
                        <source src="${vidSrc}" type="video/mp4">
                        Trình duyệt của bạn không hỗ trợ thẻ video.
                    </video>
                </div>`;
            }
            return match;
        });

        if (result) {
            const authorMatch = html.match(/<meta\b[^>]*property=["']article:author["'][^>]*content=["']([^"']+)["']/i) ||
                                html.match(/<address\b[^>]*data-role=["']author["'][^>]*>([\s\S]*?)<\/address>/i);
            if (authorMatch) {
                result.author = authorMatch[1].replace(/<[^>]+>/g, '').trim();
            }
        }

        return articleHtml;
    }
}
