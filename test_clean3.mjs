import fs from 'fs';
const html = fs.readFileSync('verge.html', 'utf8');
const match = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
let cleaned = match[1];

cleaned = cleaned.split(/<div[^>]*class=["'][^"']*(?:thread-comment|comment-list|bdPostTree|replies|comments-area)[^"']*["']/i)[0];
cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
cleaned = cleaned.replace(/<(?:script|style|template|nav|aside|form|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|template|nav|aside|form|noscript)>/gi, '');

const noisePattern = /<(div|section|footer|header|ul|aside)\b[^>]*(?:class|id|data-module|role)=(["\'])[^"\']*(?:advert|adsbygoogle|ad-container|breadcrumb|pagination|related|recommend|share|social|reaction|signature|message-user|message-attribution|message-footer|message-cell--user|post-meta|author-box|author-info|singular-author|user-info|user-panel|member-header|comment-list|comments-area|newsletter|subscribe|topic-list|trending|popular-post|read-more|tags-list|article__tags|author-area|menu-area|menu-container|action-bar|thread-action|thread-editor|relate-news|box-topic|tinlienquan|knc-relate|box-relate|zone-interlink|article-audio|tts-player|dt-size-6|detail-comment|box-comment|box-bottom|cmbl|detail-tab|admzone|link-source-detail)[^"\']*\2[^>]*>[\s\S]*?<\/\1>/gi;
for (let i = 0; i < 5; i++) cleaned = cleaned.replace(noisePattern, '');
cleaned = cleaned.replace(/<(?:button)\b[^>]*>[\s\S]*?<\/(?:button)>/gi, '');

function trimArticleMarkupAtSemanticBoundary(markup) {
    const source = String(markup || '');
    const boundaryPattern = /<(?:p|h[1-6]|div|section|ul|li)\b[^>]*>[\s\S]{0,350}?(?:Đọc tiếp\s*Về trang Chủ đề|Tặng sao cho bài viết hay|Đừng bỏ lỡ|Advertisements|(?:Trở lại|Quay lại)\s+[\p{L}\s]{2,50}|(?:Bình luận|Comments)\s*\(\s*\d+\s*\)|Tin liên quan|Related stories|You may also like|Recommended for you|More stories|Read next|Tuổi Trẻ Online Newsletters|Thêm\s+[^\n<]{1,80}\s+trên Google|Chọn\s+[^\n<]{1,80}\s+làm nguồn ưu tiên|Chủ đề liên quan|Xem thêm:|\bTIN LIÊN QUAN\b|\bCHỦ ĐỀ LIÊN QUAN\b|Link bài gốc)[\s\S]{0,350}?<\/(?:p|h[1-6]|div|section|ul|li)>/giu;
    const candidates = [...source.matchAll(boundaryPattern)]
        .map(match => match.index || 0)
        .filter(index => source.slice(0, index).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim().length >= Math.max(250, Math.min(800, Math.floor(source.length * 0.25))));
    if (candidates.length) return source.slice(0, Math.min(...candidates));
    const rawPattern = /(?:Đọc tiếp\s*Về trang Chủ đề|Tặng sao cho bài viết hay|Tuổi Trẻ Online Newsletters|\bTin liên quan\b|\bChủ đề liên quan\b|\bTIN LIÊN QUAN\b|\bCHỦ ĐỀ LIÊN QUAN\b|\bXem thêm:\b|\bBài liên quan\b|Link bài gốc)(?:\s*(?:<[^>]+>|\s|[\p{L}\d\-,.!"'?:();/]){1,1000})?$/iu;
    const rawMatch = rawPattern.exec(source);
    if (rawMatch && rawMatch.index > 250) return source.slice(0, rawMatch.index);
    return source;
}
cleaned = trimArticleMarkupAtSemanticBoundary(cleaned);
console.log('LENGTH AFTER CLEAN:', cleaned.length);
