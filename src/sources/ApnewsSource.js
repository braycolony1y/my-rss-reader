export default class ApnewsSource {
    match(hostname) {
        return hostname.includes('apnews.com');
    }
    
    async getBestImage(targetUrl, fetchFn, rssFallback, { extractImageFromHtml, fetchWithCookies, isInvalidImage, CF_PROXY_BASE }) {
        if (rssFallback && !isInvalidImage(rssFallback)) return rssFallback;
        try {
            const res = await fetchFn(CF_PROXY_BASE + encodeURIComponent(targetUrl));
            if (res.ok) {
                const html = await res.text();
                const ogMatch = html.match(/<meta property=["']og:image["'] content=["']([^"']+)["']/i);
                if (ogMatch && !isInvalidImage(ogMatch[1])) return ogMatch[1];
                return extractImageFromHtml(html, targetUrl);
            }
        } catch (e) {}
        return null;
    }

    preProcessHtml(html) {
        // Extract videos
        let videosHtml = '';
        const videoJsonMatch = html.match(/<script type="application\/ld\+json" id="video-ld-json">([\s\S]*?)<\/script>/);
        if (videoJsonMatch) {
            try {
                const videoData = JSON.parse(videoJsonMatch[1]);
                const list = Array.isArray(videoData.list) ? videoData.list : (Array.isArray(videoData) ? videoData : [videoData]);
                for (const v of list) {
                    if (v.contentUrl) {
                        videosHtml += `<figure><video controls src="${v.contentUrl}" style="width: 100%; max-width: 100%; height: auto;"></video></figure>`;
                    }
                }
            } catch (e) {}
        }
        
        // Remove apnews dims wrapper from images before processing
        let cleanedHtml = html;
        const originalImages = [...cleanedHtml.matchAll(/<img[^>]*src=["']https:\/\/dims\.apnews\.com[^"']*url=([^"'&]+)[^"']*["'][^>]*>/gi)];
        for (const m of originalImages) {
            const originalUrl = decodeURIComponent(m[1]);
            cleanedHtml = cleanedHtml.replace(m[0], m[0].replace(m[0].match(/src=["']([^"']+)["']/)[1], originalUrl));
        }

        if (videosHtml) {
            // Prepend video before the article body or main content
            cleanedHtml = cleanedHtml.replace(/<div[^>]*class=["'][^"']*(?:ArticleBody|RichText)[^"']*["'][^>]*>/i, match => match + videosHtml);
        }
        return cleanedHtml;
    }

    async parseArticleHtmlContent(html, url, result, utils) {
        // Fix author
        const authorJsonMatch = html.match(/"author":\[{"@context":"[^"]+","@type":"Person","description":"[^"]+","image":{[^}]+},"name":"([^"]+)"/);
        if (authorJsonMatch && authorJsonMatch[1]) result.author = authorJsonMatch[1].trim();

        // Check time in ld+json
        const dateMatch = html.match(/"datePublished":"([^"]+)"/);
        if (dateMatch) result.published = dateMatch[1];

        return false;
    }
}
