function getHtmlAttribute(tag, name) {
    const match = String(tag || '').match(
        new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
    );
    return match ? (match[1] || match[2] || match[3] || '') : '';
}

function resolveMediaUrl(value, pageUrl) {
    try {
        const parsed = new URL(String(value || ''), pageUrl);
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch (e) {
        return '';
    }
}

export function extractTienPhongPrimaryVideo(html, pageUrl) {
    const source = String(html || '');
    const videoElement = source.match(/<video\b([^>]*)>([\s\S]{0,12000}?)<\/video>/i);
    const sourceTag = videoElement?.[2]?.match(/<source\b[^>]*>/i)?.[0] || '';
    let url = resolveMediaUrl(getHtmlAttribute(sourceTag, 'src'), pageUrl);
    let poster = resolveMediaUrl(getHtmlAttribute(videoElement?.[0], 'poster'), pageUrl);
    let title = '';

    if (!url) {
        const jsonBlocks = source.match(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || [];
        for (const block of jsonBlocks) {
            try {
                const parsed = JSON.parse(
                    block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim()
                );
                const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
                while (queue.length) {
                    const schema = queue.shift();
                    if (!schema || typeof schema !== 'object') continue;
                    const types = Array.isArray(schema['@type']) ? schema['@type'] : [schema['@type']];
                    if (types.includes('VideoObject')) {
                        const rawUrl = Array.isArray(schema.contentUrl) ? schema.contentUrl[0] : schema.contentUrl;
                        url = resolveMediaUrl(rawUrl || schema.encoding?.contentUrl, pageUrl);
                        const rawPoster = Array.isArray(schema.thumbnailUrl) ? schema.thumbnailUrl[0] : schema.thumbnailUrl;
                        poster ||= resolveMediaUrl(rawPoster || schema.image?.url, pageUrl);
                        title = String(schema.name || schema.headline || '').trim();
                        break;
                    }
                    for (const value of Object.values(schema)) {
                        if (Array.isArray(value)) queue.push(...value.filter(item => item && typeof item === 'object'));
                        else if (value && typeof value === 'object') queue.push(value);
                    }
                }
            } catch (e) { }
            if (url) break;
        }
    }

    if (!url || !/\.(?:m3u8|mp4|webm|ogg)(?:$|[?#])/i.test(url)) return null;
    return { url, poster, title };
}

export default class TienPhongSource {
    match(hostname) {
        return hostname.includes('tienphong.vn');
    }

    parseArticleHtmlContent(html, url, result, utils) {
        // Extract Author
        const author = [
            html.match(/<div[^>]*class=["'][^"']*author[^"']*["'][^>]*>[\s\S]*?<\/span>([^<]+)/i),
            html.match(/class=["']article__author["'][^>]*>\s*<span[^>]*>[\s\S]*?<\/span>\s*([^<]+)<\/div>/i),
            html.match(/<span[^>]*class=["'][^"']*name[^"']*["'][^>]*>([^<]+)<\/span>/i)
        ].map(match => match?.[1]?.trim()).find(Boolean);
        if (author) result.author = author;

        const primaryVideo = extractTienPhongPrimaryVideo(html, url);
        const isShortVideoArticle = /\bshortvideo-detail\b|class=["'][^"']*short-video-wrapper/i.test(html);
        if (isShortVideoArticle && primaryVideo) {
            result.videos = [primaryVideo];
            result.videoUrl = primaryVideo.url;
            result.videoPoster = primaryVideo.poster;

            const poster = primaryVideo.poster
                ? ` poster="${utils.escapeHtml(primaryVideo.poster)}"`
                : '';
            const label = primaryVideo.title || result.title || 'Tiền Phong video';
            return `<div class="tp-video-article"><video controls playsinline preload="metadata"${poster} aria-label="${utils.escapeHtml(label)}" src="${utils.escapeHtml(primaryVideo.url)}">Your browser does not support HTML5 video.</video></div>`;
        }

        let articleHtml = '';
        const articleBodyMatch = html.match(/<div\b[^>]*class=["'][^"']*(?:article__body|cms-body)[^"']*["'][^>]*>([\s\S]*?)<div\b[^>]*class=["'][^"']*(?:article-footer|article__tag)/i) || 
                                 html.match(/<div\b[^>]*class=["'][^"']*(?:article__body|cms-body)[^"']*["'][^>]*>([\s\S]*?)(?:<footer|<\/main>|<div\b[^>]*id=["']sdaWeb_)/i) ||
                                 html.match(/<div\b[^>]*class=["'][^"']*(?:article__body|cms-body)[^"']*["'][^>]*>([\s\S]*)/i);
        if (articleBodyMatch) {
            articleHtml = articleBodyMatch[1] || articleBodyMatch[2] || articleBodyMatch[3] || '';
        } else {
            return false; // Fall back to safe generic parser
        }

        const sapoMatch = html.match(/<div\b[^>]*class=["'][^"']*article__sapo[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
        if (sapoMatch && articleHtml && !articleHtml.includes(sapoMatch[1].trim().slice(0, 30))) {
            articleHtml = `<p class="article-sapo font-semibold text-lg mb-4 text-gray-800 dark:text-gray-200 leading-relaxed">${sapoMatch[1].trim()}</p>\n` + articleHtml;
        }

        if (articleHtml) {
            // Remove banners/ads (class="rennab")
            articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*rennab[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');

            // Remove header, title, meta blocks which break the reader style
            articleHtml = articleHtml.replace(/<h1\b[^>]*class=["'][^"']*article__title[^"']*["'][^>]*>[\s\S]*?<\/h1>/gi, '');
            articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*article__header[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, '');
            articleHtml = articleHtml.replace(/<div\b[^>]*class=["'][^"']*article__meta[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, '');

            // In-article relate (article-relate or article__relate)
            const articleRelateRegex = /<div\b[^>]*class=["'][^"']*article[-_]relate[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>\s*<\/div>)?/gi;
            articleHtml = articleHtml.replace(articleRelateRegex, (m, inner) => {
                let relatedListHtml = `<div class="tp-related-articles bg-gray-50 dark:bg-gray-800 p-4 rounded-xl my-4 border border-gray-200 dark:border-gray-700"><ul>`;
                const relateRegex = /<article\b[^>]*class=["'][^"']*story[^>]*>([\s\S]*?)<\/article>/gi;
                let newsMatch;
                let found = false;
                while ((newsMatch = relateRegex.exec(inner)) !== null) {
                    found = true;
                    const innerArticle = newsMatch[1];
                    const linkMatch = innerArticle.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']+)["']/i);
                    if (linkMatch) {
                        const relUrl = linkMatch[1];
                        const relTitle = linkMatch[2].replace(/<[^>]+>/g, '').trim();
                        const absUrl = relUrl.startsWith('/') ? new URL(relUrl, url).href : relUrl;
                        relatedListHtml += `<li class="mb-2"><a href="${absUrl}" class="font-semibold text-blue-600 dark:text-blue-400 hover:underline">${relTitle}</a></li>`;
                    }
                }
                relatedListHtml += `</ul></div>`;
                return found ? relatedListHtml : m;
            });
        }
        
        // Find trailing related-news block
        const relatedNewsRegex = /<div\b[^>]*class=["'][^"']*related-news[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
        let trailingHtml = '';
        html.replace(relatedNewsRegex, (m) => {
            let relatedListHtml = `<div class="tp-related-news bg-blue-50 dark:bg-blue-900/30 p-4 rounded-xl my-4 border border-blue-100 dark:border-blue-800/50">
                <h3 class="font-bold text-lg mb-2 text-blue-800 dark:text-blue-300">Xem thêm</h3><ul>`;
            const relateRegex = /<article\b[^>]*class=["'][^"']*story[^>]*>([\s\S]*?)<\/article>/gi;
            let newsMatch;
            let found = false;
            while ((newsMatch = relateRegex.exec(m)) !== null) {
                found = true;
                const inner = newsMatch[1];
                const linkMatch = inner.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']+)["']/i);
                if (linkMatch) {
                    const relUrl = linkMatch[1];
                    const relTitle = linkMatch[2].replace(/<[^>]+>/g, '').trim();
                    const absUrl = relUrl.startsWith('/') ? new URL(relUrl, url).href : relUrl;
                    relatedListHtml += `<li class="mb-2"><a href="${absUrl}" class="font-semibold text-blue-600 dark:text-blue-400 hover:underline">${relTitle}</a></li>`;
                }
            }
            relatedListHtml += `</ul></div>`;
            if (found) trailingHtml += relatedListHtml;
        });
        
        if (trailingHtml) {
            articleHtml += trailingHtml;
        }

        return articleHtml;
    }

    parseJinaReaderText(markdown) {
        const primaryVideo = String(markdown || '').match(
            /^\s*\[Video\s+\d+\]\((https?:\/\/[^)\s]+\.(?:m3u8|mp4|webm|ogg)(?:[?#][^)\s]*)?)\)\s*$/im
        );
        if (!primaryVideo) return null;
        return {
            markdown: primaryVideo[0].trim(),
            readerType: 'video-article'
        };
    }
}
