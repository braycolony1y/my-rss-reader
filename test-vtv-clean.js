import fs from 'fs';
import VtvSource from './src/sources/VtvSource.js';
const html = fs.readFileSync('/tmp/vtv.html', 'utf8');
const source = new VtvSource();
let resultHtml = source.parseArticleHtmlContent(html, 'https://vtv.vn/...', {}, {});

// Simplified cleanArticleMarkup from server.js
function cleanArticleMarkup(markup) {
    let cleaned = String(markup || '');
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
    cleaned = cleaned.replace(/<(?:script|style|template|nav|aside|form|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|template|nav|aside|form|noscript)>/gi, '');
    
    const noisePattern = /<(div|section|footer|header|ul|aside)\b[^>]*(?:class|id|data-module|role)=(["\'])[^"\']*(?:advert|adsbygoogle|ad-container|breadcrumb|pagination|related|recommend|share|social|reaction|signature|message-user|message-attribution|message-footer|message-cell--user|post-meta|author-box|author-info|singular-author|user-info|user-panel|member-header|comment-list|comments-area|newsletter|subscribe|topic-list|trending|popular-post|read-more|tags-list|article__tags|author-area|menu-area|menu-container|action-bar|thread-action|thread-editor|relate-news|box-topic|tinlienquan|knc-relate|box-relate|zone-interlink|article-audio|tts-player|dt-size-6|detail-comment|box-comment|box-bottom|cmbl|detail-tab|admzone|link-source-detail)[^"\']*\2[^>]*>[\s\S]*?<\/\1>/gi;
    for (let i = 0; i < 5; i++) cleaned = cleaned.replace(noisePattern, '');

    return cleaned;
}

const cleanedHtml = cleanArticleMarkup(resultHtml);
console.log("Before clean:", resultHtml.includes('Tây Ban Nha đăng quang'));
console.log("After clean:", cleanedHtml.includes('Tây Ban Nha đăng quang'));
