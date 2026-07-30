export default class SggpSource {
    match(hostname) {
        return hostname.includes('sggp.org.vn');
    }

    preProcessHtml(html) {
        // SGGP hides videos with style="display:none".
        // We will remove style="display:none". We won't copy data-video-src because it lacks the CDN token. 
        // We will extract it in parseArticleHtmlContent.
        return html.replace(/<video\b([^>]*)>/gi, (match, attrs) => {
            let newAttrs = attrs.replace(/style=["'][^"']*display\s*:\s*none[^"']*["']/gi, '');
            return `<video ${newAttrs}>`;
        });
    }

    parseArticleHtmlContent(html, url, result, utils) {
        // Extract Author
        const authorMatch = html.match(/<div[^>]*class=["'][^"']*article__author[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
        if (authorMatch) {
            result.author = authorMatch[1].replace(/<[^>]+>/g, '').trim();
        }

        // Extract Video from <source> tags which have the valid token
        const videoMatch = html.match(/<video\b[^>]*poster=["']([^"']+)["'][^>]*>\s*<source\b[^>]*src=["']([^"']+)["']/i) ||
                           html.match(/<video\b[^>]*>\s*<source\b[^>]*src=["']([^"']+)["']/i);
        if (videoMatch) {
            result.videos = result.videos || [];
            result.videos.push({
                url: videoMatch[2] || videoMatch[1],
                poster: (videoMatch[2] ? videoMatch[1] : ''),
                title: result.title || ''
            });
            result.videoUrl = videoMatch[2] || videoMatch[1];
            if (videoMatch[2]) result.videoPoster = videoMatch[1];
        }
        
        return false;
    }
}
