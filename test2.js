import fs from 'fs';
const file = fs.readFileSync('article_cache/37be4c4e172c542d78bb7761852041b8650dbdfc96c00299c9a7228a8c3f6925.json', 'utf-8');
const data = JSON.parse(file);
let cleaned = data.result.content;

// replicate cleanArticleMarkup
cleaned = cleaned.split(/<div[^>]*class=["'][^"']*(?:thread-comment|comment-list|bdPostTree|replies|comments-area)[^"']*["']/i)[0];
cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
cleaned = cleaned.replace(/<(?:script|style|template|nav|aside|form|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|template|nav|aside|form|noscript)>/gi, '');

const noisePattern = /<(div|section|footer|header|ul|aside)\b[^>]*(?:class|id|data-module|role)=(["\'])[^"\']*(?:advert|adsbygoogle|ad-container|breadcrumb|pagination|related|recommend|share|social|reaction|signature|message-user|message-attribution|message-footer|message-cell--user|post-meta|author-box|author-info|singular-author|user-info|user-panel|member-header|comment-list|comments-area|newsletter|subscribe|topic-list|trending|popular-post|read-more|tags-list|article__tags|author-area|menu-area|menu-container|action-bar|thread-action|thread-editor|relate-news|box-topic|tinlienquan|knc-relate|box-relate|zone-interlink|article-audio|tts-player|dt-size-6|detail-comment|box-comment|box-bottom|cmbl|detail-tab|admzone|link-source-detail)[^"\']*\2[^>]*>[\s\S]*?<\/\1>/gi;
for (let i = 0; i < 5; i++) cleaned = cleaned.replace(noisePattern, '');

console.log("Has related articles after noise pattern:", cleaned.includes("BÀI VIẾT LIÊN QUAN"));

if (!cleaned.includes('voz-post')) {
    const protectedLinks = [];
    cleaned = cleaned.replace(/<a\b[^>]*class=["'][^"']*font-bold text-gray-900[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, (match) => {
        protectedLinks.push(match);
        return `__PROTECTED_LINK_${protectedLinks.length - 1}__`;
    });
    for (let i = 0; i < 3; i++) cleaned = cleaned.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
    cleaned = cleaned.replace(/<\/?a\b[^>]*>/gi, '');
    for (let i = 0; i < protectedLinks.length; i++) {
        cleaned = cleaned.replace(`__PROTECTED_LINK_${i}__`, protectedLinks[i]);
    }
}
console.log("Has related articles after link strip:", cleaned.includes("BÀI VIẾT LIÊN QUAN"));
console.log(cleaned.substring(cleaned.length - 500));
