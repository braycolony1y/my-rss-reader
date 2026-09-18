import { decodeHTMLEntities } from '../../feed-parsers.js';
import { transformVozRedditEmbeds } from '../sources/VozSource.js';
import * as cheerio from 'cheerio/slim';
import { escapeHtml } from '../utils/article-utils.js';

function isUsableArticlePage(html) {
    if (!html) return false;
    if (html.match(/(?:The requested thread could not be found|Chủ đề yêu cầu không tìm thấy|Không tìm thấy chủ đề được yêu cầu)/i)) return true;
    if (html.length < 800) return false;
    const sample = html.slice(0, 120000);
    const titleMatch = sample.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const titleText = titleMatch ? titleMatch[1].trim() : '';
    if (/(?:attention required|just a moment|access (?:to this page )?(?:has been )?denied|are you a robot|verifying the device)/i.test(titleText) || /(?:cf-chl-|enable javascript and cookies to continue|we(?:'|&apos;|&#x27;)ve detected unusual activity from your computer network|press\s*(?:&amp;|&|and)\s*hold\s+to confirm you are a human|before we continue[\s\S]{0,300}(?:human|bot)|verifying the device|requested content will be available after verification|captcha-delivery\.com\/interstitial|reference id\s+[a-f0-9-]{12,}|why did this happen\??[\s\S]{0,300}please make sure your browser supports javascript and cookies|block reference id\s*:)/i.test(sample)) return false;
    if (/(?:attention required|access denied)/i.test(sample) && !/<(?:article|main|h1)\b/i.test(sample)) return false;
    return /<(?:html|article|main|p|script)\b/i.test(sample);
}

function extractBalancedElementByClass(html, className) {
    const escapedClass = String(className).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startRegex = new RegExp('<([a-z][a-z0-9-]*)\\b[^>]*class=(["\'])[^"\']*\\b' + escapedClass + '\\b[^"\']*\\2[^>]*>', 'i');
    const start = startRegex.exec(html);
    if (!start) return '';
    const tagName = start[1];
    const contentStart = start.index + start[0].length;
    const tokenRegex = new RegExp('<\\/?' + tagName + '\\b[^>]*>', 'gi');
    tokenRegex.lastIndex = start.index;
    let depth = 0;
    let token;
    while ((token = tokenRegex.exec(html))) {
        const isClosing = /^<\//.test(token[0]);
        const isSelfClosing = /\/>$/.test(token[0]);
        if (isClosing) {
            depth--;
            if (depth === 0) return html.slice(contentStart, token.index);
        } else if (!isSelfClosing) {
            depth++;
        }
    }
    return '';
}

function extractAllBalancedElementsByClass(html, className) {
    const escapedClass = String(className).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startRegex = new RegExp('<([a-z][a-z0-9-]*)\\b[^>]*class=(["\'])[^"\']*\\b' + escapedClass + '\\b[^"\']*\\2[^>]*>', 'gi');
    let start;
    const results = [];
    while ((start = startRegex.exec(html)) !== null) {
        const tagName = start[1];
        const contentStart = start.index + start[0].length;
        const tokenRegex = new RegExp('<\\/?' + tagName + '\\b[^>]*>', 'gi');
        tokenRegex.lastIndex = start.index;
        let depth = 0;
        let token;
        while ((token = tokenRegex.exec(html))) {
            const isClosing = /^<\//.test(token[0]);
            const isSelfClosing = /\/>$/.test(token[0]);
            if (isClosing) {
                depth--;
                if (depth === 0) {
                    results.push(html.slice(contentStart, token.index));
                    startRegex.lastIndex = token.index;
                    break;
                }
            } else if (!isSelfClosing) {
                depth++;
            }
        }
    }
    return results;
}

function scoreArticleMarkup(markup) {
    const value = String(markup || '');
    const text = decodeHTMLEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!text) return -Infinity;
    const paragraphCount = (value.match(/<p\b/gi) || []).length;
    const mediaCount = (value.match(/<(?:img|picture|video|audio|figure)\b/gi) || []).length;
    const linkText = [...value.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
        .map(match => match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length)
        .reduce((sum, length) => sum + length, 0);
    const linkDensity = linkText / Math.max(text.length, 1);
    const noiseCount = (value.match(/(?:advert|breadcrumb|recommend|related|newsletter|subscribe|comment-list|message-user|reaction|social-share)/gi) || []).length;
    return text.length + paragraphCount * 90 + mediaCount * 45 - Math.round(linkDensity * text.length * 1.4) - noiseCount * 180;
}

function selectBestArticleMarkup(html) {
    const commonBodyClasses = [
        'xfBody', 'xfBodyContainer', 'thread-body-wrapper', 'fck_detail', 'detail-content', 'article-body', 'article__body',
        'article-content', 'article__content', 'entry-content', 'post-content',
        'story-body', 'content-body', 'main-content', 'singular-content',
        'td-post-content', 'news-content', 'detail__content', 'article-detail'
    ];
    const candidates = [];
    for (const className of commonBodyClasses) {
        const candidate = extractBalancedElementByClass(html, className);
        if (candidate) {
            candidates.push(candidate);
        }
    }
    return candidates
        .map(candidate => ({ candidate, score: scoreArticleMarkup(cleanArticleMarkup(candidate)) }))
        .filter(item => item.score > 200)
        .sort((a, b) => b.score - a.score)[0]?.candidate || '';
}

function isMalformedArticleMarkup(markup) {
    const value = String(markup || '');
    const actualTags = (value.match(/<(?:p|div|section|article|img|figure|blockquote|h[1-6])\b/gi) || []).length;
    const brokenTags = (value.match(/(?:^|[\s>])\/?(?:p|div|section|article|img|figure|blockquote|h[1-6])(?:\s+(?:class|id|href|src)=|>)/gi) || []).length;
    return brokenTags >= 3 && actualTags < Math.ceil(brokenTags / 3);
}

function trimArticleMarkupAtSemanticBoundary(markup) {
    const source = String(markup || '');
    const boundaryPattern = /<(?:p|h[1-6]|div|section|ul|li)\b[^>]*>[\s\S]{0,350}?(?:Đọc tiếp\s*Về trang Chủ đề|Tặng sao cho bài viết hay|Đừng bỏ lỡ|Advertisements|(?:Trở lại|Quay lại)\s+(?:trang chủ|chuyên mục|Trang chủ|Chuyên mục)|(?:Bình luận|Comments)\s*\(\s*\d+\s*\)|Tin liên quan|Related stories|You may also like|Recommended for you|More stories|Read next|Tuổi Trẻ Online Newsletters|Thêm\s+[^\n<]{1,80}\s+trên Google|Chọn\s+[^\n<]{1,80}\s+làm nguồn ưu tiên|Chủ đề liên quan|Xem thêm:|\bTIN LIÊN QUAN\b|\bCHỦ ĐỀ LIÊN QUAN\b|Link bài gốc)[\s\S]{0,350}?<\/(?:p|h[1-6]|div|section|ul|li)>/giu;
    const candidates = [...source.matchAll(boundaryPattern)]
        .map(match => match.index || 0)
        .filter(index => source.slice(0, index).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim().length >= Math.max(250, Math.min(800, Math.floor(source.length * 0.25))));
    if (candidates.length) {
        return source.slice(0, Math.min(...candidates));
    }
    // Also check for raw text boundaries if tags were stripped or flattened
    const rawPattern = /(?:Đọc tiếp\s*Về trang Chủ đề|Tặng sao cho bài viết hay|Tuổi Trẻ Online Newsletters|\bTin liên quan\b|\bChủ đề liên quan\b|\bTIN LIÊN QUAN\b|\bCHỦ ĐỀ LIÊN QUAN\b|\bXem thêm:\b|\bBài liên quan\b|Link bài gốc)(?:\s*(?:<[^>]+>|\s|[\p{L}\d\-,.!"'?:();/]){1,1000})?$/iu;
    const rawMatch = rawPattern.exec(source);
    if (rawMatch && rawMatch.index > 250) {
        return source.slice(0, rawMatch.index);
    }
    return source;
}

const cleanedThreadMarkup = new Map();
let cleanedThreadBytes = 0;
function cleanArticleMarkup(markup) {
    const input = String(markup || '');
    if (!input.includes('voz-post')) return cleanArticleMarkupUncached(input);
    const cached = cleanedThreadMarkup.get(input);
    if (cached) {
        cleanedThreadMarkup.delete(input);
        cleanedThreadMarkup.set(input, cached);
        return cached.output;
    }
    const output = cleanArticleMarkupUncached(input);
    // Exact input keys keep edits and sanitation changes from sharing results.
    const bytes = (input.length + output.length) * 2;
    if (bytes <= 8 * 1024 * 1024) {
        cleanedThreadMarkup.set(input, { output, bytes });
        cleanedThreadBytes += bytes;
        while (cleanedThreadBytes > 8 * 1024 * 1024 || cleanedThreadMarkup.size > 100) {
            const oldest = cleanedThreadMarkup.keys().next().value;
            cleanedThreadBytes -= cleanedThreadMarkup.get(oldest).bytes;
            cleanedThreadMarkup.delete(oldest);
        }
    }
    return output;
}

function cleanArticleMarkupUncached(markup) {
    // This also migrates already-cached VOZ pages at read time. Older cache
    // entries contain XenForo's enormous inline Reddit SVG instead of an
    // actual embed because the publisher normally upgrades it with JS.
    let cleaned = transformVozRedditEmbeds(String(markup || ''));
    const threadCommentIdx = cleaned.search(/<div[^>]*class=["'][^"']*(?:thread-comment|comment-list|bdPostTree|replies|comments-area)[^"']*["']/i);
    if (threadCommentIdx > -1) {
        cleaned = cleaned.slice(0, threadCommentIdx);
    }
    const isVozPost = cleaned.includes('voz-post');
    const isTechmemeStory = cleaned.includes('class="techmeme-story"') || cleaned.includes("class='techmeme-story'");

    try {
        const $ = cheerio.load(cleaned, null, false);
        $('script,style,template,nav,form,noscript').remove();
        // Keep the reader's own coverage controls when serving cached Ground
        // stories. Upstream page buttons are still discarded as before.
        $('button').not('.ground-story[data-ground-reader="2"] button[data-ground-filter], .ground-story[data-ground-reader="2"] button[data-ground-summary]').remove();
        $('aside').not('.tuoitre-info-card').remove();
        $('[aria-hidden="true"]').each((_, element) => {
            const node = $(element);
            const isReaderOwnedDecoration = node.hasClass('tuoitre-event-stream__icon')
                || node.hasClass('tuoitre-event-stream__arrow')
                || node.closest('.techmeme-x-posts').length > 0;
            if (!isReaderOwnedDecoration) node.remove();
        });

        const noise = /(?:advert|adsbygoogle|ad-container|breadcrumb|pagination|related|recommend|share|social|reaction|signature|message-user|message-attribution|message-footer|message-cell--user|post-meta|author-box|author-info|singular-author|user-info|user-panel|member-header|comment-list|comments-area|newsletter|subscribe|topic-list|trending|popular-post|read-more|tags-list|article__tags|author-area|menu-area|menu-container|action-bar|thread-action|thread-editor|relate-news|box-topic|tinlienquan|knc-relate|box-relate|zone-interlink|article-audio|tts-player|dt-size-6|detail-comment|box-comment|box-bottom|cmbl|detail-tab|admzone|link-source-detail)/i;

        // Resolve repeated ancestor selectors once per document. Recompiling
        // them for every element dominated cleanup on image-heavy forum pages.
        const descendants = selector => new Set($(selector).find('*').addBack().toArray());
        const readerSections = descendants('.embedded-suggested-articles, .tuoitre-event-stream, .techmeme-x-posts, .techmeme-primary-article');
        const protectedNodes = descendants('.voz-post-likes, .box_tiso_all, .highcharts-container');
        const groundNodes = descendants('.ground-story[data-ground-reader="2"]');
        $('*').each((i, el) => {
            const node = $(el);
            const tag = el.tagName;
            const marker = [node.attr('id'), node.attr('class'), node.attr('role')].filter(Boolean).join(' ');

            const isReaderOwnedSection = readerSections.has(el);
            if (noise.test(marker) && !isReaderOwnedSection) {
                node.remove();
                return;
            }

            if (['article', 'div'].includes(tag)) {
                if (/(?:article-relate|summary__content|box-tin-lien-quan|ck-cms-insert-news|relate-news|box-related-news|related-topic)/i.test(marker) ||
                    ['RelatedOneNews', 'RelatedNewsBox'].includes(node.attr('type')) ||
                    node.attr('data-source') === 'related-news') {

                    const link = node.find('a').first();
                    if (link.length) {
                        const href = link.attr('href');
                        let titleText = link.text().replace(/\s+/g, ' ').trim() || node.find('h1,h2,h3,h4,h5,h6,span').first().text().trim() || 'Bài viết liên quan';
                        if (titleText && titleText.length >= 10 && href) {
                            const descNode = node.find('[class*="desc"], [class*="sapo"], [class*="summary"], [class*="VCObjectBoxRelatedNewsItemSapo"]').first();
                            const descText = descNode.length ? `<p class="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">${escapeHtml(descNode.text().replace(/\s+/g, ' ').trim())}</p>` : '';

                            const card = `<div class="styled-rel-card my-6 px-4 py-3.5 rounded-xl border-l-4 border-l-blue-600 dark:border-l-blue-500 bg-gray-50 dark:bg-gray-800/80 border border-gray-200/80 dark:border-gray-700 shadow-sm not-prose transition hover:shadow-md hover:border-l-blue-700"><div class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-2"><span>📰 Bài viết liên quan / Xem thêm:</span></div><a href="${escapeHtml(href)}" target="_blank" class="font-bold text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 text-base md:text-lg block leading-snug no-underline transition">${escapeHtml(titleText)} →</a>${descText}</div>`;
                            node.replaceWith(card);
                            return;
                        }
                    }
                }
            }

            if (['div', 'figure'].includes(tag)) {
                const vidSrc = node.attr('data-vid') || node.attr('data-video') || node.attr('data-src');
                if (vidSrc && (node.attr('type') === 'VideoStream' || /(?:\.mp4|\.m3u8)/i.test(vidSrc))) {
                    let vidUrl = vidSrc;
                    if (!vidUrl.startsWith('http://') && !vidUrl.startsWith('https://')) {
                        vidUrl = 'https://' + vidUrl.replace(/^\/+/, '');
                    }
                    const thumb = node.attr('data-thumb') || node.attr('poster');
                    const posterAttr = thumb && (thumb.startsWith('http') || thumb.startsWith('/')) ? `poster="${escapeHtml(thumb)}"` : '';
                    node.replaceWith(`<div class="article-video-container my-4 rounded-xl overflow-hidden shadow-md"><video controls playsinline preload="metadata" class="w-full h-auto" src="${escapeHtml(vidUrl)}" ${posterAttr}>Video playback is not supported by this browser.</video></div>`);
                    return;
                }
            }

            if (tag === 'img') {
                const isGroundPublisherLogo = node.hasClass('ground-publisher-logo') && groundNodes.has(el);
                if (!isVozPost && !isGroundPublisherLogo && /(avatar|logo|smilie|emoji)/i.test(marker + ' ' + (node.attr('src')||''))) {
                    node.remove(); return;
                }
                if (isVozPost && /logo/i.test(marker + ' ' + (node.attr('src')||'')) && !/avatar/i.test(marker + ' ' + (node.attr('src')||''))) {
                    node.remove(); return;
                }
                const realSrc = node.attr('data-large-src') || node.attr('data-original') || node.attr('data-src') || node.attr('data-url') || node.attr('data-zoom-image') || node.attr('data-img-src') || node.attr('data-lazy-src');
                if (realSrc) {
                    node.attr('src', realSrc);
                    ['data-large-src', 'data-original', 'data-src', 'data-url', 'data-zoom-image', 'data-img-src', 'data-lazy-src'].forEach(a => node.removeAttr(a));
                }
                if (/^data:image\//i.test(node.attr('src'))) {
                    node.remove(); return;
                }
            }

            if (['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'].includes(tag)) {
                const text = node.text().replace(/\s+/g, ' ').trim();
                if (/^Quảng cáo$/i.test(text) ||
                    /^(Your browser does not support HTML5 audio\.?|Advertisement|Advertisements|Ads by|Skip|Next|Stay|Back|Quality|Playback speed|1x Normal|Normal|\d+(?:\.\d+)?x|(Video|Audio) \d+( Shorts)?|Link bài gốc)$/i.test(text) ||
                    /^Image \d+:$/i.test(text) ||
                    /^(Trở lại|Quay lại) (trang chủ|chuyên mục|Trang chủ|Chuyên mục)$/i.test(text) ||
                    /(Thêm [^\n<]{1,80} trên Google|Chọn [^\n<]{1,80} làm nguồn ưu tiên)/i.test(text)) {
                    node.remove(); return;
                }
            }

            const isMediaNode = ['img', 'video', 'audio', 'iframe'].includes(tag);
            const isProtectedNode = protectedNodes.has(el);
            if (!isProtectedNode) {
                if (!isMediaNode || tag === 'img') {
                    node.removeAttr('style');
                    node.removeAttr('height');
                    node.removeAttr('min-height');
                    node.removeAttr('max-height');
                    node.removeAttr('width');
                }
            }
            Object.keys(el.attribs || {}).forEach(attr => {
                if (/^on/i.test(attr)) node.removeAttr(attr);
            });
        });

        $('img,video,audio').each((i, el) => {
            const node = $(el);
            const mediaMarker = [node.attr('src'), node.attr('alt'), node.attr('class')].filter(Boolean).join(' ');
            if (/(?:newsletter|captcha|default[-_ ]?avatar|userdeff?ault|draggable-icon|cmsads|admicro|doubleclick|googlesyndication)/i.test(mediaMarker)) {
                node.remove(); return;
            }
            node.attr('referrerpolicy', 'no-referrer');
            const w = Number(node.attr('width') || 0), h = Number(node.attr('height') || 0);
            if ((w && w <= 2) || (h && h <= 2)) {
                node.remove(); return;
            }
            if (['video', 'audio'].includes(el.tagName)) {
                node.attr('controls', '');
                node.attr('playsinline', '');
            }
        });

        const retainedSections = descendants('.ground-story[data-ground-reader="2"], .embedded-suggested-articles, .styled-rel-card, .tuoitre-event-stream, .techmeme-x-posts, .techmeme-primary-article');
        $('div,section,ul').each((i, el) => {
            const node = $(el);
            if (retainedSections.has(el)) return;
            const textLength = node.text().replace(/\s+/g, ' ').trim().length;
            const links = node.find('a');
            let linkLength = 0;
            links.each((_, link) => { linkLength += $(link).text().trim().length; });
            if (links.length >= 4 && textLength > 0 && linkLength / textLength > 0.78) node.remove();
        });

        for (let i = 0; i < 3; i++) {
            $('p,div,span,section,figure').each((i, el) => {
                const node = $(el);
                if (node.children().length === 0 && !node.text().trim()) {
                    node.remove();
                }
            });
        }

        if (!isVozPost) {
            $('a').each((i, el) => {
                const node = $(el);
                if (node.closest('.ground-story[data-ground-reader="2"]').length > 0 ||
                    node.closest('.tuoitre-event-stream, .embedded-suggested-articles').length > 0 ||
                    node.closest('.tuoitre-info-card, .techmeme-x-posts, .techmeme-primary-article').length > 0 || node.hasClass('styled-rel-card')) return;
                if (!node.hasClass('font-bold') && !node.hasClass('embedded-suggested-card') && !node.hasClass('article-inline-link')) {
                    node.replaceWith(node.html());
                }
            });
        }

        let out = $.html();
        out = out.replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>');

        if (!isTechmemeStory) {
            const boundaryPattern = /<(?:p|h[1-6]|div|section|ul|li)\b[^>]*>[\s\S]{0,350}?(?:Đọc tiếp\s*Về trang Chủ đề|Tặng sao cho bài viết hay|Đừng bỏ lỡ|Advertisements|(?:Trở lại|Quay lại)\s+(?:trang chủ|chuyên mục|Trang chủ|Chuyên mục)|(?:Bình luận|Comments)\s*\(\s*\d+\s*\)|Tin liên quan|Related stories|You may also like|Recommended for you|More stories|Read next|Tuổi Trẻ Online Newsletters|Thêm\s+[^\n<]{1,80}\s+trên Google|Chọn\s+[^\n<]{1,80}\s+làm nguồn ưu tiên|Chủ đề liên quan|Xem thêm:|\bTIN LIÊN QUAN\b|\bCHỦ ĐỀ LIÊN QUAN\b|Link bài gốc)[\s\S]{0,350}?<\/(?:p|h[1-6]|div|section|ul|li)>/giu;
            const candidates = [...out.matchAll(boundaryPattern)]
                .map(m => m.index || 0)
                .filter(idx => out.slice(0, idx).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length >= Math.max(250, Math.min(800, Math.floor(out.length * 0.25))));
            if (candidates.length) out = out.slice(0, Math.min(...candidates));
        }

        out = out.replace(/^(?:\s*<(?:p|div|span)[^>]*>)?\s*([A-ZÀ-Ỹ\s]{3,25})\s+\1\b/u, '$1');
        return out;

    } catch (e) {
        return cleaned;
    }
}

export { cleanArticleMarkup, isUsableArticlePage, extractBalancedElementByClass, selectBestArticleMarkup, scoreArticleMarkup, isMalformedArticleMarkup, extractAllBalancedElementsByClass, trimArticleMarkupAtSemanticBoundary };
