export default class NytSource {
    match(hostname) {
        return hostname.includes('nytimes.com');
    }

    async getBestImage(targetUrl, fetchFn, rssFallback, { extractImageFromHtml, fetchWithCookies, isInvalidImage, CF_PROXY_BASE }) {
        if (rssFallback && !isInvalidImage(rssFallback)) return rssFallback;
        return null; // Will fallback to what article-extractor gets
    }

    preProcessHtml(html) {
        // Fix images
        let cleanedHtml = html;
        const pictureSources = [...cleanedHtml.matchAll(/<source[^>]*srcset=["']([^"']+)["'][^>]*>/gi)];
        for (const m of pictureSources) {
            const srcset = m[1];
            const bestImage = srcset.split(',').pop().trim().split(' ')[0];
            if (bestImage) {
                // Find parent picture and inject img
                // But extractArticle handles srcset sometimes. We just ensure there's an img.
            }
        }

        // Clean unnecessary info
        cleanedHtml = cleanedHtml.replace(/<div[^>]*class=["'][^"']*BottomAd[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
        return cleanedHtml;
    }

    async parseArticleHtmlContent(html, url, result, utils) {
        // Find listen to article audio
        // Often NYT uses <audio src="..."> or embedded json
        const audioMatch = html.match(/<audio[^>]*src=["']([^"']+\.mp3)["']/i) || html.match(/"url":"([^"]+\.mp3)"/i);
        if (audioMatch && audioMatch[1]) {
            html = `<figure><audio controls src="${audioMatch[1]}" style="width: 100%;"></audio></figure>` + html;
        }

        return html;
    }
}
