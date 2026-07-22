import express from 'express';
import cron from 'node-cron';
import fs from 'fs/promises';
import { readFileSync, unlinkSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { execSync, execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { createSmartNewsEngine, cleanStoredCluster } from './smart-news.js';
import sourceRegistry from './src/sources/index.js';
import GoogleDecoderPkg from 'google-news-url-decoder';
const { GoogleDecoder } = GoogleDecoderPkg;
const googleDecoder = new GoogleDecoder();

dotenv.config();
// Keep the Gemini credential separate from the rest of the application config.
// Values here intentionally override matching entries in the general .env file.
dotenv.config({ path: './gemini.env', override: true });

// --- PROCESS ERROR HANDLERS: Prevent silent crashes ---
const processStartTime = Date.now();

process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err.message, err.stack);
    // Give time for the log to flush, then exit so systemd can restart us
    setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled Promise Rejection:', reason);
});


// Optional Vietserver Proxy Base URL (e.g., https://proxy.yourdomain.com/?url=)
const VIETSERVER_PROXY_BASE = process.env.VIETSERVER_PROXY_BASE || '';

async function fetchViaVietserver(url) {
    if (!VIETSERVER_PROXY_BASE) throw new Error("Vietserver proxy not configured in .env");
    const fetchUrl = VIETSERVER_PROXY_BASE + encodeURIComponent(url);
    const res = await fetch(fetchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!res.ok) throw new Error(`Vietserver proxy returned HTTP ${res.status}`);
    return await res.text();
}

const JINA_READER_BASE = 'https://r.jina.ai/';
const ARTICLE_CACHE_DIR = './article_cache';
const ARTICLE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;// NOTE: If you change anything about how articles are parsed, fetched, or sanitized (such as improving image extraction, video embeds, etc), you MUST bump this version to force a re-fetch of existing cached articles.
const ARTICLE_CACHE_VERSION = 17;
const execFileAsync = promisify(execFile);

function articleCacheFilename(url) {
    const canonicalUrl = String(url).replace(/\/unread\/?(?:[?#].*)?$/i, '');
    return path.join(ARTICLE_CACHE_DIR, createHash('sha256').update(canonicalUrl).digest('hex') + '.json');
}

async function getCachedArticle(url) {
    const filename = articleCacheFilename(url);
    try {
        const cached = JSON.parse(await fs.readFile(filename, 'utf-8'));
        const isExpired = Date.now() - cached.cachedAt >= ARTICLE_CACHE_TTL_MS;
        if (cached.version !== ARTICLE_CACHE_VERSION || !cached.cachedAt || !cached.result?.content) {
            await fs.unlink(filename).catch(() => {});
            return null;
        }
        if (isExpired) {
            // Check if protected
            let isProtected = false;
            try {
                const data = JSON.parse(readFileSync('./user_settings.json', 'utf8'));
                if (data.readLater && data.readLater.some(i => i.link === url || i.link === url.split('?')[0])) isProtected = true;
                if (data.boards) {
                    for (const b of Object.values(data.boards)) {
                        if (b && b.some(i => i.link === url || i.link === url.split('?')[0])) isProtected = true;
                    }
                }
            } catch (e) {}
            if (!isProtected) {
                await fs.unlink(filename).catch(() => {});
                return null;
            }
        }
        return cached.result;
    } catch (e) {
        return null;
    }
}

async function cacheArticleResult(url, result) {
    if (!result?.content) return;
    try {
        await fs.mkdir(ARTICLE_CACHE_DIR, { recursive: true });
        await _writeJsonAtomic(articleCacheFilename(url), { version: ARTICLE_CACHE_VERSION, cachedAt: Date.now(), url, result });
    } catch (error) {
        console.error('[ARTICLE CACHE] Could not save article:', error.message);
    }
}

async function deleteCachedArticle(url) {
    await fs.unlink(articleCacheFilename(url)).catch(() => {});
}

async function cleanupArticleCache() {
    try {
        const savedStatesForPruning = await env.RSS_DATA.get('savedStates', { type: 'json' }) || [];
        const boardStatesForPruning = await env.RSS_DATA.get('boardStates', { type: 'json' }) || [];
        const protectedUrls = new Set([...savedStatesForPruning, ...boardStatesForPruning]);

        await fs.mkdir(ARTICLE_CACHE_DIR, { recursive: true });
        const files = await fs.readdir(ARTICLE_CACHE_DIR);
        let removed = 0;
        for (const name of files) {
            if (!name.endsWith('.json')) continue;
            const filename = path.join(ARTICLE_CACHE_DIR, name);
            try {
                const cached = JSON.parse(await fs.readFile(filename, 'utf-8'));
                if (cached.version !== ARTICLE_CACHE_VERSION || !cached.cachedAt || Date.now() - cached.cachedAt >= ARTICLE_CACHE_TTL_MS) {
                    if (cached.url && (protectedUrls.has(cached.url) || protectedUrls.has(cached.url.split('?')[0]))) {
                        // Protected, do not delete
                    } else {
                        await fs.unlink(filename);
                        removed++;
                    }
                }
            } catch (e) {
                await fs.unlink(filename).catch(() => {});
                removed++;
            }
        }
        if (removed) console.log(`[ARTICLE CACHE] Removed ${removed} expired or invalid entries.`);
    } catch (error) {
        console.error('[ARTICLE CACHE] Cleanup failed:', error.message);
    }
}

function escapeHtml(text = '') {
    return String(text).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

function safeHttpUrl(value) {
    try {
        const parsed = new URL(value);
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch (e) {
        return '';
    }
}

function renderJinaInline(text = '') {
    const placeholders = [];
    const stash = html => {
        const token = '@@JINA' + placeholders.length + '@@';
        placeholders.push(html);
        return token;
    };

    let rendered = String(text);
    // Empty Markdown links are icon-only share/comment controls after reader
    // extraction. They have no article text and are never useful in Reader.
    rendered = rendered.replace(/\[\]\([^\n)]*\)/g, '');
    rendered = rendered.replace(/<audio\b[^>]*\bsrc=(['"])([^'"]+)\1[^>]*>[\s\S]*?<\/audio>/gi, (match, quote, audioUrl) => {
        const safeAudio = safeHttpUrl(decodeHTMLEntities(audioUrl));
        if (!safeAudio || !/\.(?:mp3|m4a|aac|ogg|oga|wav|flac)(?:$|[?#])/i.test(safeAudio)) return '';
        return stash('<div class="article-audio-player"><audio controls playsinline preload="metadata" src="' + escapeHtml(safeAudio) + '">Audio playback is not supported by this browser.</audio></div>');
    });
    rendered = rendered.replace(/<video\b[^>]*\bsrc=(['"])([^'"]+)\1[^>]*>[\s\S]*?<\/video>/gi, (match, quote, videoUrl) => {
        const safeVideo = safeHttpUrl(decodeHTMLEntities(videoUrl));
        if (!safeVideo || !/\.(?:mp4|webm|ogg)(?:$|[?#])/i.test(safeVideo)) return '';
        return stash('<video controls playsinline preload="metadata" src="' + escapeHtml(safeVideo) + '">Video playback is not supported by this browser.</video>');
    });
    rendered = rendered.replace(/\[!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g, (match, alt, imageUrl, linkUrl) => {
        const safeImage = safeHttpUrl(imageUrl);
        if (!safeImage) return alt;
        return stash('<img src="' + escapeHtml(safeImage) + '" alt="' + escapeHtml(alt) + '">');
    });
    rendered = rendered.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g, (match, alt, imageUrl) => {
        const safeImage = safeHttpUrl(imageUrl);
        if (!safeImage) return alt;
        return stash('<img src="' + escapeHtml(safeImage) + '" alt="' + escapeHtml(alt) + '">');
    });
    rendered = rendered.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+\.(?:mp3|m4a|aac|ogg|oga|wav|flac)(?:[?#][^)\s]*)?)(?:\s+"[^"]*")?\)/gi, (match, label, audioUrl) => {
        const safeAudio = safeHttpUrl(audioUrl);
        if (!safeAudio) return label;
        return stash('<div class="article-audio-player"><audio controls playsinline preload="metadata" src="' + escapeHtml(safeAudio) + '">Audio playback is not supported by this browser.</audio></div>');
    });
    rendered = rendered.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g, (match, label, linkUrl) => {
        return label;
    });

    rendered = escapeHtml(rendered)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');

    // A linked image can create a placeholder inside another placeholder.
    // Resolve repeatedly so no internal @@JINA…@@ token leaks into the UI.
    for (let pass = 0; pass <= placeholders.length && /@@JINA\d+@@/.test(rendered); pass++) {
        rendered = rendered.replace(/@@JINA(\d+)@@/g, (match, index) => placeholders[Number(index)] || '');
    }
    return rendered.replace(/@@JINA\d+@@/g, '');
}

function jinaMarkdownToHtml(markdown = '') {
    const html = [];
    let paragraph = [];
    let listType = null;

    const flushParagraph = () => {
        if (paragraph.length) {
            html.push('<p>' + renderJinaInline(paragraph.join(' ')) + '</p>');
            paragraph = [];
        }
    };
    const closeList = () => {
        if (listType) {
            html.push('</' + listType + '>');
            listType = null;
        }
    };

    for (const rawLine of String(markdown).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
            flushParagraph();
            closeList();
            continue;
        }

        const heading = line.match(/^(#{1,4})\s+(.+)$/);
        const unordered = line.match(/^[-*+]\s+(.*)$/);
        const ordered = line.match(/^\d+\.\s+(.*)$/);
        const quote = line.match(/^>\s?(.*)$/);

        if (heading) {
            flushParagraph();
            closeList();
            const level = Math.min(heading[1].length + 1, 4);
            html.push('<h' + level + '>' + renderJinaInline(heading[2]) + '</h' + level + '>');
        } else if (unordered || ordered) {
            flushParagraph();
            const nextListType = unordered ? 'ul' : 'ol';
            if (listType !== nextListType) {
                closeList();
                listType = nextListType;
                html.push('<' + listType + '>');
            }
            html.push('<li>' + renderJinaInline((unordered || ordered)[1]) + '</li>');
        } else if (quote) {
            flushParagraph();
            closeList();
            html.push('<blockquote>' + renderJinaInline(quote[1]) + '</blockquote>');
        } else if (/^[-*_]{3,}$/.test(line)) {
            flushParagraph();
            closeList();
        } else {
            closeList();
            paragraph.push(line);
        }
    }

    flushParagraph();
    closeList();
    return html.join('');
}

function trimJinaArticleMarkdown(markdown = '') {
    let source = String(markdown || '');
    let author = '';
    let extractedDate = '';

    const readerAuthor = source.match(/^\s*>?\s*(?:作者|Author)\s*:\s*([^\n]+)\s*$/im);
    const readerDate = source.match(/^\s*>?\s*(?:发布时间|Published(?:\s+Time)?)\s*:\s*([^\n]+)\s*$/im);
    if (readerAuthor) {
        author = readerAuthor[1].trim();
        source = source.replace(readerAuthor[0], '');
    }
    if (readerDate) {
        extractedDate = readerDate[1].trim();
        source = source.replace(readerDate[0], '');
    }

    // Many publishers put a compact byline directly below the title. It is
    // already rendered in the reader header, so retain it as metadata rather
    // than duplicating it inside the article body.
    const byline = source.match(/^(?![#>*\[])([^|\n]{2,100}?)\s*\|\s*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2})\s*$/m);
    if (byline) {
        author = byline[1].trim();
        extractedDate = byline[2].trim();
        source = source.replace(byline[0], '');
    }
    const stackedByline = source.match(/^(?![#>*\[])([^|\n]{2,100}?)\s*\n\s*\|\s*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2})\s*$/m);
    if (stackedByline) {
        author ||= stackedByline[1].trim();
        extractedDate ||= stackedByline[2].trim();
        source = source.replace(stackedByline[0], '');
    }

    // Reader services sometimes preserve share/report/email controls as
    // Markdown. A line containing one of those non-web actions is page chrome,
    // not article prose.
    let removingInvalidMediaChrome = false;
    source = source.split(/\r?\n/)
        .filter(line => {
            if (/\]\(blob:/i.test(line) || /<video\b[^>]*\bsrc=(['"])blob:/i.test(line)) {
                removingInvalidMediaChrome = true;
                return false;
            }
            if (removingInvalidMediaChrome && (
                /^\s*$/.test(line) ||
                /^\s*(?:Tự động phát sau|\d+|Current Time\s*\d{1,2}:\d{2}|Duration\s*\d{1,2}:\d{2}|auto|\/|[-*+]\s*(?:\d{3,4}p|auto))\s*$/i.test(line)
            )) return false;
            removingInvalidMediaChrome = false;
            return true;
        })
        .filter(line => !/\]\(\s*(?:javascript:|mailto:)/i.test(line))
        .filter(line => !/!\[[^\]]*\]\(https?:\/\/[^)]*(?:cmsads|admicro|doubleclick|googlesyndication|adservice)[^)]*\)/i.test(line))
        .filter(line => !/^\s*(?:Audio|Video|Ảnh|Photo|Tập|Ep)\s*\d+(?:\s+Shorts)?\s*$/i.test(line))
        .filter(line => !/^\s*\[(?:Video|Audio|Tập|Ep)\s+\d+\]\([^)]+\)\s*$/iu.test(line))
        .filter(line => !/^\s*(?:Nghe đọc bài|Listen to article|Tắt bật tiếng|Bật tắt tiếng|Tự động phát sau|Giọng đọc)\s*$/iu.test(line))
        .filter(line => !/^\s*\d{1,2}:\d{2}\s*$/i.test(line))
        .filter(line => !/^\s*(?:0\.25x|0\.5x|0\.75x|1x|1\.00x|1\.25x|1\.5x|1\.75x|2x|2\.0x|Normal|1x\s+Normal|Quality|Playback\s+speed)\s*$/i.test(line))
        .filter(line => !/^\s*(?:Advertisement|Advertisements|Quảng cáo|Ads\s+by|Skip|Next|Stay|Back|Trở lại|Quay lại|\d{3,4}p|auto|\/)\s*$/iu.test(line))
        .filter(line => !/^\s*(?:Nữ miền Bắc|Nam miền Bắc|Nam miền Nam|Nữ miền Nam|Giọng Bắc|Giọng Nam)\s*$/iu.test(line))
        .filter(line => !/^\s*<video\b[^>]*\bsrc=(['"])blob:[\s\S]*<\/video>\s*$/i.test(line))
        .filter(line => !/^\s*(?:Tự động phát sau|Current Time\s*\d{1,2}:\d{2}|Duration\s*\d{1,2}:\d{2}|auto|\d{3,4}p|\/)\s*$/i.test(line))
        .filter(line => !/!\[[^\]]*(?:newsletter|captcha|default\s*avatar|user\s*default|draggable)[^\]]*\]\(/i.test(line))
        .filter(line => !/^\s*(?:Trở lại|Quay lại)\s+[\p{L}\s]+\s*$/iu.test(line))
        .join('\n');

    // Stop where the publisher's recommendation/tag/footer area starts. These
    // semantic boundaries work across publishers and preserve inline media in
    // the article itself.
    const endPatterns = [
        /(?:^|\n)\s*(?:\[Đọc tiếp\][^\n]*)?\s*\[Về trang Chủ đề\]/i,
        /(?:^|\n)\s*Đọc tiếp\s*Về trang Chủ đề/i,
        /(?:^|\n)\s*(?:#{1,4}\s*)?(?:Tặng sao cho bài viết hay|Đừng bỏ lỡ|Advertisements|Quảng cáo)\s*(?:\n|$)/iu,
        /(?:^|\n)\s*(?:#{1,4}\s*)?(?:Bình luận|Comments?|Ý kiến bạn đọc|Chia sẻ ý kiến)\s*(?:\(\s*\d+\s*\))?\s*(?:\n|$)/iu,
        /(?:^|\n)\s*(?:#{1,4}\s*)?(?:Tin liên quan|Related stories|You may also like|Recommended for you|More stories|Read next|Các bài liên quan|Tin tức liên quan|Tin cùng chuyên mục|Bài cùng chuyên mục)\s*(?:\n|$)/iu,
        /(?:^|\n)\s*(?:#{1,4}\s*)?(?:Tuổi Trẻ Online Newsletters|Newsletters?|Đăng ký nhận tin)\s*(?:\n|$)/iu,
        /(?:^|\n)\s*(?:#{1,4}\s*)?(?:Thêm\s+[^\n]{1,80}\s+trên Google|Chọn\s+[^\n]{1,80}\s+làm nguồn ưu tiên)\b/iu,
        /(?:^|\n\s*\n)\s*(?:#{1,4}\s*)?(?:Trở lại|Quay lại)\s+[\p{L}\s]{2,50}\s*(?:\n|$)/iu,
        /(?:^|\n)\s*(?:#{1,4}\s*)?(?:\*\*|__)?(?:Tags?|Từ khóa|Chủ đề liên quan)(?:\*\*|__)?\s*(?:\n|$)/iu,
        /(?:^|\n)\s*(?:#{1,4}\s*)?(?:Đọc thêm về|Xem thêm|Xem tiếp|Nguồn:)[^\n]*\s*(?:\n|$)/iu,
        /(?:^|\n)\s*(?:#{1,4}\s*)?(?:ĐANG HOT|TIN NỔI BẬT(?:\s+SOHA)?|Video Shorts|Đang được quan tâm|Theo dòng sự kiện|Bài đọc nhiều)\s*(?:\n|$)/iu,
        /(?:^|\n)\s*(?:#{1,4}\s*)?(?:Related Articles|Recommended(?: for you)?|More from [^\n]+)\s*(?:\n|$)/i
    ];
    const boundaries = endPatterns
        .map(pattern => source.search(pattern))
        .filter(index => index >= Math.max(350, Math.min(800, Math.floor(source.length * 0.35))));
    if (boundaries.length) source = source.slice(0, Math.min(...boundaries));

    // A recommendation card is often immediately before the publisher's
    // footer controls. Remove only compact trailing blocks that contain both
    // a linked thumbnail and a linked headline, never normal article media.
    const blocks = source.trim().split(/\n\s*\n/);
    while (blocks.length > 1) {
        const last = blocks[blocks.length - 1].trim();
        const linkedImage = /\[!\[[^\]]*\]\(https?:\/\/[^)]+\)\]\(https?:\/\/[^)]+\)/i.test(last);
        const linkedHeadline = /\[[^\]]{8,}\]\(https?:\/\/[^)]+\)/i.test(last.replace(/\[!\[[\s\S]*?\)\]\([\s\S]*?\)/g, ''));
        const hasRecommendationMarker = /^(?:#{1,4}\s*)?(?:Tin liên quan|Đề xuất|Box tin|Xem thêm|Đọc thêm|Bài liên quan|Cùng chuyên mục)/iu.test(last) || /(?:^|\n)(?:Trở lại|Quay lại)\s+[\p{L}\s]+/iu.test(last);
        const endsWithCommentCount = /\.\d{1,4}$/.test(last);
        const isTrailingRecommendationBlock = (/^(!\[[^\]]*\]\(https?:\/\/[^)]+\)|\bImage\s+\d+:[\s\S]*)/i.test(last) || hasRecommendationMarker || endsWithCommentCount) && blocks.length >= 2 && last.length < 700;

        if (last.length > 1400 || ((!linkedImage || !linkedHeadline) && !hasRecommendationMarker && !isTrailingRecommendationBlock && !endsWithCommentCount)) break;
        blocks.pop();
    }
    source = blocks.join('\n\n');

    // Strip "Image X:" prefixes from captions and trailing comment counter numbers stuck to sentences
    source = source.replace(/^Image\s+\d+:\s*/gm, '')
        .replace(/!\[Image\s+\d+:\s*/gi, '![')
        .replace(/\.(\d{1,4})(?=\s*($|\n))/g, '.');

    return { markdown: source.trim(), author, extractedDate };
}

function stripJinaLeadingNavigation(markdown = '', title = '') {
    let text = String(markdown || '').trim();
    if (!text) return text;

    const normTitle = (title || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    const normTokens = new Set(normTitle.split(' ').filter(w => w.length >= 2));

    let bestIdx = -1;
    let bestScore = 0;

    const headingRegex = /^(#{1,3})\s+(.+)$/gm;
    let match;
    while ((match = headingRegex.exec(text)) !== null) {
        const headingRaw = match[2].trim();
        if (headingRaw.length < 3) continue;
        const normHead = headingRaw.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
        const headTokens = normHead.split(' ').filter(w => w.length >= 2);

        if (normHead === normTitle || (normTitle.length >= 15 && normHead.includes(normTitle)) || (normHead.length >= 15 && normTitle.includes(normHead))) {
            bestIdx = match.index;
            break;
        }

        if (headTokens.length >= 2 && normTokens.size >= 2) {
            let overlap = 0;
            for (const t of headTokens) {
                if (normTokens.has(t)) overlap++;
            }
            const ratio = overlap / Math.min(headTokens.length, normTokens.size);
            if (overlap >= 3 && ratio >= 0.55 && ratio > bestScore) {
                bestScore = ratio;
                bestIdx = match.index;
            }
        }
    }

    if (bestIdx >= 0) {
        return text.slice(bestIdx).trim();
    }

    const lines = text.split(/\r?\n/);
    let startLineIndex = 0;
    while (startLineIndex < lines.length) {
        const line = lines[startLineIndex].trim();
        if (!line) {
            startLineIndex++;
            continue;
        }
        const isNavLine = (
            /^\[\]\(javascript:.*$/i.test(line) ||
            /^[-*+]\s+\[[^\]]+\]\((?:javascript:|https?:\/\/[^)]+(?:kinh-doanh|thoi-su|the-gioi|phap-luat|giao-duc|suc-khoe|doi-song|du-lich|khoa-hoc|so-hoa|xe|y-kien|tam-su|video|podcasts?|short|tin-tuc|chuyen-muc|\/?#))[^)]*\)(?:\[[^\]]*\]\([^)]*\))*$/iu.test(line) ||
            /^(?:Mới nhất|Tin theo khu vực|Hà Nội|TP Hồ Chí Minh|TP HCM|International|VnE-GO|Discover|Shorts?|Podcasts?|Thời sự|Chính trị|Kỷ nguyên mới|Dân sinh|Việc làm|Giao thông|Quỹ Hy vọng|Thế giới|Phân tích|Tư liệu|Quân sự|Cuộc sống đó đây|Người Việt 5 châu|Bắc Mỹ|Kinh doanh|NetZero|Quốc tế|Doanh nghiệp|Chứng khoán|Ebank|Vĩ mô|Tiền của tôi|Hàng hóa|Doanh nghiệp vươn mình|Khoa học công nghệ|Hoạt động Bộ KH&CN|Chuyển đổi số|Đổi mới sáng tạo|AI|Vũ trụ|Thế giới tự nhiên|Thiết bị|Cửa sổ tri thức|Sáng kiến khoa học|Góc nhìn|Chính trị & chính sách|Y tế & sức khỏe|Kinh doanh & quản trị|Giáo dục & tri thức|Môi trường|Văn hóa|Giải trí|Thể thao|Pháp luật|Du lịch|Sức khỏe|Đời sống|Xe|Ý kiến|Tâm sự|Tự động xác định vị trí|- \[x\]|Chọn mặc định|Mặc định|Xem)\s*$/iu.test(line) ||
            /^[-*+]\s+\[(?:Hà Nội|TP HCM|Đà Nẵng|An Giang|Vũng Tàu|Côn Đảo|Bạc Liêu|Bắc Giang|Bắc Kạn|Bắc Ninh|Bến Tre|Bình Dương|Bình Định|Bình Phước|Bình Thuận|Phú Quý|Cà Mau|Cao Bằng|Cần Thơ|Đắk Lắk|Đắk Nông|Điện Biên|Đồng Nai|Đồng Tháp|Gia Lai|Hà Giang|Hà Nam|Hà Tĩnh|Hải Dương|Hải Phòng|Hậu Giang|Hòa Bình|Mai Châu|Hưng Yên|Khánh Hòa|Kiên Giang|Kon Tum|Lai Châu|Lâm Đồng|Lạng Sơn|Lào Cai|Long An|Nam Định|Nghệ An|Ninh Bình|Ninh Thuận|Phú Thọ|Phú Yên|Quảng Bình|Quảng Nam|Quảng Ngãi|Quảng Ninh|Quảng Trị|Sóc Trăng|Sơn La|Tây Ninh|Thái Bình|Thái Nguyên|Thanh Hóa|Thừa Thiên Huế|Tiền Giang|Trà Vinh|Tuyên Quang|Vĩnh Long|Vĩnh Phúc|Yên Bái)\]/iu.test(line) ||
            /^[-*+]\s+\[Trở lại\s+[^\]]+\]\([^)]+\)/iu.test(line) ||
            /^\[Trở lại\s+[^\]]+\]\([^)]+\)/iu.test(line)
        );

        if (!isNavLine && (line.startsWith('#') || line.length >= 150 || /^(?:Thứ [hai|ba|tư|năm|sáu|bảy|chủ nhật]|Ngày\s+\d)/iu.test(line))) {
            break;
        }

        if (isNavLine) {
            startLineIndex++;
        } else {
            let nextNavCount = 0;
            for (let k = startLineIndex + 1; k < Math.min(startLineIndex + 6, lines.length); k++) {
                const nextL = lines[k].trim();
                if (nextL.startsWith('* [') || nextL.startsWith('- [') || /^(?:Hà Nội|TP HCM|Đà Nẵng|Xem|Mặc định|Chọn mặc định)/iu.test(nextL)) {
                    nextNavCount++;
                }
            }
            if (nextNavCount >= 2) {
                startLineIndex++;
            } else {
                break;
            }
        }
    }

    return lines.slice(startLineIndex).join('\n').trim();
}

function parseJinaReaderText(text, url) {
    const titleMatch = String(text).match(/^Title:\s*(.+)$/m);
    const dateMatch = String(text).match(/^Published Time:\s*(.+)$/m);
    const marker = 'Markdown Content:';
    const markerIndex = String(text).indexOf(marker);
    let markdown = markerIndex >= 0 ? String(text).slice(markerIndex + marker.length).trim() : String(text).trim();
    const title = titleMatch ? normalizeArticleTitle(titleMatch[1]) : '';

    if (title) {
        const titleHeadingIndex = markdown.indexOf('# ' + title);
        if (titleHeadingIndex >= 0) {
            markdown = markdown.slice(titleHeadingIndex);
        } else {
            markdown = stripJinaLeadingNavigation(markdown, title);
        }
    } else {
        markdown = stripJinaLeadingNavigation(markdown, '');
    }

    let readerType = 'article';
    try {
        let sourceHandler = sourceRegistry.getHandler(url);
        if (sourceHandler && sourceHandler.parseJinaReaderText) {
            let handled = sourceHandler.parseJinaReaderText(markdown);
            if (handled) {
                markdown = handled.markdown;
                readerType = handled.readerType || readerType;
            }
        }
    } catch (e) { }

    const trimmed = trimJinaArticleMarkdown(markdown);
    markdown = trimmed.markdown;

    const allImages = [...markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1]);
    const validImage = allImages.find(img => !isInvalidImage(img) && !img.includes('avplayer.com')) || allImages.find(img => !isInvalidImage(img)) || '';
    let content = cleanArticleMarkup(jinaMarkdownToHtml(markdown));
    if (title) {
        const escapedTitle = escapeHtml(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        content = content.replace(new RegExp('^<h[1-3]>' + escapedTitle + '<\\/h[1-3]>', 'i'), '');
    }
    return {
        title,
        author: trimmed.author,
        date: dateMatch ? dateMatch[1].trim() : trimmed.extractedDate,
        image: validImage ? safeHttpUrl(validImage) : '',
        siteName: new URL(url).hostname.replace(/^www\./, ''),
        content,
        readerType,
        source: 'jina-reader'
    };
}

function parseOpenCliMarkdown(markdown, url) {
    let source = String(markdown || '')
        .replace(/^\s*>\s*原文链接:\s*https?:\/\/[^\n]+\n?/im, '')
        .replace(/^\s*---\s*$/m, '')
        .trim();
    const headingMatches = [...source.matchAll(/^#\s+(.+)$/gm)];
    const title = normalizeArticleTitle(headingMatches[0]?.[1] || '');
    if (title) {
        const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        source = source.replace(new RegExp('^#\\s+' + escaped + '\\s*$', 'gm'), '').trim();
    }
    const trimmed = trimJinaArticleMarkdown(source);
    source = trimmed.markdown;
    const content = cleanArticleMarkup(jinaMarkdownToHtml(source));
    const allImages = [...source.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1]);
    const validImage = allImages.find(img => !isInvalidImage(img) && !img.includes('avplayer.com')) || allImages.find(img => !isInvalidImage(img)) || '';
    return {
        title,
        author: trimmed.author,
        date: trimmed.extractedDate,
        image: validImage ? safeHttpUrl(validImage) : '',
        siteName: new URL(url).hostname.replace(/^www\./, ''),
        content,
        readerType: 'browser-reader',
        source: 'opencli'
    };
}

async function fetchViaOpenCli(url) {
    const executable = path.resolve('./node_modules/.bin/opencli');
    const { stdout } = await execFileAsync(executable, [
        'web', 'read', '--url', url,
        '--stdout', 'true',
        '--download-images', 'false',
        '--wait', '3',
        '--window', 'background'
    ], {
        timeout: 45000,
        maxBuffer: 12 * 1024 * 1024
    });
    const parsed = parseOpenCliMarkdown(stdout, url);
    const textLength = parsed.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
    if (textLength < 200 && !/<(?:img|video|audio)\b/i.test(parsed.content)) {
        throw new Error('OpenCLI returned too little article content');
    }
    return parsed;
}

async function fetchViaJina(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const canonicalUrl = String(url).replace(/\/unread\/?(?:[?#].*)?$/i, '');
        const response = await fetch(JINA_READER_BASE + canonicalUrl, {
            signal: controller.signal,
            headers: { Accept: 'text/plain' }
        });
        if (!response.ok) throw new Error('Jina Reader returned HTTP ' + response.status);
        const parsed = parseJinaReaderText(await response.text(), url);
        const textLength = parsed.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
        const hasMedia = /<(?:img|video|audio)\b/i.test(parsed.content);
        const minimumLength = parsed.readerType === 'forum-post' ? 40 : 200;
        if (textLength < minimumLength && !hasMedia) throw new Error('Jina Reader returned too little article text');
        return parsed;
    } finally {
        clearTimeout(timeout);
    }
}

const app = express();
app.use(express.json());
app.use('/public', express.static('public'));
app.use('/api', (req, res, next) => {
    if (!req.path.startsWith('/og-image')) {
        res.setHeader('Cache-Control', 'no-cache');
    }
    next();
});
const PORT = process.env.PORT || 3000;
const DB_FILE = './database.json';
const SMART_DB_FILE = './smart-data.json';
const SMART_KEYS = new Set(['smartClusters', 'smartRawArticles', 'smartCandidateLinks', 'smartCandidateSignature', 'smartAiConfig', 'smartClusterVersion', 'smartStatus']);
const DB_WRITER_LOCK_FILE = './database.writer.lock';
const DB_BACKUP_DIR = './db_backups';
const MAX_RECOVERY_SNAPSHOTS = 12;
const RECOVERY_SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CF_PROXY_BASE = 'https://rss-proxy.k1d.workers.dev/?url=';

async function acquireDatabaseWriterLock() {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const handle = await fs.open(DB_WRITER_LOCK_FILE, 'wx');
            await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
            return handle;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            let ownerPid = 0;
            try { ownerPid = Number(JSON.parse(await fs.readFile(DB_WRITER_LOCK_FILE, 'utf-8')).pid || 0); } catch (e) { }
            let ownerAlive = false;
            if (ownerPid > 0) {
                try { process.kill(ownerPid, 0); ownerAlive = true; } catch (e) { }
            }
            if (ownerAlive) throw new Error(`Database writer lock is already held by process ${ownerPid}`);
            await fs.unlink(DB_WRITER_LOCK_FILE).catch(() => {});
        }
    }
    throw new Error('Could not acquire the database writer lock');
}

const databaseWriterLock = !process.env.SKIP_DB_LOCK ? await acquireDatabaseWriterLock() : null;
process.on('exit', () => {
    try {
        const owner = JSON.parse(readFileSync(DB_WRITER_LOCK_FILE, 'utf-8'));
        if (Number(owner.pid) === process.pid) unlinkSync(DB_WRITER_LOCK_FILE);
    } catch (e) { }
});

// --- DATABASE LAYER: IN-MEMORY WITH WRITE-THROUGH PERSISTENCE ---
// The in-memory cache is the source of truth. Disk writes are best-effort persistence.
// This eliminates ALL race conditions and file corruption issues permanently.

let _dbCache = null;           // In-memory database (source of truth once loaded)
let _jsonParsedCache = {};     // Cache for parsed JSON strings (e.g. smartClusters) to avoid CPU-heavy parsing on tab clicks
let _smartClustersHistory = {}; // Version -> clusters history to prevent mid-session flickering on Smart tab
let _dbMutexQueue = Promise.resolve();
let _lastRecoverySnapshotAt = 0;
const FEEDS_BACKUP_FILE = './feeds_backup.json';  // Separate redundant backup for feeds

function withDbLock(fn) {
    let release;
    const prev = _dbMutexQueue;
    _dbMutexQueue = new Promise(r => release = r);
    return prev.then(fn).finally(release);
}

function _parseStoredArray(snapshot, key) {
    const value = snapshot?.[key];
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return null;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
        return null;
    }
}

function _validateDatabaseSnapshot(snapshot, requireCriticalKeys = true) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { ok: false, reason: 'Top level is not an object' };
    for (const key of ['articles', 'feeds']) {
        if (!(key in snapshot)) {
            if (requireCriticalKeys) return { ok: false, reason: `Missing ${key}` };
            continue;
        }
        const val = snapshot[key];
        if (!val || (typeof val !== 'string' && !Array.isArray(val))) return { ok: false, reason: `${key} is not a valid array or string` };
    }
    return { ok: true };
}

async function _writeJsonAtomic(filename, value) {
    const tempFile = `${filename}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        if (typeof value === 'string') JSON.parse(serialized); // Refuse to place invalid JSON on disk.
        await fs.writeFile(tempFile, serialized, 'utf-8');
        await fs.rename(tempFile, filename);
        if (serialized.length > 5000000 && global.gc) global.gc();
    } catch (error) {
        await fs.unlink(tempFile).catch(() => {});
        throw error;
    }
}

async function _readValidSnapshot(filename) {
    try {
        const parsed = JSON.parse(await fs.readFile(filename, 'utf-8'));
        const validation = _validateDatabaseSnapshot(parsed, true);
        if (!validation.ok) throw new Error(validation.reason);
        return parsed;
    } catch (error) {
        console.error(`[DB WARNING] ${filename} is not usable:`, error.message);
        return null;
    }
}

async function _recoverySnapshotFiles() {
    try {
        const entries = await fs.readdir(DB_BACKUP_DIR);
        return entries
            .filter(name => /^database-.*\.json$/.test(name))
            .sort()
            .reverse()
            .map(name => path.join(DB_BACKUP_DIR, name));
    } catch (e) {
        return [];
    }
}

async function _loadDBFromDisk() {
    let mainSnapshot = await _readValidSnapshot(DB_FILE);
    if (!mainSnapshot) {
        const filenames = [DB_FILE + '.backup', ...await _recoverySnapshotFiles()];
        for (const filename of filenames) {
            const snapshot = await _readValidSnapshot(filename);
            if (snapshot) {
                console.log(`[DB SAFETY] Restored database from ${filename}`);
                try { await _writeJsonAtomic(DB_FILE, snapshot); } catch (error) {}
                mainSnapshot = snapshot;
                break;
            }
        }
    }
    if (!mainSnapshot) {
        console.log('[DB INFO] No valid database found. Starting a new database.');
        mainSnapshot = { articles: '[]', feeds: '[]' };
    }
    try {
        const smartSnapshot = JSON.parse(await fs.readFile(SMART_DB_FILE, 'utf-8'));
        if (smartSnapshot && typeof smartSnapshot === 'object') {
            Object.assign(mainSnapshot, smartSnapshot);
        }
    } catch (e) {
        const smartData = {};
        let hasSmartInMain = false;
        for (const k of SMART_KEYS) {
            if (k in mainSnapshot && mainSnapshot[k] !== undefined) {
                smartData[k] = mainSnapshot[k];
                hasSmartInMain = true;
            }
        }
        if (hasSmartInMain) {
            console.log('[DB MIGRATION] Separating smart data out of database.json into smart-data.json...');
            try {
                await _writeJsonAtomic(SMART_DB_FILE, smartData);
                const cleanedMain = {};
                for (const k in mainSnapshot) if (!SMART_KEYS.has(k)) cleanedMain[k] = mainSnapshot[k];
                await _writeJsonAtomic(DB_FILE, cleanedMain);
                console.log('[DB MIGRATION] Successfully separated smart data into smart-data.json!');
            } catch (err) {
                console.error('[DB MIGRATION ERROR]', err.message);
            }
        }
    }
    return mainSnapshot;
}

async function _createRecoverySnapshot(snapshot) {
    const validation = _validateDatabaseSnapshot(snapshot, true);
    if (!validation.ok || Date.now() - _lastRecoverySnapshotAt < RECOVERY_SNAPSHOT_INTERVAL_MS) return;
    await fs.mkdir(DB_BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await _writeJsonAtomic(path.join(DB_BACKUP_DIR, `database-${stamp}.json`), snapshot);
    _lastRecoverySnapshotAt = Date.now();
    const files = await _recoverySnapshotFiles();
    for (const oldFile of files.slice(MAX_RECOVERY_SNAPSHOTS)) {
        await fs.unlink(oldFile).catch(() => {});
    }
}

async function _persistToDisk(data, previousData, updatedKey = null) {
    if (updatedKey && SMART_KEYS.has(updatedKey)) {
        const smartData = {};
        for (const k of SMART_KEYS) if (k in data && data[k] !== undefined) smartData[k] = data[k];
        if (previousData) {
            const prevSmartData = {};
            for (const k of SMART_KEYS) if (k in previousData && previousData[k] !== undefined) prevSmartData[k] = previousData[k];
            if (Object.keys(prevSmartData).length > 0) {
                await _writeJsonAtomic(SMART_DB_FILE + '.backup', prevSmartData).catch(() => {});
            }
        }
        await _writeJsonAtomic(SMART_DB_FILE, smartData);
        return;
    }

    const mainData = {};
    for (const k in data) if (!SMART_KEYS.has(k) && data[k] !== undefined) mainData[k] = data[k];

    const validation = _validateDatabaseSnapshot(mainData, true);
    if (!validation.ok) throw new Error(`Refusing unsafe database write: ${validation.reason}`);

    if (previousData) {
        const prevMainData = {};
        for (const k in previousData) if (!SMART_KEYS.has(k) && previousData[k] !== undefined) prevMainData[k] = previousData[k];
        if (_validateDatabaseSnapshot(prevMainData, true).ok) {
            await _writeJsonAtomic(DB_FILE + '.backup', prevMainData);
            await _createRecoverySnapshot(prevMainData).catch(error => {
                console.error('[DB WARNING] Could not create rotating recovery snapshot:', error.message);
            });
        }
    }
    await _writeJsonAtomic(DB_FILE, mainData);
}

// Separately backup feeds to a dedicated file for extra safety
async function _backupFeeds(feedsStr, previousFeedsStr = null) {
    try {
        if (previousFeedsStr) await _writeJsonAtomic(FEEDS_BACKUP_FILE + '.backup', previousFeedsStr);
        await _writeJsonAtomic(FEEDS_BACKUP_FILE, feedsStr);
    } catch (e) {
        console.error('[DB WARNING] Could not update dedicated feed backup:', e.message);
    }
}

// Recover feeds from the dedicated backup file
async function _recoverFeeds() {
    for (const filename of [FEEDS_BACKUP_FILE, FEEDS_BACKUP_FILE + '.backup']) {
        try {
            const feeds = JSON.parse(await fs.readFile(filename, 'utf-8'));
            if (Array.isArray(feeds) && feeds.length > 0) {
                console.log(`[DB SAFETY] Recovered ${feeds.length} feeds from ${filename}`);
                return JSON.stringify(feeds);
            }
        } catch (e) { }
    }
    return null;
}

const env = {
    RSS_DATA: {
        get: async (key, opts) => {
            if (!_dbCache) {
                await withDbLock(async () => {
                    if (!_dbCache) _dbCache = await _loadDBFromDisk();
                });
            }
            let val = _dbCache[key];
            if (!val) return null;
            if (opts && opts.type === 'json' && typeof val === 'string') {
                if (_jsonParsedCache[key]?.raw === val) return _jsonParsedCache[key].parsed;
                const parsed = JSON.parse(val);
                _jsonParsedCache[key] = { raw: val, parsed };
                return parsed;
            }
            return val;
        },
        put: (key, value, options = {}) => withDbLock(async () => {
            delete _jsonParsedCache[key];
            if (!_dbCache) _dbCache = await _loadDBFromDisk();
            const previous = _dbCache;
            const next = { ...previous, [key]: value };

            if (['feeds', 'articles', 'smartRawArticles', 'smartClusters', 'blockedArticleKeywords'].includes(key)) {
                const oldItems = _parseStoredArray(previous, key) || [];
                const newItems = _parseStoredArray(next, key);
                if (!newItems) throw new Error(`[DB SAFETY] ${key} write is not a valid array`);
                if (oldItems.length > 0 && newItems.length === 0) {
                    throw new Error(`[DB SAFETY] Refusing to wipe ${oldItems.length} ${key}`);
                }
                const destructiveDrop = oldItems.length >= 20 && newItems.length < Math.ceil(oldItems.length * 0.1);
                if (destructiveDrop && !options.allowLargeReduction) {
                    throw new Error(`[DB SAFETY] Refusing unexpected ${key} reduction from ${oldItems.length} to ${newItems.length}`);
                }
            }

            if (key === 'feeds') {
                const oldFeeds = _parseStoredArray(previous, key) || [];
                const newFeeds = _parseStoredArray(next, key) || [];
                const destructiveDrop = oldFeeds.length >= 3 && newFeeds.length < Math.ceil(oldFeeds.length * 0.5);
                if (destructiveDrop && !options.allowLargeReduction) {
                    throw new Error(`[DB SAFETY] Refusing unexpected feed reduction from ${oldFeeds.length} to ${newFeeds.length}`);
                }
                await _backupFeeds(JSON.stringify(newFeeds), oldFeeds.length ? JSON.stringify(oldFeeds) : null);
            }

            _dbCache = next;
            try {
                await _persistToDisk(next, previous, key);
            } catch (err) {
                _dbCache = previous; // rollback on failure
                throw err;
            }
        })
    },
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD
};

// --- BROWSER DISGUISE HEADERS ---
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,vi-VN;q=0.8,vi;q=0.7',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
};

// Helper to fetch a URL while manually following redirects and persisting cookies.
// Needed for sites like qdnd.vn that do a 302 back to the same URL with a Set-Cookie.
async function fetchWithCookies(targetUrl, timeoutMs = 8000, maxRedirects = 5) {
    let currentUrl = targetUrl;
    let cookie = '';
    for (let i = 0; i < maxRedirects; i++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const options = {
            redirect: 'manual',
            headers: { ...BROWSER_HEADERS },
            signal: controller.signal
        };
        if (cookie) options.headers['Cookie'] = cookie;

        const res = await fetch(currentUrl, options);
        clearTimeout(timeout);

        if (res.status >= 300 && res.status < 400) {
            const setCookie = res.headers.get('set-cookie');
            if (setCookie) {
                // Keep all cookie key=value pairs, ignore the directives like Domain=
                const cookieParts = setCookie.split(/,\s*(?=[^;]+?=)/);
                const combinedCookies = cookieParts.map(c => c.split(';')[0]).join('; ');
                cookie = combinedCookies;
            }
            currentUrl = res.headers.get('location') || currentUrl;
            if (!currentUrl.startsWith('http')) currentUrl = new URL(currentUrl, targetUrl).href;
        } else if (res.ok) {
            return await res.text();
        } else {
            let errorBody = '';
            try {
                errorBody = await res.text();
                errorBody = errorBody.substring(0, 200).replace(/[\n\r\t]+/g, ' ').trim();
            } catch (e) { }
            throw new Error(`HTTP ${res.status} ${res.statusText}${errorBody ? ` | ${errorBody}` : ''}`);
        }
    }
    throw new Error('Too many redirects');
}

// ============================================================================
// 📋 IN-MEMORY LOG BUFFER & FETCH HISTORY (24h retention)
// ============================================================================

const MAX_LOG_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const systemLogs = [];       // { timestamp, level, message }
const fetchHistory = [];     // { timestamp, feedUrl, feedTitle, status, details, durationMs }

function pruneOldEntries(arr) {
    const cutoff = Date.now() - MAX_LOG_AGE_MS;
    while (arr.length > 0 && arr[0].timestamp < cutoff) arr.shift();
}

// Intercept console.log/error to capture into the ring buffer
const _origLog = console.log.bind(console);
const _origError = console.error.bind(console);

console.log = (...args) => {
    _origLog(...args);
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    systemLogs.push({ timestamp: Date.now(), level: 'info', message: msg });
    if (systemLogs.length > 5000) pruneOldEntries(systemLogs);
};

console.error = (...args) => {
    _origError(...args);
    const msg = args.map(a => typeof a === 'string' ? a : (a instanceof Error ? a.message : JSON.stringify(a))).join(' ');
    systemLogs.push({ timestamp: Date.now(), level: 'error', message: msg });
    if (systemLogs.length > 5000) pruneOldEntries(systemLogs);
};

function recordFetch(feedUrl, feedTitle, status, details = '', durationMs = 0, extra = {}) {
    const entry = { timestamp: Date.now(), feedUrl, feedTitle, status, details, durationMs };
    // Attach extra context for error entries (httpStatus, responseSnippet, etc.)
    if (status === 'error' && extra) {
        if (extra.httpStatus) entry.httpStatus = extra.httpStatus;
        if (extra.responseSnippet) entry.responseSnippet = extra.responseSnippet;
        if (extra.errorType) entry.errorType = extra.errorType;
    }
    fetchHistory.push(entry);
    if (fetchHistory.length > 5000) pruneOldEntries(fetchHistory);
}

// Sync pause/resume control
let syncPaused = false;
let lastSyncCompletedAt = null;
const manualSyncProgress = new Map();

function setManualSyncProgress(requestId, stage, message, extra = {}) {
    if (!requestId) return;
    manualSyncProgress.set(requestId, {
        stage,
        message,
        done: false,
        ...extra,
        updatedAt: new Date().toISOString()
    });
}

function finishManualSyncProgress(requestId, message, extra = {}) {
    if (!requestId) return;
    manualSyncProgress.set(requestId, {
        stage: extra.failed ? 'error' : 'complete',
        message,
        done: true,
        ...extra,
        updatedAt: new Date().toISOString()
    });
    const cleanup = setTimeout(() => manualSyncProgress.delete(requestId), 2 * 60 * 1000);
    if (cleanup.unref) cleanup.unref();
}

function decodeHTMLEntities(text) {
    if (!text) return '';
    return text.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
        .replace(/&#x([a-fA-F0-9]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&quot;/ig, '"')
        .replace(/&apos;/ig, "'")
        .replace(/&lt;/ig, '<')
        .replace(/&gt;/ig, '>')
        .replace(/&amp;/ig, '&')
        .replace(/&nbsp;/ig, ' ')
        .replace(/&rsquo;/ig, '’')
        .replace(/&lsquo;/ig, '‘')
        .replace(/&rdquo;/ig, '”')
        .replace(/&ldquo;/ig, '“')
        .replace(/&mdash;/ig, '—')
        .replace(/&ndash;/ig, '–');
}

function normalizeArticleTitle(value) {
    let title = String(value || '').trim();
    // Some feeds escape entities more than once (for example &amp;#039;).
    // Decode repeatedly, then remove feed-provided Markdown emphasis wrappers.
    for (let pass = 0; pass < 3; pass++) {
        const decoded = decodeHTMLEntities(title);
        if (decoded === title) break;
        title = decoded;
    }
    return title.replace(/^\*\*([\s\S]*?)\*\*$/, '$1').trim();
}

function fastParseRSS(xml) {
    const items = [];
    const itemRegex = /<(item|entry)[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;
    let count = 0;

    let feedTitle = null;
    const headerMatch = xml.split(/<(item|entry)/i)[0];
    if (headerMatch) {
        const titleMatch = headerMatch.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch) {
            feedTitle = decodeHTMLEntities(titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim());
        }
    }

    while ((match = itemRegex.exec(xml)) !== null && count < 20) {
        const block = match[2];

        const getTag = (tag) => {
            const reg = new RegExp(`<(${tag})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
            const m = block.match(reg);
            if (m) return m[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();

            const nsReg = new RegExp(`<([a-z0-9]+:${tag})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
            const nsM = block.match(nsReg);
            if (nsM) return nsM[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();

            return null;
        };

        const rawTitle = getTag('title');
        const title = rawTitle ? normalizeArticleTitle(rawTitle) : 'Untitled Article';

        let link = getTag('link');
        if (!link || link.includes('<')) {
            const linkMatch = block.match(/<link[^>]+href=["']([^"']+)["']/i);
            if (linkMatch) link = linkMatch[1];
        }
        if (link && link.startsWith('<![CDATA[')) {
            link = link.replace(/^<!\[CDATA\[/i, '').replace(/\]\]>$/, '').trim();
        }

        const pubDate = getTag('pubDate') || getTag('updated') || getTag('published') || new Date().toISOString();
        let rawContent = getTag('content:encoded') || getTag('content') || getTag('description') || getTag('summary') || '';

        let imageUrl = null;
        const encMatch = block.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image\//i);
        if (encMatch) imageUrl = encMatch[1];

        if (!imageUrl) {
            const mediaMatch = block.match(/<(?:media:content|media:thumbnail)[^>]+url=["']([^"']+)["']/i);
            if (mediaMatch) imageUrl = mediaMatch[1];
        }

        // Extract image from raw content HTML BEFORE stripping tags
        if (!imageUrl) {
            const imgMatch = rawContent.match(/<img[^>]+src=["']([^"']+)["']/i);
            if (imgMatch) imageUrl = imgMatch[1];
        }

        let content = decodeHTMLEntities(rawContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

        let replyCount = 0;
        const slashComments = getTag('slash:comments');
        if (slashComments) replyCount = parseInt(slashComments) || 0;

        if (link) {
            items.push({ title, link, pubDate, content, imageUrl, replyCount });
            count++;
        }
    }
    return { items, feedTitle };
}

function parseMorningstar(html) {
    console.log(`\n[MORNINGSTAR DEBUG] Extracting data from Nuxt payload...`);
    const items = [];
    let matchCount = 0;

    try {
        const rawScript = html.split('window.__NUXT__=')[1];
        if (!rawScript) {
            throw new Error('Could not find window.__NUXT__ script.');
        }

        const scriptText = rawScript.split('</script>')[0].trim();
        const code = `
            const window = {};
            window.__NUXT__ = ${scriptText.endsWith(';') ? scriptText.slice(0, -1) : scriptText};
            return window.__NUXT__;
        `;

        const nuxtData = new Function(code)();
        const stories = nuxtData?.data?.[0]?.stories || [];

        console.log(`[MORNINGSTAR DEBUG] Found ${stories.length} stories in Nuxt data.`);

        for (const story of stories) {
            if (matchCount >= 20) break;

            const title = story.headline?.title || 'No Title';
            const link = `https://www.morningstar.com${story.canonicalURL || ''}`;
            const pubDate = story.displayDate || new Date().toISOString();

            let imageUrl = null;
            if (story.promoItems?.image?.variations?.['16:9']?.srcset) {
                const srcset = story.promoItems.image.variations['16:9'].srcset;
                const match = srcset.match(/([^,\s]+)\s+960w/);
                if (match) imageUrl = match[1];
            }
            if (!imageUrl && story.promoItems?.image?.src) {
                imageUrl = story.promoItems.image.src;
            }

            const contentSnippet = story.headline?.subtitle || story.headline?.metaDescription || title;

            items.push({
                title: decodeHTMLEntities(title),
                link: link,
                pubDate: pubDate,
                content: contentSnippet,
                imageUrl: imageUrl,
                customPublisher: 'Morningstar',
                customIcon: 'https://www.morningstar.com/favicon.ico'
            });
            matchCount++;
        }
    } catch (e) {
        console.error(`[MORNINGSTAR DEBUG] 🔴 Error parsing Nuxt data: ${e.message}`);
    }

    if (items.length === 0) {
        console.log(`[MORNINGSTAR DEBUG] Falling back to HTML regex extraction...`);
        const articleRegex = /<a\s+href=["']([^"']+)["'][^>]*mdc-basic-feed-item__mdc[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = articleRegex.exec(html)) !== null && matchCount < 20) {
            let link = match[1];
            if (!link.startsWith('http')) {
                let domain = 'https://www.morningstar.com';
                if (html.includes('https://global.morningstar.com')) {
                    domain = 'https://global.morningstar.com';
                }
                link = domain + (link.startsWith('/') ? '' : '/') + link;
            }

            const contentBlock = match[2];
            const titleMatch = contentBlock.match(/<h[234][^>]*>.*?<span itemprop=["']name["']>([\s\S]*?)<\/span>/i) || contentBlock.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/i);
            let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'No Title';

            const imgMatch = contentBlock.match(/<img[^>]*src=["']([^"']+)["'][^>]*mdc-basic-feed-item__image__mdc/i) || contentBlock.match(/<img[^>]*src=["']([^"']+)["']/i);
            let imageUrl = imgMatch ? imgMatch[1] : null;

            const bodyMatch = contentBlock.match(/<div[^>]*class=["'][^"']*mdc-basic-feed-item__body__mdc[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
            let body = bodyMatch ? bodyMatch[1].replace(/<[^>]+>/g, '').trim() : decodeHTMLEntities(title);
            if (!body) body = decodeHTMLEntities(title);

            items.push({
                title: decodeHTMLEntities(title),
                link: link,
                pubDate: new Date().toISOString(),
                content: body,
                imageUrl: imageUrl,
                customPublisher: 'Morningstar',
                customIcon: 'https://www.morningstar.com/favicon.ico'
            });
            matchCount++;
        }
        console.log(`[MORNINGSTAR DEBUG] Found ${items.length} stories via HTML regex.`);
    }

    if (items.length === 0) {
        console.log(`[MORNINGSTAR DEBUG] Falling back to Markdown / General link extraction...`);
        const seenLinks = new Set();
        
        // Match Markdown links: e.g., [![Img](imgUrl) ### Title...](linkUrl) or [Title...](linkUrl)
        const mdRegex = /\[(?:!\[[^\]]*\]\(([^)]+)\)\s*)?(?:#{1,4}\s*)?([^\]]+)\]\((https?:\/\/(?:www\.|global\.)?morningstar\.[^)]+|\/[^)]+)\)/gi;
        let match;
        while ((match = mdRegex.exec(html)) !== null && items.length < 20) {
            let imageUrl = match[1] || null;
            let rawText = match[2].trim();
            let link = match[3].split('?')[0].split('#')[0];
            if (link.startsWith('/')) link = 'https://www.morningstar.com' + link;

            if (link.includes('/indexes/') || link.includes('/login') || link.includes('/search') || link.includes('/tools/') || link.includes('/portfolio') || link.includes('/topics/')) continue;
            if (rawText.length < 15 || rawText === 'Morningstar' || rawText === 'View All') continue;
            if (seenLinks.has(link)) continue;
            seenLinks.add(link);

            let title = rawText.replace(/^#{1,4}\s*/, '').trim();
            let contentSnippet = title;
            if (title.length > 110) {
                const splitIndex = title.search(/[\.\?!]\s|[A-Z][a-z]+ \d{1,2}, \d{4}/);
                if (splitIndex > 20 && splitIndex < 110) {
                    contentSnippet = title;
                    title = title.substring(0, splitIndex + 1).trim();
                } else {
                    title = title.substring(0, 100) + '...';
                }
            }

            items.push({
                title: decodeHTMLEntities(title),
                link: link,
                pubDate: new Date().toISOString(),
                content: decodeHTMLEntities(contentSnippet),
                imageUrl: imageUrl,
                customPublisher: 'Morningstar',
                customIcon: 'https://www.morningstar.com/favicon.ico'
            });
        }

        // If Markdown didn't yield items, match general HTML article links
        if (items.length === 0) {
            const htmlLinkRegex = /<a[^>]+href=["'](https?:\/\/(?:www\.|global\.)?morningstar\.[^"']+|\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
            while ((match = htmlLinkRegex.exec(html)) !== null && items.length < 20) {
                let link = match[1].split('?')[0].split('#')[0];
                if (link.startsWith('/')) link = 'https://www.morningstar.com' + link;

                if (link.includes('/indexes/') || link.includes('/login') || link.includes('/search') || link.includes('/tools/') || link.includes('/portfolio') || link.includes('/topics/')) continue;
                if (seenLinks.has(link)) continue;

                const innerHtml = match[2];
                const textOnly = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                if (textOnly.length < 15 || textOnly === 'Morningstar' || textOnly === 'View All') continue;
                seenLinks.add(link);

                let imageUrl = null;
                const imgMatch = innerHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
                if (imgMatch) imageUrl = imgMatch[1];

                items.push({
                    title: decodeHTMLEntities(textOnly.length > 110 ? textOnly.substring(0, 100) + '...' : textOnly),
                    link: link,
                    pubDate: new Date().toISOString(),
                    content: decodeHTMLEntities(textOnly),
                    imageUrl: imageUrl,
                    customPublisher: 'Morningstar',
                    customIcon: 'https://www.morningstar.com/favicon.ico'
                });
            }
        }
        console.log(`[MORNINGSTAR DEBUG] Found ${items.length} stories via Markdown/General link extraction.`);
    }

    return { items, feedTitle: 'Morningstar' };
}

function parseK(str) {
    if (!str) return 0;
    str = str.toString().toUpperCase().replace(/,/g, '');
    if (str.endsWith('K')) return parseFloat(str) * 1000;
    if (str.endsWith('M')) return parseFloat(str) * 1000000;
    return parseInt(str) || 0;
}

async function scrapeVozViews(forumUrl) {
    const threadMap = new Map();

    async function scrapePage(url) {
        try {
            const fetchUrl = CF_PROXY_BASE + encodeURIComponent(url);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12000);
            const res = await fetch(fetchUrl, {
                headers: BROWSER_HEADERS,
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (res.ok) {
                const html = await res.text();

                // Split into individual thread blocks using the structItem divs
                const blockRegex = /<div class="structItem[^"]*js-threadListItem-(\d+)"[\s\S]*?(?=<div class="structItem[^"]*js-threadListItem-|$)/g;
                let blockMatch;
                while ((blockMatch = blockRegex.exec(html)) !== null) {
                    const threadId = blockMatch[1];
                    const block = blockMatch[0];

                    // Skip sticky/pinned threads
                    if (block.includes('structItem-status--sticky')) {
                        continue;
                    }

                    // Extract createDate from <time> tag
                    const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
                    // Extract replies (first <dd>) and views (second <dd> in structItem-minor)
                    const statsMatch = block.match(/<dl class="pairs pairs--justified">[\s\S]*?<dd>([\d,KBM]+)<\/dd>[\s\S]*?<dl class="pairs pairs--justified structItem-minor">[\s\S]*?<dd>([\d,KBM]+)<\/dd>/);

                    if (timeMatch && statsMatch) {
                        threadMap.set(threadId, {
                            createDate: timeMatch[1],
                            replies: parseK(statsMatch[1]),
                            views: parseK(statsMatch[2])
                        });
                    }
                }
            }
        } catch (e) {
            console.error(`[VOZ SCRAPER ERROR] Failed to scrape ${url}: ${e.message}`);
        }
    }

    // Scrape page 1
    await scrapePage(forumUrl);

    // If we got fewer than 15 non-sticky threads, also scrape page 2 for more candidates
    if (threadMap.size < 15) {
        const page2Url = forumUrl.endsWith('/') ? forumUrl + '?page=2' : forumUrl + '&page=2';
        await scrapePage(page2Url);
    }

    return threadMap;
}

function parseUOBVN(html) {
    const items = [];
    try {
        const cardRegex = /<div class="card [^>]*>[\s\S]*?<img[^>]*class="[^"]*card-img-top[^"]*"[^>]*src=["']([^"']+)["'][^>]*>[\s\S]*?<h4 class="card-title[^>]*>([\s\S]*?)<\/h4>[\s\S]*?<p class="paragraph">([\s\S]*?)<\/p>[\s\S]*?<a href=["']([^"']+)["'][^>]*class="dtm-button"/gi;
        let match;
        while ((match = cardRegex.exec(html)) !== null) {
            let imageUrl = match[1];
            if (imageUrl.startsWith('/')) imageUrl = 'https://www.uob.com.vn' + imageUrl;
            let title = match[2].trim();
            let content = match[3].trim();
            let link = match[4];
            if (link.startsWith('/')) link = 'https://www.uob.com.vn' + link;
            let pubDate = new Date().toISOString();
            
            let dateMatch = title.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
            if (dateMatch) {
                try { pubDate = new Date(`${dateMatch[1]} 1, ${dateMatch[2]}`).toISOString(); } catch(e) {}
            } else {
                dateMatch = title.match(/(1H|2H|Q1|Q2|Q3|Q4)\s+(\d{4})/i);
                if (dateMatch) {
                    try {
                        let month = 1;
                        let q = dateMatch[1].toUpperCase();
                        if (q === '2H' || q === 'Q3') month = 7;
                        else if (q === 'Q2') month = 4;
                        else if (q === 'Q4') month = 10;
                        pubDate = new Date(`${dateMatch[2]}-${month.toString().padStart(2, '0')}-01`).toISOString();
                    } catch(e) {}
                }
            }

            items.push({
                title: decodeHTMLEntities(title),
                link: link,
                pubDate: pubDate,
                content: decodeHTMLEntities(content),
                imageUrl: imageUrl,
                customPublisher: 'UOB VN Privilege',
                customIcon: 'https://icons.duckduckgo.com/ip3/uob.com.vn.ico'
            });
        }
    } catch (e) {
        console.error(`[UOB VN] Error parsing HTML: ${e.message}`);
    }

    const uniqueItems = [];
    const seenLinks = new Set();
    for (const item of items) {
        if (!seenLinks.has(item.link)) {
            seenLinks.add(item.link);
            uniqueItems.push(item);
        }
    }
    
    uniqueItems.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    return { items: uniqueItems.slice(0, 20), feedTitle: 'UOB Vietnam Market Insights' };
}

function parseUOB(csvString) {
    const items = [];
    try {
        let rows = [];
        let cur = '';
        let inQuote = false;
        const processRow = () => {
            if (rows.length >= 5) {
                let dateStr = rows[0].replace(/^"|"$/g, '').trim();
                let country = rows[1].replace(/^"|"$/g, '').trim();
                let url = rows[2].replace(/^"|"$/g, '').trim();
                let title = rows[3].replace(/^"|"$/g, '').trim();
                let desc = rows[4].replace(/^"|"$/g, '').trim();
                if (country.toLowerCase() === 'vietnam') {
                    let link = url.startsWith('/') ? 'https://www.uobgroup.com' + url : url;
                    let pubDate = new Date().toISOString();
                    try {
                        let d = new Date(dateStr);
                        if (!isNaN(d.getTime())) pubDate = d.toISOString();
                    } catch(e) {}
                    items.push({
                        title: decodeHTMLEntities(title),
                        link: link,
                        pubDate: pubDate,
                        content: decodeHTMLEntities(desc),
                        imageUrl: 'https://www.uobgroup.com/web-resources/common/images/uob-logo.jpg',
                        customPublisher: 'UOB Research',
                        customIcon: 'https://icons.duckduckgo.com/ip3/uobgroup.com.ico'
                    });
                }
            }
            rows = [];
            cur = '';
        };

        for (let i = 0; i < csvString.length; i++) {
            let c = csvString[i];
            if (c === '"') {
                inQuote = !inQuote;
            } else if (c === ',' && !inQuote) {
                rows.push(cur);
                cur = '';
            } else if (c === '\n' && !inQuote) {
                rows.push(cur);
                processRow();
            } else if (c !== '\r') {
                cur += c;
            }
        }
        if (cur || rows.length > 0) {
            rows.push(cur);
            processRow();
        }
    } catch (e) {
        console.error(`[UOB] Error parsing CSV: ${e.message}`);
    }
    items.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    return { items: items.slice(0, 20), feedTitle: 'UOB Research' };
}

function parseTechcombank(jsonString) {
    const items = [];
    try {
        const json = JSON.parse(jsonString);
        const docs = json?.data?.listViewDocumentFragmentList?.items || [];
        for (const doc of docs) {
            let title = doc.categoryTitle?.plaintext || doc.documentTitle?.plaintext || 'Techcombank Report';
            let link = doc.documentPath?._publishUrl || doc.externalDocumentPath || '';
            if (link && link.startsWith('/')) link = 'https://techcombank.com' + link;
            if (!link) continue;
            
            items.push({
                title: decodeHTMLEntities(title),
                link: link,
                pubDate: doc.date ? new Date(doc.date).toISOString() : new Date().toISOString(),
                content: `Category: ${doc.category || 'N/A'}<br>Title: ${title}`,
                imageUrl: 'https://techcombank.com/content/dam/techcombank/public-site/seo/techcombank-default-thumbnail.jpg',
                customPublisher: 'Techcombank Research',
                customIcon: 'https://icons.duckduckgo.com/ip3/techcombank.com.ico'
            });
        }
        
        items.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    } catch (e) {
        console.error(`[TECHCOMBANK] Error parsing JSON: ${e.message}`);
    }
    return { items: items.slice(0, 20), feedTitle: 'Techcombank Research' };
}

function parseBaoMoi(html) {
    const items = [];
    const seenLinks = new Set();
    let count = 0;
    let matchCount = 0;

    const articleRegex = /"title":"([^"\\]*(?:\\.[^"\\]*)*)".*?"redirectUrl":"(\/[^"]+\.epi[^"]*)".*?"thumb":"(https:\/\/[^"]+)"/gi;

    let match;
    while ((match = articleRegex.exec(html)) !== null) {
        matchCount++;
        if (count >= 20) break;

        try {
            let rawTitle = match[1];
            let title = rawTitle;
            try {
                title = JSON.parse(`"${rawTitle}"`);
            } catch (e) { }

            let link = match[2];
            link = link.split('#')[0];
            if (link.startsWith('/')) {
                link = 'https://baomoi.com' + link;
            }

            let imageUrl = match[3];

            if (!seenLinks.has(link)) {
                seenLinks.add(link);
                items.push({
                    title: decodeHTMLEntities(title),
                    link: link,
                    pubDate: new Date().toISOString(),
                    content: title,
                    imageUrl: imageUrl
                });
                count++;
            }
        } catch (err) { continue; }
    }
    return { items, feedTitle: 'Báo Mới' };
}

function cleanUrl(url) {
    if (!url) return '';
    try {
        let u = new URL(url);
        
        let sourceHandler = sourceRegistry.getHandler(url);
        if (sourceHandler && sourceHandler.cleanUrl) {
            let handledUrl = sourceHandler.cleanUrl(u);
            if (handledUrl) return handledUrl;
        }

        let params = new URLSearchParams(u.search);
        let keysToDelete = [];
        for (let key of params.keys()) {
            if (key.toLowerCase().startsWith('utm_') || key.toLowerCase() === 'ref') keysToDelete.push(key);
        }
        keysToDelete.forEach(k => params.delete(k));
        u.search = params.toString();
        return u.toString();
    } catch (e) {
        return url.split('?utm_')[0];
    }
}

const isInvalidImage = (url) => {
    if (!url || typeof url !== 'string' || url === 'null') return true;
    const lower = url.trim().toLowerCase();
    if (/^\d+$/.test(lower) || lower === 'image/jpeg' || lower === 'image/jpg' || lower === 'image/png' || lower === 'image/webp' || lower === 'image/gif') return true;
    if (!lower.startsWith('http://') && !lower.startsWith('https://') && !lower.startsWith('/') && !lower.startsWith('data:image')) return true;
    const dimMatch = lower.match(/\/(?:zoom|thumb)\/(\d+)_(\d+)\//);
    if (dimMatch && (parseInt(dimMatch[1]) < 300 || parseInt(dimMatch[2]) < 200)) return true;
    if (lower.includes('/36_36/') || lower.includes('/48_48/') || lower.includes('/60_60/') || lower.includes('/80_80/')) return true;
    return lower.includes('logo') || (lower.includes('avatar') && !/avatar\d{10}/.test(lower)) || lower.includes('author_default') || lower.includes('default_avatar') ||
        lower.includes('default-image') || lower.includes('default_image') || lower.includes('no-image') ||
        lower.includes('default.png') || lower.includes('default.jpg') || lower.includes('tto_default_avatar') ||
        lower.includes('tpo_social_share') || lower.includes('user-gray') || lower.includes('spinner') ||
        lower.includes('blank.gif') || lower.includes('smilie') || lower.includes('emoji') ||
        lower.includes('twemoji') || lower.includes('apple.com') || lower.startsWith('data:image') ||
        lower.includes('banner_gg_news') || lower.includes('/banner') || lower.includes('avplayer.com');
};

const decodeProxy = (url) => {
    if (url.includes('proxy.php?image=')) {
        try {
            const params = new URLSearchParams(url.split('?')[1]);
            if (params.get('image')) return params.get('image');
        } catch (e) { }
    }
    return url;
};

function extractImageFromHtml(html, baseUrl) {
    let foundImg = null;
    const checkCandidate = (candidate) => {
        if (!candidate) return null;
        let decoded = decodeProxy(candidate.replace(/&amp;/g, '&'));
        if (isInvalidImage(decoded)) return null;
        return decoded;
    };

    const metaTags = html.match(/<meta[^>]+>/ig) || [];
    for (let tag of metaTags) {
        if (/(property|name|itemprop)=["']?(og:image|twitter:image|twitter:image:src|image)["']?(?:\s|>|\/)/i.test(tag) && !tag.match(/image:(width|height|type|alt)/i)) {
            const contentMatch = tag.match(/content=["']([^"']+)["']/i);
            if (contentMatch && contentMatch[1]) {
                foundImg = checkCandidate(contentMatch[1]);
                if (foundImg) return foundImg;
            }
        }
    }

    const ldJsonMatches = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/ig);
    if (ldJsonMatches) {
        for (const block of ldJsonMatches) {
            try {
                const cleanJson = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
                const parsed = JSON.parse(cleanJson);
                const schemas = Array.isArray(parsed) ? parsed : [parsed];

                for (const schema of schemas) {
                    let candidate = null;
                    if (schema.image) {
                        if (typeof schema.image === 'string') candidate = schema.image;
                        else if (schema.image.url) candidate = schema.image.url;
                        else if (Array.isArray(schema.image) && schema.image.length > 0) {
                            candidate = typeof schema.image[0] === 'string' ? schema.image[0] : schema.image[0].url;
                        }
                    }
                    foundImg = checkCandidate(candidate);
                    if (foundImg) return foundImg;
                }
            } catch (e) { }
        }
    }

    const imgTags = html.match(/<img[^>]+>/ig) || [];
    for (let img of imgTags) {
        if (img.includes('bbImage') || img.includes('bbCodeBlockUnfurl-image') || img.includes('attachmentThumb')) {
            let srcMatch = img.match(/data-url=["']([^"']+)["']/i) || img.match(/data-src=["']([^"']+)["']/i) || img.match(/src=["']([^"']+)["']/i);
            if (srcMatch && srcMatch[1]) {
                foundImg = checkCandidate(srcMatch[1]);
                if (foundImg) return foundImg;
            }
        }
    }
    return null;
}

async function getBestImage(targetUrl, fetchFn, rssFallback = null) {
    try {

        let sourceHandler = sourceRegistry.getHandler(targetUrl);
        if (sourceHandler && sourceHandler.getBestImage) {
            let handledImg = await sourceHandler.getBestImage(targetUrl, fetchFn, rssFallback, { extractImageFromHtml, fetchWithCookies, isInvalidImage, CF_PROXY_BASE });
            if (handledImg === 'NO_FALLBACK') return null;
            if (handledImg) return handledImg;
        }

        let fetchUrl = CF_PROXY_BASE + encodeURIComponent(targetUrl);
        const res = await fetchFn(fetchUrl);
        if (!res.ok) {
            if (rssFallback && !isInvalidImage(rssFallback)) return rssFallback;
            return null;
        }
        let html = await res.text();
        let scopeHtml = html;


        let img = extractImageFromHtml(scopeHtml, targetUrl);
        if (img) return img.startsWith('/') ? new URL(img, targetUrl).href : img;

    } catch (e) {
        if (rssFallback && !isInvalidImage(rssFallback)) return rssFallback;
    }

    if (rssFallback && !isInvalidImage(rssFallback)) return rssFallback;
    return null;
}

async function fetchPdfCreationDate(url) {
    if (!url || !url.toLowerCase().includes('.pdf')) return null;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(url, { headers: { "Range": "bytes=-32768" }, signal: controller.signal });
        let text = "";
        let bytesRead = 0;
        if (res.body && typeof res.body.getReader === "function") {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                text += decoder.decode(value, { stream: true });
                bytesRead += value.length;
                const match = text.match(/CreationDate\s*\(\s*D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([-+\d'"Z]*)/);
                if (match) {
                    controller.abort();
                    clearTimeout(timeout);
                    let iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
                    let tz = match[7];
                    if (tz) {
                        if (tz.includes("Z")) iso += "Z";
                        else {
                            let signMatch = tz.match(/([-+])(\d{2})'?(\d{2})?'?/);
                            if (signMatch) iso += `${signMatch[1]}${signMatch[2]}:${signMatch[3] || "00"}`;
                            else iso += "Z";
                        }
                    } else iso += "Z";
                    let d = new Date(iso);
                    if (!isNaN(d.getTime())) return d.toISOString();
                    break;
                }
                if (bytesRead > 5 * 1024 * 1024) { // abort if more than 5MB downloaded to save time
                    controller.abort();
                    break;
                }
            }
        }
        clearTimeout(timeout);
    } catch(e) {}
    return null;
}

function publisherIcon(value) {
    let hostname = String(value || '').toLowerCase();
    try { hostname = new URL(hostname.includes('://') ? hostname : `https://${hostname}`).hostname.toLowerCase(); } catch (e) { }
    
    let sourceHandler = sourceRegistry.getHandler(hostname);
    if (sourceHandler && sourceHandler.publisherIcon) {
        let icon = sourceHandler.publisherIcon(hostname);
        if (icon) return icon;
    }
    
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
}

async function syncFeeds(env, targetFeedUrl = null, onProgress = null, targetCategory = null) {
    let rawFeeds = await env.RSS_DATA.get('feeds', { type: 'json' }) || [];
    const feeds = [];
    for (let f of rawFeeds) {
        let feedObj = typeof f === 'string' ? { url: f, title: new URL(f).hostname, category: 'Others' } : f;
        let cleanHostname = new URL(feedObj.url).hostname;
        if (cleanHostname.includes('cnbc')) cleanHostname = 'cnbc.com';
        if (cleanHostname.includes('dowjones') || cleanHostname.includes('dj.com') || cleanHostname.includes('wsj')) cleanHostname = 'wsj.com';
        if (cleanHostname.includes('bbc')) cleanHostname = 'bbc.com';
        feedObj.icon = publisherIcon(cleanHostname);
        if (!feedObj.category) feedObj.category = 'Others';
        feeds.push(feedObj);
    }

    let existingArticles = await env.RSS_DATA.get('articles', { type: 'json' }) || [];
    const historyImageMap = new Map();
    const historyDateMap = new Map();
    const historyStatsMap = new Map();
    for (const article of existingArticles) {
        if (article.image && !article.image.includes('/api/og-image')) historyImageMap.set(article.link, article.image);
        if (article.pubDate) historyDateMap.set(article.link, article.pubDate);
        historyStatsMap.set(article.link, {
            replyCount: article.replyCount || 0,
            viewCount: article.viewCount || 0,
            createDate: article.createDate || null
        });
    }

    let newArticles = [];
    let syncLogs = [];
    let feedsToSync = targetFeedUrl ? feeds.filter(f => f.url === targetFeedUrl) : targetCategory ? feeds.filter(f => (f.category || 'Others') === targetCategory) : feeds;

    for (let feedIndex = 0; feedIndex < feedsToSync.length; feedIndex++) {
        const feed = feedsToSync[feedIndex];
        if (onProgress) onProgress({
            stage: 'feeds',
            message: `Refreshing ${feed.title || new URL(feed.url).hostname}…`,
            current: feedIndex + 1,
            total: feedsToSync.length
        });

        if (!targetFeedUrl && feed.category === 'Macroeconomics') {
            const now = Date.now();
            if (!global.lastFetchTimeByUrl) global.lastFetchTimeByUrl = {};
            const lastFetch = global.lastFetchTimeByUrl[feed.url] || 0;
            if (now - lastFetch < 86400000 - 30000) {
                continue;
            }
        }

        const feedFetchStart = Date.now();
        try {
            let response;

            // ============================================================================
            // 🆕 MORNINGSTAR FETCH LOGIC — TRY ALL METHODS
            // ============================================================================
            if (feed.url.includes('morningstar.com') || feed.url.includes('morningstar.co.uk')) {
                if (!global.lastFetchTimeByUrl) global.lastFetchTimeByUrl = {};
                global.lastFetchTimeByUrl[feed.url] = Date.now();

                let fetchOptions = {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Accept': '*/*' }
                };

                let msHtml = null;
                let msMethod = '';

                // Method 1: Direct fetch with Googlebot UA
                try {
                    console.log(`[MORNINGSTAR DEBUG] Method 1: Direct fetch...`);
                    const directRes = await fetch(feed.url, fetchOptions);
                    if (directRes.ok) {
                        const text = await directRes.text();
                        if (text && text.length > 1000 && !text.includes('challenge.js')) {
                            msHtml = text;
                            msMethod = 'direct';
                            console.log(`[MORNINGSTAR DEBUG] ✅ Direct fetch succeeded (${text.length} bytes)`);
                        } else {
                            console.log(`[MORNINGSTAR DEBUG] ⚠️ Direct fetch returned WAF/challenge page`);
                        }
                    } else {
                        console.log(`[MORNINGSTAR DEBUG] ⚠️ Direct fetch HTTP ${directRes.status}`);
                    }
                } catch (e) {
                    console.log(`[MORNINGSTAR DEBUG] ⚠️ Direct fetch error: ${e.message}`);
                }

                // Method 2: CF Proxy
                if (!msHtml) {
                    try {
                        console.log(`[MORNINGSTAR DEBUG] Method 2: CF Proxy...`);
                        const cfRes = await fetch(CF_PROXY_BASE + encodeURIComponent(feed.url), fetchOptions);
                        if (cfRes.ok) {
                            const text = await cfRes.text();
                            if (text && text.length > 1000 && !text.includes('challenge.js')) {
                                msHtml = text;
                                msMethod = 'cf-proxy';
                                console.log(`[MORNINGSTAR DEBUG] ✅ CF Proxy succeeded (${text.length} bytes)`);
                            } else {
                                console.log(`[MORNINGSTAR DEBUG] ⚠️ CF Proxy returned WAF/challenge page`);
                            }
                        } else {
                            console.log(`[MORNINGSTAR DEBUG] ⚠️ CF Proxy HTTP ${cfRes.status}`);
                        }
                    } catch (e) {
                        console.log(`[MORNINGSTAR DEBUG] ⚠️ CF Proxy error: ${e.message}`);
                    }
                }

                // Method 3: Vietserver Proxy
                if (!msHtml && VIETSERVER_PROXY_BASE) {
                    try {
                        console.log(`[MORNINGSTAR DEBUG] Method 3: Vietserver Proxy...`);
                        const vsText = await fetchViaVietserver(feed.url);
                        if (vsText && vsText.length > 1000 && !vsText.includes('challenge.js')) {
                            msHtml = vsText;
                            msMethod = 'vietserver';
                            console.log(`[MORNINGSTAR DEBUG] ✅ Vietserver succeeded (${vsText.length} bytes)`);
                        } else {
                            console.log(`[MORNINGSTAR DEBUG] ⚠️ Vietserver returned insufficient content`);
                        }
                    } catch (e) {
                        console.log(`[MORNINGSTAR DEBUG] ⚠️ Vietserver error: ${e.message}`);
                    }
                }

                // Method 4: Jina Reader
                if (!msHtml) {
                    try {
                        console.log(`[MORNINGSTAR DEBUG] Method 4: Jina Reader...`);
                        const jinaUrl = `https://r.jina.ai/${feed.url}`;
                        const jinaController = new AbortController();
                        const jinaTimeout = setTimeout(() => jinaController.abort(), 15000);
                        const jinaRes = await fetch(jinaUrl, {
                            headers: { 'Accept': 'text/html' },
                            signal: jinaController.signal
                        });
                        clearTimeout(jinaTimeout);
                        if (jinaRes.ok) {
                            const text = await jinaRes.text();
                            if (text && text.length > 500) {
                                msHtml = text;
                                msMethod = 'jina';
                                console.log(`[MORNINGSTAR DEBUG] ✅ Jina Reader succeeded (${text.length} bytes)`);
                            } else {
                                console.log(`[MORNINGSTAR DEBUG] ⚠️ Jina Reader returned insufficient content`);
                            }
                        } else {
                            console.log(`[MORNINGSTAR DEBUG] ⚠️ Jina Reader HTTP ${jinaRes.status}`);
                        }
                    } catch (e) {
                        console.log(`[MORNINGSTAR DEBUG] ⚠️ Jina Reader error: ${e.message}`);
                    }
                }

                // Method 5: OpenCLI (browser-based, last resort)
                if (!msHtml) {
                    try {
                        console.log(`[MORNINGSTAR DEBUG] Method 5: OpenCLI web read...`);
                        const cliOutput = execSync(
                            `opencli web read --url ${JSON.stringify(feed.url)} --stdout --wait 5`,
                            { timeout: 30000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
                        );
                        if (cliOutput && cliOutput.length > 500) {
                            msHtml = cliOutput;
                            msMethod = 'opencli';
                            console.log(`[MORNINGSTAR DEBUG] ✅ OpenCLI succeeded (${cliOutput.length} bytes)`);
                        } else {
                            console.log(`[MORNINGSTAR DEBUG] ⚠️ OpenCLI returned insufficient content`);
                        }
                    } catch (e) {
                        console.log(`[MORNINGSTAR DEBUG] ⚠️ OpenCLI error: ${e.message}`);
                    }
                }

                if (msHtml) {
                    console.log(`[MORNINGSTAR DEBUG] 🎯 Using content from method: ${msMethod}`);
                    response = new Response(msHtml, { status: 200, headers: { 'Content-Type': 'text/html' } });
                } else {
                    console.error(`[MORNINGSTAR DEBUG] 🔴 ALL 5 fetch methods failed for ${feed.url}`);
                    syncLogs.push({ Feed: feed.title || feed.url, Issue: 'All fetch methods failed (direct, CF proxy, Vietserver, Jina, OpenCLI)' });
                    recordFetch(feed.url, feed.title || feed.url, 'error', 'All 5 fetch methods failed', Date.now() - feedFetchStart, { errorType: 'all-methods-failed' });
                    continue;
                }
            } else if (feed.url.includes('techcombank.com')) {
                // Techcombank loads data via GraphQL
                const apiUrl = 'https://techcombank.com/graphql/execute.json/techcombank/viewDocumentList%3BcfPath%3D/content/dam/techcombank/master-data/en/list-view-document/macroeconomics-en/';
                response = await fetch(apiUrl, { headers: BROWSER_HEADERS });
            } else if (feed.url.includes('uobgroup.com')) {
                const apiUrl = 'https://www.uobgroup.com/assets/web-resources/research/csv/archive/todays-focus/csv/macro-note.csv';
                response = await fetch(apiUrl, { headers: BROWSER_HEADERS });
            } else if (feed.url.includes('uob.com.vn')) {
                response = await fetch(feed.url, { headers: BROWSER_HEADERS });
            } else {
                // Default fetch logic for non-Morningstar sites
                let fetchUrl = feed.url;
                // Fix for Kenh14 changing their RSS URL structure
                if (fetchUrl === 'https://kenh14.vn/home.rss') fetchUrl = 'https://kenh14.vn/rss/home.rss';
                else if (fetchUrl === 'https://kenh14.vn/tin-moi-nhat.rss') fetchUrl = 'https://kenh14.vn/rss/tin-moi-nhat.rss';

                response = await fetch(fetchUrl, { headers: BROWSER_HEADERS });

                // If blocked by Cloudflare or WAF, fallback to our proxy
                if (response.status === 403 || response.status === 401 || response.status === 406) {
                    console.log(`[FETCH DEBUG] WAF Blocked Request (${response.status}) for ${fetchUrl}. Falling back to CF proxy...`);
                    response = await fetch(CF_PROXY_BASE + encodeURIComponent(fetchUrl), { headers: BROWSER_HEADERS });
                    if (!response.ok) {
                        console.log("[PROXY DEBUG] CF proxy failed for feed " + fetchUrl + ", trying Vietserver...");
                        try {
                            const vsHtml = await fetchViaVietserver(fetchUrl);
                            response = new Response(vsHtml, { status: 200, headers: { 'Content-Type': 'application/xml' } });
                        } catch (vsErr) {}
                    }
                }
            }

            if (!response.ok && response.status !== 202) {
                syncLogs.push({ Feed: feed.title || feed.url, Issue: `HTTP Error ${response.status}` });
                recordFetch(feed.url, feed.title || feed.url, 'error', `HTTP ${response.status}`, Date.now() - feedFetchStart, { httpStatus: response.status, errorType: 'http' });
                continue;
            }

            const xmlData = await response.text();
            let feedData;

            if (feed.url.includes('baomoi.com')) {
                // [BAO MOI LOGIC REMAINS UNCHANGED]
                console.log(`[BÁO MỚI DEBUG] Intercepted Request to: ${feed.url} | HTTP Status: ${response.status}`);
                try {
                    feedData = parseBaoMoi(xmlData);

                    feedData.items = await Promise.all(feedData.items.map(async (item, index) => {
                        try {
                            let fetchUrl = item.link;
                            if (fetchUrl.match(/-c(\d+)\.epi/i)) {
                                fetchUrl = fetchUrl.replace(/-c(\d+)\.epi/i, '-r$1.epi');
                            }
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 6000);
                            const res = await fetch(fetchUrl, {
                                method: 'GET',
                                headers: BROWSER_HEADERS,
                                redirect: 'follow',
                                signal: controller.signal
                            });
                            clearTimeout(timeoutId);

                            if (res.url && !res.url.includes('baomoi.com')) {
                                item.link = res.url;
                            } else {
                                const html = await res.text();
                                let finalUrl = null;

                                const isValidArticleUrl = (urlStr) => {
                                    try {
                                        let u = new URL(urlStr);
                                        let lower = urlStr.toLowerCase();
                                        return u.protocol.startsWith('http') &&
                                            !u.hostname.includes('baomoi.com') &&
                                            !u.hostname.includes('bmcdn.me') &&
                                            !u.hostname.includes('facebook.com') &&
                                            !u.hostname.includes('google.com') &&
                                            !lower.endsWith('.jpg') && !lower.endsWith('.jpeg') &&
                                            !lower.endsWith('.png') && !lower.endsWith('.webp') &&
                                            !lower.endsWith('.gif') && u.pathname.length > 15;
                                    } catch (e) { return false; }
                                };

                                const metaMatch = html.match(/url=['"]?(https:\/\/[^'"><\s]+)['"]?/i);
                                const jsMatch = html.match(/window\.location\.(?:replace|href|assign)\s*=?\s*["']([^"']+)["']/i);

                                if (metaMatch && isValidArticleUrl(metaMatch[1])) finalUrl = metaMatch[1];
                                else if (jsMatch && isValidArticleUrl(jsMatch[1])) finalUrl = jsMatch[1];

                                if (!finalUrl) {
                                    const jsonUrlMatches = html.matchAll(/"(?:originalUrl|url|link|targetUrl|sourceUrl)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi);
                                    for (let match of jsonUrlMatches) {
                                        try {
                                            let parsedUrl = JSON.parse(`"${match[1]}"`);
                                            if (!finalUrl && isValidArticleUrl(parsedUrl)) {
                                                finalUrl = parsedUrl;
                                            }
                                        } catch (e) { }
                                    }
                                }

                                let targetHtml = html;
                                let targetDomainUrl = item.link;

                                if (finalUrl) {
                                    item.link = finalUrl;
                                    targetDomainUrl = finalUrl;

                                    try {
                                        const directHtml = await fetchWithCookies(item.link, 6000);
                                        if (directHtml) targetHtml = directHtml;
                                        else throw new Error("HTTP_BLOCK");
                                    } catch (timeErr) {
                                        try {
                                            const proxyController = new AbortController();
                                            const proxyTimeout = setTimeout(() => proxyController.abort(), 8000);
                                            const proxyRes = await fetch(CF_PROXY_BASE + encodeURIComponent(item.link), {
                                                signal: proxyController.signal
                                            });
                                            clearTimeout(proxyTimeout);
                                            if (proxyRes.ok) targetHtml = await proxyRes.text();
                                            else {
                                                console.log("[PROXY DEBUG] CF proxy failed for " + item.link + ", trying Vietserver...");
                                                targetHtml = await fetchViaVietserver(item.link);
                                            }
                                        } catch (proxyErr) { }
                                    }
                                }

                                let pubTime = null;
                                let publisher = null;
                                let section = null;
                                let isFallback = (targetHtml === html);
                                let domainName = 'baomoi.com';
                                try { domainName = new URL(targetDomainUrl).hostname.replace('www.', ''); } catch (e) { }

                                if (!isFallback) {
                                    const metaTags = targetHtml.match(/<meta[^>]+>/ig) || [];
                                    let newTitle = null;
                                    const ogTitleMatch = targetHtml.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i) || targetHtml.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
                                    if (ogTitleMatch && ogTitleMatch[1]) newTitle = ogTitleMatch[1];

                                    if (!newTitle) {
                                        const h1Match = targetHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
                                        if (h1Match) {
                                            let h1Text = h1Match[1].replace(/<[^>]+>/g, '').trim();
                                            if (h1Text && h1Text.length > 10) newTitle = h1Text;
                                        }
                                    }

                                    if (!newTitle) {
                                        const titleMatch = targetHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
                                        if (titleMatch && titleMatch[1]) newTitle = titleMatch[1];
                                    }

                                    if (newTitle) item.title = decodeHTMLEntities(newTitle.trim());

                                    const ldJsonMatches = targetHtml.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/ig) || [];
                                    for (let block of ldJsonMatches) {
                                        try {
                                            const cleanJson = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').replace(/[\n\r\t]+/g, ' ').replace(/\\n/g, ' ').trim();
                                            const parsed = JSON.parse(cleanJson);
                                            const schemas = Array.isArray(parsed) ? parsed : [parsed];
                                            for (let schema of schemas) {
                                                if (schema.datePublished && !pubTime) pubTime = schema.datePublished;
                                                if (schema.publisher && schema.publisher.name && !publisher) {
                                                    let cand = schema.publisher.name.trim();
                                                    // Only accept human-readable names, reject raw URLs
                                                    if (!cand.startsWith('http') && !cand.toLowerCase().includes('.com') && !cand.toLowerCase().includes('.vn')) {
                                                        publisher = cand;
                                                    }
                                                }
                                                if (schema.articleSection && !section) section = schema.articleSection;

                                                if (schema['@type'] === 'BreadcrumbList' && schema.itemListElement) {
                                                    for (let breadcrumb of schema.itemListElement) {
                                                        if (breadcrumb.position === 2 && breadcrumb.item && breadcrumb.item.name) {
                                                            let breadText = breadcrumb.item.name.trim();
                                                            if (breadText && !section) section = breadText;
                                                        }
                                                    }
                                                }
                                            }
                                        } catch (e) { }
                                    }

                                    for (let tag of metaTags) {
                                        let contentMatch = tag.match(/content=["']([^"']+)["']/i);
                                        if (!contentMatch) continue;
                                        let content = contentMatch[1].trim();
                                        if (/(article:published_time|datepublished|pubdate|datecreated)/i.test(tag) && !pubTime) pubTime = content;
                                        if (/(og:site_name|sourceorganization|application-name)/i.test(tag) && !publisher) publisher = content;
                                        if (/(article:section|articlesection)/i.test(tag) && !section) section = content;
                                    }

                                    if (!pubTime) {
                                        const hardRegex = /(?:articlePublishDate|datePublished|publishDate|publish_date|dateCreated|post_date|published_at|created_at|publishedTime|news_date|time|display_time|ngaysuatban|article:published_time)[^>]{0,50}?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:\s*[+-]\d{2}:\d{2}|Z)?)/i;
                                        const hardMatch = targetHtml.match(hardRegex);
                                        if (hardMatch) pubTime = hardMatch[1];
                                    }

                                    if (!pubTime) {
                                        // Specific fallback for text-based DD/MM/YYYY - HH:mm (like hanoimoi.vn)
                                        const dateTextMatch = targetHtml.match(/(\d{2})\/(\d{2})\/(\d{4})\s*[-|]\s*(\d{2}):(\d{2})/i);
                                        if (dateTextMatch) {
                                            // Reformat to MM/DD/YYYY HH:mm+07:00 for reliable parsing
                                            pubTime = `${dateTextMatch[2]}/${dateTextMatch[1]}/${dateTextMatch[3]} ${dateTextMatch[4]}:${dateTextMatch[5]}+07:00`;
                                        }
                                    }

                                    if (!section) {
                                        const sectionMatchJSON = targetHtml.match(/"(?:category_name|articleSection|category|cate_name|cat_name|zone_name|chuyen_muc|cm_name|cate|chuyenmuc|categoryName|primary_category)"\s*:\s*"([^"\\]+)"/i);
                                        if (sectionMatchJSON) section = decodeHTMLEntities(sectionMatchJSON[1]).trim();
                                    }
                                }

                                if (pubTime) {
                                    let cleanTime = pubTime.replace(/&#x2B;/ig, '+').replace(/\s+([+-]\d{2}:\d{2})/g, '$1').trim();
                                    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?$/.test(cleanTime)) cleanTime += 'Z';
                                    else if (!cleanTime.includes('+') && !cleanTime.includes('-') && !cleanTime.toLowerCase().includes('z') && !cleanTime.toLowerCase().includes('gmt')) cleanTime += '+07:00';

                                    let parsedDate = new Date(cleanTime);
                                    if (!isNaN(parsedDate.getTime())) {
                                        // Auto-correct Vietnamese timezone bugs (e.g., site provides local time but appends "Z")
                                        if (parsedDate.getTime() > Date.now() + 5 * 60 * 1000) {
                                            parsedDate = new Date(parsedDate.getTime() - 7 * 60 * 60 * 1000);
                                        }

                                        // Allow slight future tolerance (1 hour) for server clock drift
                                        if (parsedDate.getTime() <= Date.now() + 60 * 60 * 1000 && parsedDate.getFullYear() > 2023) {
                                            item.pubDate = parsedDate.toISOString();
                                        }
                                    }
                                }

                                
                                // [PATCH] Auto-repair generic baomoi titles
                                if (item.title && (item.title.includes('Báo Mới') || item.title.includes('Tin tức 24H'))) {
                                    try {
                                        let u = new URL(item.link);
                                        let path = u.pathname.replace('.html', '').replace('.epi', '').replace('.htm', '');
                                        let segments = path.split('/').filter(Boolean);
                                        let slug = segments[segments.length - 1] || '';
                                        slug = slug.replace(/-\d+$/, '');
                                        let betterTitle = slug.replace(/-/g, ' ');
                                        betterTitle = betterTitle.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                                        if (betterTitle.length > 10) {
                                            item.title = betterTitle;
                                            if (item.content === item.title || item.content.includes('Báo Mới')) {
                                                item.content = betterTitle;
                                            }
                                        }
                                    } catch (e) {}
                                }

                                if (publisher) {
                                    // Strip protocols and www
                                    publisher = publisher.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/i, '').trim();

                                    // Reject if it has a domain extension
                                    if (/\.(vn|com|net|org|info|edu)(\.vn)?$/i.test(publisher)) {
                                        publisher = null;
                                    } else if (publisher.toLowerCase() === domainName.split('.')[0].toLowerCase()) {
                                        // Capitalize first letter if it was exactly the domain prefix without extension
                                        publisher = publisher.charAt(0).toUpperCase() + publisher.slice(1);
                                    }
                                }

                                // Only fallback to logo alt if we have NO publisher at all
                                if (!publisher) {
                                    if (domainName.toLowerCase().includes('baotintuc.vn')) {
                                        publisher = 'Báo Tin tức';
                                    } else {
                                        const logoAltMatch = targetHtml.match(/<img[^>]*logo[^>]*alt=["']([^"']+)["']/i) ||
                                            targetHtml.match(/<img[^>]*alt=["']([^"']+)["'][^>]*logo[^>]*>/i) ||
                                            targetHtml.match(/<a[^>]*logo[^>]*title=["']([^"']+)["']/i) ||
                                            targetHtml.match(/<title>.*?[-\|]\s*([^<]+)<\/title>/i);
                                        if (logoAltMatch) {
                                            publisher = decodeHTMLEntities(logoAltMatch[1]).trim();
                                        }
                                    }
                                }

                                if (publisher) {
                                    publisher = publisher.replace(/^(Báo điện tử|Báo|Tạp chí|Trang thông tin điện tử)\s+/i, '').trim();
                                    publisher = publisher.replace(/\s+News$/i, '').trim();
                                    if (publisher.includes('- Tin tức')) publisher = publisher.split('-')[0].trim();
                                    if (publisher.includes('|')) publisher = publisher.split('|')[0].trim();
                                    if (publisher === 'Mới' || publisher === 'Báo Mới') publisher = null;
                                }

                                let finalPublisher = publisher || domainName;
                                item.customPublisher = section ? `${finalPublisher} • ${section}` : finalPublisher;
                                let feedIconDomain = domainName;
                                if (feedIconDomain.includes('dj.com') || feedIconDomain.includes('wsj')) feedIconDomain = 'wsj.com';
                                if (feedIconDomain.includes('bbc')) feedIconDomain = 'bbc.com';
                                item.customIcon = publisherIcon(feedIconDomain);

                                // Explicitly define category
                                if (section) {
                                    item.categories = [section];
                                }
                            }
                        } catch (e) { }
                        return item;
                    }));

                } catch (parseErr) {
                    syncLogs.push({ Feed: feed.title || feed.url, Issue: `Báo Mới Scraper crashed: ${parseErr.message}` });
                    recordFetch(feed.url, feed.title || feed.url, 'error', `Scraper crash: ${parseErr.message}`, Date.now() - feedFetchStart, { errorType: 'scraper' });
                    continue;
                }
            } else if (feed.url.includes('morningstar.com')) {
                console.log(`[MORNINGSTAR DEBUG] Intercepted Request to: ${feed.url} | HTTP Status: ${response.status}`);
                feedData = parseMorningstar(xmlData);
            } else if (feed.url.includes('techcombank.com')) {
                console.log(`[TECHCOMBANK DEBUG] Intercepted Request to: ${feed.url} | HTTP Status: ${response.status}`);
                feedData = parseTechcombank(xmlData);
            } else if (feed.url.includes('uobgroup.com')) {
                console.log(`[UOB DEBUG] Intercepted Request to: ${feed.url} | HTTP Status: ${response.status}`);
                feedData = parseUOB(xmlData);
            } else if (feed.url.includes('uob.com.vn')) {
                console.log(`[UOB VN DEBUG] Intercepted Request to: ${feed.url} | HTTP Status: ${response.status}`);
                feedData = parseUOBVN(xmlData);
            } else {
                if (xmlData.trim().toLowerCase().startsWith('<!doctype html') || xmlData.trim().toLowerCase().startsWith('<html')) {
                    syncLogs.push({ Feed: feed.title || feed.url, Issue: 'Received HTML instead of XML.' });
                    recordFetch(feed.url, feed.title || feed.url, 'error', 'Received HTML instead of XML', Date.now() - feedFetchStart, { errorType: 'format' });
                    continue;
                }
                try {
                    feedData = fastParseRSS(xmlData);
                } catch (parseErr) {
                    syncLogs.push({ Feed: feed.title || feed.url, Issue: `XML Parser crashed: ${parseErr.message}` });
                    recordFetch(feed.url, feed.title || feed.url, 'error', `XML parse: ${parseErr.message}`, Date.now() - feedFetchStart, { errorType: 'parse' });
                    continue;
                }
            }

            try {
                const isVoz = feed.url.includes('voz.vn');
                if (feedData.feedTitle && (!feed.title || feed.title === new URL(feed.url).hostname || feed.title.startsWith('http'))) {
                    feed.title = feedData.feedTitle;
                }

                let scrapedViewsMap = new Map();
                if (isVoz) {
                    // Try to scrape forum pages to get views since RSS lacks them
                    // We deduce forum URL from RSS URL: voz.vn/f/diem-bao.33/index.rss -> voz.vn/f/diem-bao.33/
                    let forumUrl = feed.url.replace('/index.rss', '/');
                    scrapedViewsMap = await scrapeVozViews(forumUrl);
                }
                
                if (!global.lastFetchTimeByUrl) global.lastFetchTimeByUrl = {};
                global.lastFetchTimeByUrl[feed.url] = Date.now();

                let decodedGoogleNewsLinks = new Map();
                let googleNewsUrlsToDecode = [];
                if (feed.url.includes('news.google.com')) {
                    googleNewsUrlsToDecode = feedData.items.map(i => i.link).filter(l => l && l.includes('news.google.com/rss/articles/'));
                    if (googleNewsUrlsToDecode.length > 0) {
                        try {
                            const results = await googleDecoder.decodeBatch(googleNewsUrlsToDecode);
                            results.forEach((res, idx) => {
                                if (res.status) {
                                    decodedGoogleNewsLinks.set(googleNewsUrlsToDecode[idx], res.decoded_url);
                                }
                            });
                        } catch (e) {
                            console.error('[GOOGLE NEWS DECODE ERROR]', e.message);
                        }
                    }
                }

                for (const item of feedData.items) {
                    let safeLink = cleanUrl(item.link);
                    if (decodedGoogleNewsLinks.has(item.link)) {
                        safeLink = cleanUrl(decodedGoogleNewsLinks.get(item.link));
                        item.link = safeLink;
                    }
                    let threadIdMatch = safeLink.match(/\.(\d+)\//);
                    let threadId = threadIdMatch ? threadIdMatch[1] : null;

                    if (isVoz && threadId && scrapedViewsMap.has(threadId)) {
                        const stats = scrapedViewsMap.get(threadId);
                        item.viewCount = stats.views;
                        item.createDate = stats.createDate;
                        if (stats.replies > (item.replyCount || 0)) {
                            item.replyCount = stats.replies;
                        }
                    }
                    let rssImageUrl = item.imageUrl;
                    if (rssImageUrl && rssImageUrl.startsWith('/')) {
                        try { rssImageUrl = new URL(rssImageUrl, feed.url).href; } catch (e) { }
                    }
                    if (isInvalidImage(rssImageUrl)) rssImageUrl = null;
                    let finalImage = null;
                    if (!isVoz && rssImageUrl) finalImage = rssImageUrl;
                    if (!finalImage && historyImageMap.has(safeLink)) finalImage = historyImageMap.get(safeLink);

                    let finalTitle = item.customPublisher || feed.title;
                    if (finalTitle && finalTitle.startsWith('http')) {
                        finalTitle = feedData.feedTitle || new URL(feed.url).hostname;
                    }
                    let finalIcon = item.customIcon || feed.icon;

                    let normalizedPubDate = new Date().toISOString();
                    if (historyDateMap.has(safeLink)) {
                        normalizedPubDate = historyDateMap.get(safeLink);
                    } else if (item.pubDate) {
                        let parsedDate = new Date(item.pubDate);
                        if (!isNaN(parsedDate.getTime())) {
                            // If it's more than 5 mins in the future, it might be a Vietnamese local time parsed as UTC
                            if (parsedDate.getTime() > Date.now() + 5 * 60 * 1000) {
                                parsedDate = new Date(parsedDate.getTime() - 7 * 60 * 60 * 1000);
                            }
                            // Allow slight future tolerance (1 hour) for server clock drift
                            if (parsedDate.getTime() <= Date.now() + 60 * 60 * 1000) {
                                normalizedPubDate = parsedDate.toISOString();
                            }
                        }
                    }

                    // Backup: Use title as timeline for Macroeconomics
                    if (feed.category === 'Macroeconomics') {
                        let pdfDate = await fetchPdfCreationDate(safeLink);
                        if (pdfDate) {
                            normalizedPubDate = pdfDate;
                        } else {
                            let dateMatch = item.title.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
                            if (dateMatch) {
                                try {
                                    let extDate = new Date(`${dateMatch[1]} 1, ${dateMatch[2]}`);
                                    if (!isNaN(extDate.getTime())) normalizedPubDate = extDate.toISOString();
                                } catch(e) {}
                            } else {
                                dateMatch = item.title.match(/(1H|2H|Q1|Q2|Q3|Q4)\s+(\d{4})/i);
                                if (dateMatch) {
                                    try {
                                        let month = 1;
                                        let q = dateMatch[1].toUpperCase();
                                        if (q === '2H' || q === 'Q3') month = 7;
                                        else if (q === 'Q2') month = 4;
                                        else if (q === 'Q4') month = 10;
                                        let extDate = new Date(`${dateMatch[2]}-${month.toString().padStart(2, '0')}-01`);
                                        if (!isNaN(extDate.getTime())) normalizedPubDate = extDate.toISOString();
                                    } catch(e) {}
                                }
                            }
                        }
                    }

                    // Restore previous stats as fallback
                    let finalReplyCount = item.replyCount || 0;
                    let finalViewCount = item.viewCount || 0;
                    let finalCreateDate = item.createDate || null;
                    
                    if (historyStatsMap.has(safeLink)) {
                        const histStats = historyStatsMap.get(safeLink);
                        if (!finalReplyCount && histStats.replyCount) finalReplyCount = histStats.replyCount;
                        if (!finalViewCount && histStats.viewCount) finalViewCount = histStats.viewCount;
                        if (!finalCreateDate && histStats.createDate) finalCreateDate = histStats.createDate;
                    }

                    newArticles.push({
                        feedUrl: feed.url,
                        feedTitle: finalTitle,
                        feedIcon: finalIcon,
                        feedCategory: feed.category,
                        title: item.title,
                        link: safeLink,
                        image: finalImage,
                        rssFallbackMap: rssImageUrl,
                        pubDate: normalizedPubDate,
                        createDate: finalCreateDate,
                        content: item.content,
                        replyCount: finalReplyCount,
                        viewCount: finalViewCount
                    });
                }
                recordFetch(feed.url, feed.title || feed.url, 'success', `${feedData.items.length} articles`, Date.now() - feedFetchStart);
            } catch (parseErr) {
                syncLogs.push({ Feed: feed.title || feed.url, Issue: `XML Parser crashed: ${parseErr.message}` });
                recordFetch(feed.url, feed.title || feed.url, 'error', `Post-parse crash: ${parseErr.message}`, Date.now() - feedFetchStart, { errorType: 'post-parse' });
            }
        } catch (err) {
            syncLogs.push({ Feed: feed.title || feed.url, Issue: `Network Crash: ${err.message}` });
            recordFetch(feed.url, feed.title || feed.url, 'error', `Network: ${err.message}`, Date.now() - feedFetchStart, { errorType: 'network' });
        }
    }

    let allArticles = [...newArticles, ...existingArticles];

    for (let article of allArticles) {
        if (!article.image) {
            article.image = `/api/og-image?url=${encodeURIComponent(article.link.replace(/\/unread\/?$/, ''))}&rss=${encodeURIComponent(article.rssFallbackMap || '')}&icon=${encodeURIComponent(article.feedIcon)}`;
        }
        delete article.rssFallbackMap;
    }

    for (let i = 0; i < allArticles.length; i++) {
        allArticles[i]._ts = new Date(allArticles[i].pubDate).getTime() || 0;
    }
    allArticles.sort((a, b) => b._ts - a._ts);

    const uniqueArticles = [];
    const seenLinks = new Set();
    const seenTitles = new Set();
    for (const article of allArticles) {
        const titleKey = `${article.feedUrl}|${article.title.toLowerCase()}`;
        if (!seenLinks.has(article.link) && !seenTitles.has(titleKey)) {
            seenLinks.add(article.link);
            seenTitles.add(titleKey);
            delete article._ts;
            uniqueArticles.push(article);
        } else {
            // Keep the maximum view/reply count and createDate even if we skip the duplicate
            const existing = uniqueArticles.find(a => a.link === article.link || `${a.feedUrl}|${a.title.toLowerCase()}` === titleKey);
            if (existing) {
                if (article.replyCount > (existing.replyCount || 0)) existing.replyCount = article.replyCount;
                if (article.viewCount > (existing.viewCount || 0)) existing.viewCount = article.viewCount;
                if (article.createDate && !existing.createDate) existing.createDate = article.createDate;
            }
        }
    }

    const MAX_PER_SOURCE = 200;
    const feedCounts = {};
    const savedStatesForPruning = await env.RSS_DATA.get('savedStates', { type: 'json' }) || [];
    const boardStatesForPruning = await env.RSS_DATA.get('boardStates', { type: 'json' }) || [];
    const readStatesForPruning = await env.RSS_DATA.get('readStates', { type: 'json' }) || [];
    
    const latestArticles = uniqueArticles.filter(article => {
        if (savedStatesForPruning.includes(article.link) || boardStatesForPruning.includes(article.link) || readStatesForPruning.includes(article.link)) {
            const ageMs = Date.now() - (new Date(article.pubDate || 0).getTime() || 0);
            if (ageMs < 7 * 24 * 60 * 60 * 1000) return true;
        }
        const sourceUrl = article.feedUrl;
        if (!feedCounts[sourceUrl]) feedCounts[sourceUrl] = 0;
        if (feedCounts[sourceUrl] < MAX_PER_SOURCE) {
            feedCounts[sourceUrl]++;
            return true;
        }
        return false;
    });

    await env.RSS_DATA.put('articles', JSON.stringify(latestArticles));
    // State lists tied to the live feed should not retain links after the
    // article itself is rotated out. Read Later and Boards are intentional
    // archives, so they are deliberately never pruned here.
    try {
        const smartClusters = await env.RSS_DATA.get('smartClusters', { type: 'json' }) || [];
        const retainedLinks = new Set(latestArticles.map(article => article.link));
        for (const cluster of smartClusters) {
            if (cluster.link) retainedLinks.add(cluster.link);
            for (const related of cluster.relatedArticles || []) {
                if (related.link) retainedLinks.add(related.link);
            }
        }
        for (const listName of ['readStates', 'hiddenStates']) {
            const state = await env.RSS_DATA.get(listName, { type: 'json' }) || [];
            const pruned = state.filter(link => retainedLinks.has(link));
            if (pruned.length !== state.length) await env.RSS_DATA.put(listName, JSON.stringify(pruned));
        }
    } catch (error) {
        console.error('[STATE CLEANUP] Could not prune stale feed state:', error.message);
    }
    if (!targetFeedUrl) await env.RSS_DATA.put('feeds', JSON.stringify(feeds));

    return { success: true, logs: syncLogs };
}

const smartNews = createSmartNewsEngine({
    db: env.RSS_DATA,
    helpers: { fastParseRSS },
    headers: BROWSER_HEADERS
});

// ============================================================================
// EXPRESS ROUTES
// ============================================================================

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
    const memUsage = process.memoryUsage();
    res.json({
        status: 'ok',
        uptime: Math.round((Date.now() - processStartTime) / 1000),
        uptimeHuman: `${Math.floor((Date.now() - processStartTime) / 3600000)}h ${Math.floor(((Date.now() - processStartTime) % 3600000) / 60000)}m`,
        memory: {
            rss: `${(memUsage.rss / 1024 / 1024).toFixed(1)} MB`,
            heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB`,
            heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(1)} MB`,
            external: `${(memUsage.external / 1024 / 1024).toFixed(1)} MB`
        },
        syncPaused,
        lastSyncCompletedAt: lastSyncCompletedAt ? new Date(lastSyncCompletedAt).toISOString() : null,
        feedCount: fetchHistory.length > 0 ? new Set(fetchHistory.map(h => h.feedUrl)).size : 'unknown'
    });
});

const authMiddleware = (req, res, next) => {
    if (req.headers.cookie && req.headers.cookie.includes('auth=true')) {
        next();
    } else {
        res.status(401).send('Unauthorized');
    }
};

app.post('/api/login', (req, res) => {
    if (req.body.password === env.ADMIN_PASSWORD) {
        res.status(200).send('OK');
    } else {
        res.status(401).send('Unauthorized');
    }
});

function plainBlockedText(value) {
    return decodeHTMLEntities(String(value || '').replace(/<[^>]+>/g, ' '))
        .normalize('NFC')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeBlockedText(value) {
    return plainBlockedText(value).toLowerCase();
}

const BLOCKED_ARTICLE_FIELDS = [
    { key: 'title', label: 'Title' },
    { key: 'subtitle', label: 'Subtitle' },
    { key: 'subheadline', label: 'Subheadline' },
    { key: 'description', label: 'Description' },
    { key: 'excerpt', label: 'Excerpt' },
    { key: 'summary', label: 'Summary' },
    { key: 'contentSnippet', label: 'Excerpt' },
    { key: 'content', label: 'Article excerpt' }
];

function normalizeBlockedKeywordEntries(input) {
    const seen = new Set();
    return (Array.isArray(input) ? input : [])
        .map(value => {
            const keyword = String(value || '')
                .trim()
                .normalize('NFC')
                .toLocaleLowerCase('vi-VN');
            return { keyword, normalized: normalizeBlockedText(keyword) };
        })
        .filter(entry => {
            if (!entry.normalized || seen.has(entry.normalized)) return false;
            seen.add(entry.normalized);
            return true;
        });
}

function contentFilterFieldValues(article) {
    const seen = new Set();
    return BLOCKED_ARTICLE_FIELDS.map(field => {
        const text = plainBlockedText(article?.[field.key]);
        const signature = field.label + '\0' + text;
        if (!text || seen.has(signature)) return null;
        seen.add(signature);
        return { ...field, text, normalized: text.toLowerCase() };
    }).filter(Boolean);
}

function articleContentFilterMatches(article, keywordEntries, includeDetails = false) {
    if (!keywordEntries.length) return includeDetails ? [] : false;
    const fields = contentFilterFieldValues(article);
    if (!includeDetails) {
        return fields.some(field => keywordEntries.some(entry => field.normalized.includes(entry.normalized)));
    }

    const matches = [];
    for (const field of fields) {
        for (const entry of keywordEntries) {
            const index = field.normalized.indexOf(entry.normalized);
            if (index < 0) continue;
            const start = Math.max(0, index - 90);
            const end = Math.min(field.text.length, index + entry.normalized.length + 130);
            matches.push({
                field: field.key,
                fieldLabel: field.label,
                keyword: entry.keyword,
                snippet: (start ? '…' : '') + field.text.slice(start, end) + (end < field.text.length ? '…' : '')
            });
        }
    }
    return matches;
}

function combineContentFilterMatchDetails(details) {
    const combined = new Map();
    for (const detail of details) {
        const key = normalizeBlockedText(detail.keyword);
        if (!key) continue;
        const current = combined.get(key) || { keyword: detail.keyword, fieldLabels: [], snippet: '' };
        const previouslyOnlyTitle = current.fieldLabels.length === 1 && current.fieldLabels[0] === 'Title';
        if (!current.fieldLabels.includes(detail.fieldLabel)) current.fieldLabels.push(detail.fieldLabel);
        // Prefer an excerpt over repeating the title, then keep the most
        // informative available excerpt for this keyword.
        const detailIsTitle = detail.fieldLabel === 'Title';
        if (!current.snippet || (previouslyOnlyTitle && !detailIsTitle) || (!detailIsTitle && detail.snippet.length > current.snippet.length)) {
            current.snippet = detail.snippet;
        }
        combined.set(key, current);
    }
    return [...combined.values()];
}

function contentFilterPreviewLinkKey(value) {
    try {
        const parsed = new URL(value);
        parsed.hash = '';
        return parsed.href.replace(/\/$/, '');
    } catch (e) {
        return '';
    }
}

app.get('/api/content-filter-settings', authMiddleware, async (req, res) => {
    const stored = await env.RSS_DATA.get('blockedArticleKeywords', { type: 'json' }) || [];
    const keywords = normalizeBlockedKeywordEntries(stored).map(entry => entry.keyword);
    if (JSON.stringify(stored) !== JSON.stringify(keywords)) {
        await env.RSS_DATA.put('blockedArticleKeywords', JSON.stringify(keywords));
    }
    res.json({ keywords });
});

app.post('/api/content-filter-settings', authMiddleware, async (req, res) => {
    const keywords = normalizeBlockedKeywordEntries(req.body?.keywords).map(entry => entry.keyword);
    await env.RSS_DATA.put('blockedArticleKeywords', JSON.stringify(keywords));
    res.json({ ok: true, keywords });
});

app.post('/api/content-filter-preview', authMiddleware, async (req, res) => {
    const keywordEntries = normalizeBlockedKeywordEntries(req.body?.keywords);
    const requestedKeyword = normalizeBlockedKeywordEntries([req.body?.selectedKeyword])[0];
    const offset = Math.max(0, Math.floor(Number(req.body?.offset) || 0));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(req.body?.limit) || 50)));
    if (!keywordEntries.length) return res.json({ total: 0, overallTotal: 0, offset, limit, selectedKeyword: '', keywordTotals: [], matches: [] });

    const articles = await env.RSS_DATA.get('articles', { type: 'json' }) || [];
    const smartClusters = (await env.RSS_DATA.get('smartClusters', { type: 'json' }) || []).map(article => cleanStoredCluster(article));
    const candidates = [
        ...articles.map(article => ({ article, surface: 'Feed' })),
        ...smartClusters.map(article => ({ article, surface: 'Smart' }))
    ];
    const affected = [];
    const byLink = new Map();
    const bySignature = new Map();
    for (const candidate of candidates) {
        const details = articleContentFilterMatches(candidate.article, keywordEntries, true);
        if (!details.length) continue;
        const article = candidate.article;
        const title = normalizeArticleTitle(article.title) || 'Untitled article';
        const feedTitle = article.feedTitle || article.siteName || article.sourceName || (candidate.surface === 'Smart' ? 'Smart Briefing' : 'Unknown source');
        const pubDate = article.pubDate || article.date || article.createDate || '';
        const linkKey = contentFilterPreviewLinkKey(article.link || '');
        const timeKey = Number.isFinite(Date.parse(pubDate)) ? Math.floor(Date.parse(pubDate) / 60000) : '';
        const signature = [normalizeBlockedText(title), normalizeBlockedText(feedTitle), timeKey].join('|');
        let record = (linkKey && byLink.get(linkKey)) || bySignature.get(signature);
        if (!record) {
            record = {
                id: 'affected:' + (article.clusterId || linkKey || signature || affected.length),
                surfaces: [],
                title,
                link: safeHttpUrl(article.link || ''),
                feedTitle,
                feedIcon: safeHttpUrl(article.feedIcon || article.icon || ''),
                category: article.feedCategory || article.smartCategory || '',
                pubDate,
                rawMatches: []
            };
            affected.push(record);
        }
        if (!record.surfaces.includes(candidate.surface)) record.surfaces.push(candidate.surface);
        record.rawMatches.push(...details);
        if (linkKey) byLink.set(linkKey, record);
        bySignature.set(signature, record);
    }
    affected.forEach(record => {
        record.matches = combineContentFilterMatchDetails(record.rawMatches);
        delete record.rawMatches;
    });
    affected.sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));
    const groups = new Map(keywordEntries.map(entry => [entry.normalized, { keyword: entry.keyword, matches: [] }]));
    for (const record of affected) {
        for (const detail of record.matches) {
            const key = normalizeBlockedText(detail.keyword);
            const group = groups.get(key);
            if (!group) continue;
            group.matches.push({ ...record, id: record.id + ':' + key, matches: [detail] });
        }
    }
    const selectedKey = requestedKeyword && groups.has(requestedKeyword.normalized)
        ? requestedKeyword.normalized
        : keywordEntries[keywordEntries.length - 1].normalized;
    const selectedGroup = groups.get(selectedKey);
    const keywordTotals = [...groups.values()].map(group => ({ keyword: group.keyword, total: group.matches.length }));
    res.json({
        total: selectedGroup.matches.length,
        overallTotal: affected.length,
        offset,
        limit,
        selectedKeyword: selectedGroup.keyword,
        keywordTotals,
        matches: selectedGroup.matches.slice(offset, offset + limit)
    });
});

app.get('/api/smart-sources', authMiddleware, async (req, res) => {
    const sources = await smartNews.getSourceSettings();
    res.json({ sources });
});

app.post('/api/smart-sources', authMiddleware, async (req, res) => {
    try {
        const sources = await smartNews.addSource(req.body || {});
        res.json({ ok: true, sources });
    } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
    }
});

app.delete('/api/smart-sources', authMiddleware, async (req, res) => {
    try {
        const sources = await smartNews.removeSource(req.body?.url);
        res.json({ ok: true, sources });
    } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
    }
});

app.patch('/api/smart-sources', authMiddleware, async (req, res) => {
    try {
        const sources = await smartNews.setSourceEnabled(req.body?.url, req.body?.enabled !== false);
        res.json({ ok: true, sources });
    } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
    }
});

app.post('/api/smart-sources/discover', authMiddleware, async (req, res) => {
    try {
        const result = await smartNews.discoverSources(req.body || {});
        res.json({ ok: true, ...result });
    } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
    }
});

app.post('/api/smart-sources/reset', authMiddleware, async (req, res) => {
    try {
        const sources = await smartNews.resetSources();
        res.json({ ok: true, sources });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

const GOOGLE_NEWS_URL_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const GOOGLE_NEWS_URL_FAILURE_TTL_MS = 5 * 60 * 1000;
let googleNewsUrlCache = null;
let googleNewsUrlCacheSaveTimer = null;
const googleNewsUrlPending = new Map();
let googleNewsResolveStartQueue = Promise.resolve();
let googleNewsLastResolveStart = 0;
let _googleNewsCircuitBreakerUntil = 0;

async function scheduleGoogleNewsLookup(task) {
    if (Date.now() < _googleNewsCircuitBreakerUntil) {
        throw new Error('Google News rate limit (HTTP 429) active; circuit open');
    }
    const previous = googleNewsResolveStartQueue.catch(() => {});
    let release;
    googleNewsResolveStartQueue = new Promise(resolve => { release = resolve; });
    await previous;
    if (Date.now() < _googleNewsCircuitBreakerUntil) {
        release();
        throw new Error('Google News rate limit (HTTP 429) active; circuit open');
    }
    const waitMs = Math.max(0, 700 - (Date.now() - googleNewsLastResolveStart));
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    googleNewsLastResolveStart = Date.now();
    release();
    try {
        return await task();
    } catch (e) {
        if (e && (e.message?.includes('429') || e.status === 429)) {
            _googleNewsCircuitBreakerUntil = Date.now() + 120000;
        }
        throw e;
    }
}

function isGoogleNewsArticleUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.hostname === 'news.google.com' && /\/(?:rss\/)?articles\//.test(parsed.pathname);
    } catch (e) {
        return false;
    }
}

async function ensureGoogleNewsUrlCache() {
    if (!googleNewsUrlCache) googleNewsUrlCache = await env.RSS_DATA.get('googleNewsUrlCache', { type: 'json' }) || {};
    return googleNewsUrlCache;
}

function scheduleGoogleNewsUrlCacheSave() {
    if (googleNewsUrlCacheSaveTimer) return;
    googleNewsUrlCacheSaveTimer = setTimeout(async () => {
        googleNewsUrlCacheSaveTimer = null;
        try {
            const entries = Object.entries(googleNewsUrlCache || {})
                .sort((a, b) => Number(b[1]?.cachedAt || 0) - Number(a[1]?.cachedAt || 0))
                .slice(0, 3000);
            googleNewsUrlCache = Object.fromEntries(entries);
            await env.RSS_DATA.put('googleNewsUrlCache', JSON.stringify(googleNewsUrlCache));
        } catch (error) {
            console.error('[GOOGLE NEWS] Could not persist destination cache:', error.message);
        }
    }, 3000);
    if (googleNewsUrlCacheSaveTimer.unref) googleNewsUrlCacheSaveTimer.unref();
}

function findGoogleNewsResolvedUrl(node) {
    if (typeof node === 'string') {
        if (!node.includes('garturlres')) return '';
        try { return findGoogleNewsResolvedUrl(JSON.parse(node)); } catch (e) { return ''; }
    }
    if (!Array.isArray(node)) return '';
    if (node[0] === 'garturlres') return safeHttpUrl(node[1]);
    for (const child of node) {
        const found = findGoogleNewsResolvedUrl(child);
        if (found) return found;
    }
    return '';
}

async function decodeGoogleNewsArticleUrl(sourceUrl) {
    const articlePageUrl = sourceUrl.replace('/rss/articles/', '/articles/');
    const pageResponse = await fetch(articlePageUrl, { headers: BROWSER_HEADERS, redirect: 'follow' });
    if (!pageResponse.ok) throw new Error('Google News wrapper returned HTTP ' + pageResponse.status);
    if (pageResponse.url && !isGoogleNewsArticleUrl(pageResponse.url) && !/google\.com\/sorry\//i.test(pageResponse.url)) {
        return safeHttpUrl(pageResponse.url);
    }
    if (/google\.com\/sorry\//i.test(pageResponse.url || '')) throw new Error('Google News temporarily rate-limited destination lookup');
    const pageHtml = await pageResponse.text();
    const declaredUrl = decodeHTMLEntities(pageHtml.match(/<(?:link|meta)\b[^>]*(?:rel=(?:["'])canonical(?:["'])|property=(?:["'])og:url(?:["']))[^>]*(?:href|content)=(?:["'])(https?:\/\/[^"']+)(?:["'])/i)?.[1] || '');
    if (declaredUrl && !isGoogleNewsArticleUrl(declaredUrl) && !/google\.com\/sorry\//i.test(declaredUrl)) return safeHttpUrl(declaredUrl);
    const attribute = name => decodeHTMLEntities(pageHtml.match(new RegExp('\\s' + name + '=(?:"([^"]+)"|\'([^\']+)\')', 'i'))?.slice(1).find(Boolean) || '');
    const articleId = attribute('data-n-a-id') || sourceUrl.match(/\/(?:rss\/)?articles\/([^?]+)/)?.[1] || '';
    const timestamp = attribute('data-n-a-ts');
    const signature = attribute('data-n-a-sg');
    if (!articleId || !timestamp || !signature) throw new Error('Google News destination metadata was unavailable');

    const context = [
        ['en-US', 'US', ['FINANCE_TOP_INDICES', 'WEB_TEST_1_0_0'], null, null, 1, 1, 'US:en', null, 180, null, null, null, null, null, 0, null, null, [1608992183, 723341000]],
        'en-US', 'US', 1, [2, 3, 4, 8], 1, 0, '655000234', 0, 0, null, 0
    ];
    const innerRequest = JSON.stringify(['garturlreq', context, articleId, Number(timestamp), signature]);
    const form = new URLSearchParams({
        'f.req': JSON.stringify([[['Fbv4je', innerRequest, null, 'generic']]])
    });
    const rpcResponse = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
        method: 'POST',
        headers: {
            ...BROWSER_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        },
        body: form
    });
    if (!rpcResponse.ok) throw new Error('Google News destination lookup returned HTTP ' + rpcResponse.status);
    const rpcText = await rpcResponse.text();
    for (const line of rpcText.split(/\r?\n/).map(value => value.trim()).filter(value => value.startsWith('['))) {
        try {
            const resolved = findGoogleNewsResolvedUrl(JSON.parse(line));
            if (resolved && !isGoogleNewsArticleUrl(resolved)) return resolved;
        } catch (e) { }
    }
    throw new Error('Google News did not return a publisher destination');
}

function googleNewsPublisherDomain(hints = {}) {
    const candidates = [hints.domain, hints.sourceDomain];
    try {
        const feedUrl = new URL(hints.feedUrl || '');
        const query = feedUrl.searchParams.get('q') || '';
        const site = query.match(/(?:^|\s)site:([^\s)]+)/i)?.[1];
        if (site) candidates.push(site);
    } catch (e) { }
    const iconDomain = String(hints.feedIcon || '').match(/\/ip3\/([^/]+)\.ico/i)?.[1];
    if (iconDomain) candidates.push(iconDomain);
    for (const candidate of candidates) {
        let hostname = String(candidate || '').trim().toLowerCase().replace(/^www\./, '');
        try { hostname = new URL(hostname.includes('://') ? hostname : 'https://' + hostname).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { }
        if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(hostname) && hostname !== 'news.google.com' && hostname !== 'google.com') return hostname;
    }
    return '';
}

async function resolveGoogleNewsViaPublisherSearch(hints = {}) {
    const domain = googleNewsPublisherDomain(hints);
    let title = normalizeArticleTitle(hints.title || '').replace(/\s+-\s+[^-]{2,80}$/i, '').trim();
    if (!domain || title.length < 12) return '';
    const query = 'site:' + domain + ' "' + title.replace(/["\r\n]+/g, ' ') + '"';
    const response = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Publisher destination search returned HTTP ' + response.status);
    const html = await response.text();
    for (const match of html.matchAll(/(?:[?&]|&amp;)uddg=([^&"']+)/gi)) {
        let candidate = match[1];
        try { candidate = decodeURIComponent(decodeHTMLEntities(candidate)); } catch (e) { }
        const safe = safeHttpUrl(candidate);
        if (!safe) continue;
        const hostname = new URL(safe).hostname.toLowerCase().replace(/^www\./, '');
        if (hostname === domain || hostname.endsWith('.' + domain)) return safe;
    }
    return '';
}

async function resolveGoogleNewsUrl(sourceUrl, hints = {}, options = {}) {
    const original = safeHttpUrl(sourceUrl);
    if (!original || !isGoogleNewsArticleUrl(original)) return original || sourceUrl;
    const cache = await ensureGoogleNewsUrlCache();
    const cached = cache[original];
    const ttl = cached?.resolvedUrl ? GOOGLE_NEWS_URL_CACHE_TTL_MS : GOOGLE_NEWS_URL_FAILURE_TTL_MS;
    if (cached?.cachedAt && Date.now() - cached.cachedAt < ttl && (cached.resolvedUrl || !options.force)) return cached.resolvedUrl || original;
    if (googleNewsUrlPending.has(original)) {
        return options.backgroundResolve ? (cached?.resolvedUrl || original) : googleNewsUrlPending.get(original);
    }
    if (options.isSubItem && !cached?.resolvedUrl) {
        return cached?.resolvedUrl || original;
    }
    if (options.backgroundResolve && (Date.now() < _googleNewsCircuitBreakerUntil || googleNewsUrlPending.size > 15)) {
        return cached?.resolvedUrl || original;
    }

    const pending = (async () => {
        let resolvedUrl = '';
        let resolutionError = '';
        try {
            resolvedUrl = await scheduleGoogleNewsLookup(() => decodeGoogleNewsArticleUrl(original));
        } catch (error) {
            resolutionError = error.message;
        }
        if (!resolvedUrl) {
            try {
                resolvedUrl = await resolveGoogleNewsViaPublisherSearch(hints);
            } catch (error) {
                resolutionError += (resolutionError ? '; ' : '') + error.message;
            }
        }
        if (!resolvedUrl && resolutionError) console.error('[GOOGLE NEWS] Destination resolution failed:', resolutionError);
        cache[original] = { resolvedUrl, cachedAt: Date.now(), error: resolvedUrl ? '' : resolutionError };
        scheduleGoogleNewsUrlCacheSave();
        return resolvedUrl || original;
    })().finally(() => googleNewsUrlPending.delete(original));
    googleNewsUrlPending.set(original, pending);
    if (options.backgroundResolve) {
        return cached?.resolvedUrl || original;
    }
    return pending;
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const result = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            result[index] = await mapper(items[index], index);
        }
    });
    await Promise.all(workers);
    return result;
}

async function prepareArticleForClient(article, isSubItem = false) {
    const prepared = { ...article, title: normalizeArticleTitle(article.title) };
    if (isGoogleNewsArticleUrl(prepared.link)) {
        prepared.originalLink = prepared.link;
        prepared.link = await resolveGoogleNewsUrl(prepared.link, prepared, { backgroundResolve: true, isSubItem });
        if (!isGoogleNewsArticleUrl(prepared.link)) prepared.feedIcon = publisherIcon(prepared.link);
    }
    if (safeHttpUrl(prepared.link) && (!prepared.feedIcon || /icons\.duckduckgo\.com\/ip3\//i.test(prepared.feedIcon))) {
        prepared.feedIcon = publisherIcon(prepared.link);
    }
    if (Array.isArray(prepared.relatedArticles)) {
        prepared.relatedArticles = await mapWithConcurrency(prepared.relatedArticles, 4, a => prepareArticleForClient(a, true));
    }
    return prepared;
}

app.get('/api/data', authMiddleware, async (req, res) => {
    let feeds = await env.RSS_DATA.get('feeds', { type: 'json' }) || [];
    let allArticles = await env.RSS_DATA.get('articles', { type: 'json' }) || [];
    const readStates = await env.RSS_DATA.get('readStates', { type: 'json' }) || [];
    const savedStates = await env.RSS_DATA.get('savedStates', { type: 'json' }) || [];
    const boardStates = await env.RSS_DATA.get('boardStates', { type: 'json' }) || [];
    const hiddenStates = await env.RSS_DATA.get('hiddenStates', { type: 'json' }) || [];
    const categoryOrder = await env.RSS_DATA.get('categoryOrder', { type: 'json' }) || [];
    const userPreferences = await env.RSS_DATA.get('userPreferences', { type: 'json' }) || {};

    const blockedKeywords = await env.RSS_DATA.get('blockedArticleKeywords', { type: 'json' }) || [];
    const blockedKeywordEntries = normalizeBlockedKeywordEntries(blockedKeywords);
    const articleIsBlocked = article => articleContentFilterMatches(article, blockedKeywordEntries);
    const visibleArticles = allArticles.filter(article => !articleIsBlocked(article));

    const unreadCounts = { feeds: {}, categories: {}, total: 0 };
    visibleArticles.forEach(a => {
        if (!readStates.includes(a.link) && !hiddenStates.includes(a.link)) {
            unreadCounts.total++;
            unreadCounts.feeds[a.feedUrl] = (unreadCounts.feeds[a.feedUrl] || 0) + 1;
            let cat = a.feedCategory || 'Others';
            unreadCounts.categories[cat] = (unreadCounts.categories[cat] || 0) + 1;
        }
    });

    const filterType = req.query.filterType || 'today';
    const filterValue = req.query.filterValue || '';
    const hideRead = req.query.hideRead === 'true';
    const searchQuery = req.query.searchQuery ? req.query.searchQuery.toLowerCase() : '';

    let filteredArticles = visibleArticles;

    let smartClusterVersion = await env.RSS_DATA.get('smartClusterVersion') || '';
    if (filterType === 'smart') {
        const requestedVersion = req.query.smartVersion || '';
        let smartClusters = [];
        if (requestedVersion && _smartClustersHistory[requestedVersion]) {
            smartClusters = _smartClustersHistory[requestedVersion];
            smartClusterVersion = requestedVersion;
        } else {
            smartClusters = await env.RSS_DATA.get('smartClusters', { type: 'json' }) || [];
            smartClusters = smartClusters.map(article => cleanStoredCluster(article));
            if (smartClusterVersion) {
                _smartClustersHistory[smartClusterVersion] = smartClusters;
                const historyKeys = Object.keys(_smartClustersHistory);
                if (historyKeys.length > 6) delete _smartClustersHistory[historyKeys[0]];
            }
        }
        filteredArticles = smartClusters
            .map(article => cleanStoredCluster(article))
            .filter(article => !hiddenStates.includes(article.link) && !articleIsBlocked(article));
        if (filterValue === 'news') {
            filteredArticles = filteredArticles.filter(article => ['news_vietnam', 'news_world'].includes(article.smartCategory));
        } else if (filterValue === 'finance') {
            filteredArticles = filteredArticles.filter(article => ['finance_vietnam', 'finance_global'].includes(article.smartCategory));
        } else if (filterValue === 'tech') {
            const isInvestingCom = (art) => {
                if (!art) return false;
                const text = [art.link, art.feedUrl, art.url, art.feedTitle, art.sourceName, art.source, ...(Array.isArray(art.sources) ? art.sources : [])]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();
                return text.includes('investing.com');
            };
            filteredArticles = filteredArticles
                .filter(article => article.smartCategory === 'tech' && !isInvestingCom(article))
                .map(article => {
                    if (!Array.isArray(article.relatedArticles) || !article.relatedArticles.length) return article;
                    const cleanRelated = article.relatedArticles.filter(r => !isInvestingCom(r));
                    if (cleanRelated.length === article.relatedArticles.length) return article;
                    const sources = [...new Set([article.feedTitle, ...cleanRelated.map(r => r.feedTitle)].filter(Boolean))];
                    return {
                        ...article,
                        relatedArticles: cleanRelated,
                        clusterCount: cleanRelated.length + 1,
                        sourceCount: sources.length,
                        sources
                    };
                });
        } else if (filterValue) {
            filteredArticles = filteredArticles.filter(article => article.smartCategory === filterValue);
        }
        if (hideRead) {
            filteredArticles = filteredArticles.filter(article => !readStates.includes(article.link)).map(article => {
                if (!article.relatedArticles || !article.relatedArticles.length) return article;
                const unreadRelated = article.relatedArticles.filter(r => !readStates.includes(r.link));
                if (unreadRelated.length === article.relatedArticles.length) return article;
                const sources = [...new Set([article.feedTitle, ...unreadRelated.map(r => r.feedTitle)].filter(Boolean))];
                return {
                    ...article,
                    relatedArticles: unreadRelated,
                    clusterCount: unreadRelated.length + 1,
                    sourceCount: sources.length,
                    sources
                };
            });
        }
        filteredArticles.sort((a, b) =>
            (b.hotness || 0) - (a.hotness || 0) ||
            (b.sourceWeight || 1) - (a.sourceWeight || 1) ||
            (new Date(b.pubDate || 0).getTime()) - (new Date(a.pubDate || 0).getTime())
        );
    } else if (filterType === 'hidden') {
        filteredArticles = filteredArticles.filter(a => hiddenStates.includes(a.link))
            .sort((a, b) => hiddenStates.indexOf(b.link) - hiddenStates.indexOf(a.link));
    } else {
        filteredArticles = filteredArticles.filter(a => !hiddenStates.includes(a.link));
        if (filterType === 'recent') {
            const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            filteredArticles = filteredArticles
                .filter(a => readStates.includes(a.link) && (new Date(a.pubDate || 0).getTime() > oneWeekAgo))
                .sort((a, b) => readStates.indexOf(b.link) - readStates.indexOf(a.link));
        } else if (filterType === 'saved') {
            filteredArticles = filteredArticles.filter(a => savedStates.includes(a.link));
            if (hideRead) filteredArticles = filteredArticles.filter(a => !readStates.includes(a.link));
            filteredArticles.sort((a, b) => savedStates.indexOf(b.link) - savedStates.indexOf(a.link));
        } else if (filterType === 'board') {
            filteredArticles = filteredArticles.filter(a => boardStates.includes(a.link));
            if (hideRead) filteredArticles = filteredArticles.filter(a => !readStates.includes(a.link));
            filteredArticles.sort((a, b) => boardStates.indexOf(b.link) - boardStates.indexOf(a.link));
        } else if (filterType === 'category') {
            filteredArticles = filteredArticles.filter(a => a.feedCategory === filterValue || (filterValue === 'Others' && !a.feedCategory));
        } else if (filterType === 'feed') {
            filteredArticles = filteredArticles.filter(a => a.feedUrl === filterValue);
        } else if (filterType === 'hot_today' || filterType === 'hot_week' || filterType === 'views_today' || filterType === 'views_week') {
            // Use Vietnam timezone (UTC+7) for date comparison since Voz is a Vietnamese forum
            const VN_OFFSET = 7 * 60 * 60 * 1000;
            const nowVN = new Date(Date.now() + VN_OFFSET);

            const isTodayVN = (dateStr) => {
                if (!dateStr) return false;
                const d = new Date(new Date(dateStr).getTime() + VN_OFFSET);
                return d.getUTCDate() === nowVN.getUTCDate() && d.getUTCMonth() === nowVN.getUTCMonth() && d.getUTCFullYear() === nowVN.getUTCFullYear();
            };
            const isThisWeekVN = (dateStr) => {
                if (!dateStr) return false;
                const d = new Date(dateStr);
                return (Date.now() - d.getTime()) <= 7 * 24 * 60 * 60 * 1000;
            };

            const isTimeMatch = (filterType.includes('today')) ? isTodayVN : isThisWeekVN;
            
            // Sort by the relevant stat
            const sortFn = filterType.includes('views') 
                ? (a, b) => (b.viewCount || 0) - (a.viewCount || 0) || (b.replyCount || 0) - (a.replyCount || 0)
                : (a, b) => (b.replyCount || 0) - (a.replyCount || 0) || (b.viewCount || 0) - (a.viewCount || 0);

            // O(1) lookup sets for hidden/sticky exclusion
            const hiddenSet = new Set(hiddenStates);
            const stickyIds = new Set(['.1216621/', '.641432/', '.617079/']);
            const isStickyLink = (link) => { for (const id of stickyIds) if (link.includes(id)) return true; return false; };

            // Pre-filter articles by forum once (avoids scanning all 1500+ articles twice)
            const diemBaoPool = [];
            const chuyenTroPool = [];
            for (const a of allArticles) {
                if (!a.feedUrl || hiddenSet.has(a.link) || isStickyLink(a.link)) continue;
                if (a.feedUrl.includes('diem-bao.33')) diemBaoPool.push(a);
                else if (a.feedUrl.includes('chuyen-tro-linh-tinh-tm.17')) chuyenTroPool.push(a);
            }

            // Helper to guarantee exactly 5 articles from a pre-filtered pool
            const getTop5 = (pool) => {
                // Tier 1: Strict match for requested time window (Today or This Week)
                let tier1 = pool.filter(a => a.createDate && isTimeMatch(a.createDate));
                tier1.sort(sortFn);
                if (tier1.length >= 5) return tier1.slice(0, 5);

                // Tier 2 Fallback: Match This Week
                let chosenLinks = new Set(tier1.map(a => a.link));
                let tier2 = pool.filter(a => !chosenLinks.has(a.link) && (!a.createDate || isThisWeekVN(a.createDate)));
                tier2.sort(sortFn);
                let combined = [...tier1, ...tier2];
                if (combined.length >= 5) return combined.slice(0, 5);

                // Tier 3 Guaranteed Fill: Take ANY available non-sticky threads to guarantee 5 slots
                chosenLinks = new Set(combined.map(a => a.link));
                let tier3 = pool.filter(a => !chosenLinks.has(a.link));
                tier3.sort(sortFn);
                return [...combined, ...tier3].slice(0, 5);
            };

            filteredArticles = [...getTop5(diemBaoPool), ...getTop5(chuyenTroPool)];
            filteredArticles.sort(sortFn);
        }
        
        if (hideRead && filterType !== 'recent' && !filterType.startsWith('hot_') && !filterType.startsWith('views_')) {
            filteredArticles = filteredArticles.filter(a => !readStates.includes(a.link));
        }
    }

    if (searchQuery) {
        const matchesSearch = value => String(value || '').toLowerCase().includes(searchQuery);
        filteredArticles = filteredArticles.filter(a =>
            matchesSearch(a.title) ||
            matchesSearch(a.feedTitle) ||
            matchesSearch(a.content) ||
            (filterType === 'smart' && Array.isArray(a.relatedArticles) && a.relatedArticles.some(related =>
                matchesSearch(related.title) || matchesSearch(related.feedTitle)
            ))
        );
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 40;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const hasMore = endIndex < filteredArticles.length;
    const paginatedArticles = await mapWithConcurrency(filteredArticles.slice(startIndex, endIndex), 6, prepareArticleForClient);

    res.json({
        feeds,
        articles: paginatedArticles,
        readStates,
        savedStates,
        boardStates,
        hiddenStates,
        categoryOrder,
        userPreferences,
        hasMore,
        currentPage: page,
        unreadCounts,
        smartClusterVersion
    });
});

app.post('/api/sync', authMiddleware, async (req, res) => {
    let targetFeedUrl = req.body && req.body.feedUrl ? req.body.feedUrl : null;
    let targetCategory = req.body && req.body.category ? req.body.category : null;
    const requestId = String(req.body?.requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    setManualSyncProgress(requestId, 'starting', targetFeedUrl ? 'Preparing this source…' : targetCategory ? `Preparing ${targetCategory} refresh…` : 'Preparing feed refresh…');
    try {
        const result = await syncFeeds(env, targetFeedUrl, progress => {
            setManualSyncProgress(requestId, progress.stage, progress.message, progress);
        }, targetCategory);
        if (!targetFeedUrl && !targetCategory) {
            setManualSyncProgress(requestId, 'smart', 'Updating Smart clusters…');
            result.smart = await smartNews.sync(progress => {
                setManualSyncProgress(requestId, progress.stage, progress.message, progress);
            });
        }
        finishManualSyncProgress(requestId, 'Refresh complete.', {
            failed: result.success === false || result.smart?.ok === false
        });
        res.json(result);
    } catch (error) {
        finishManualSyncProgress(requestId, 'Refresh failed.', { failed: true, error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/smart-status', authMiddleware, async (req, res) => {
    res.json(await smartNews.getStatus());
});

app.get('/api/gemini-key-status', authMiddleware, async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY || '';
    const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
    const smartStatus = await smartNews.getStatus();
    const base = {
        configured: Boolean(apiKey),
        model,
        checkedAt: new Date().toISOString(),
        usageUrl: 'https://aistudio.google.com/usage',
        exactRemainingAvailable: false,
        exactRemainingExplanation: 'Google exposes live RPM, TPM, RPD, tier, and remaining usage in the AI Studio project dashboard, not through a Gemini API key.',
        lastSmartRun: {
            state: smartStatus.state || '',
            completedAt: smartStatus.completedAt || '',
            geminiUsed: Boolean(smartStatus.geminiUsed),
            reviewedArticleCount: Number(smartStatus.geminiReviewedArticleCount) || 0,
            eligibleArticleCount: Number(smartStatus.geminiEligibleArticleCount) || 0,
            reason: smartStatus.geminiReason || '',
            error: smartStatus.geminiError || ''
        }
    };
    if (!apiKey) return res.json({ ...base, valid: false, state: 'not_configured' });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':countTokens', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'RSS Reader key check' }] }] }),
            signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok) {
            return res.json({ ...base, valid: true, state: 'ready', validationTokens: Number(payload.totalTokens) || 0 });
        }
        const message = String(payload?.error?.message || ('Gemini returned HTTP ' + response.status)).slice(0, 240);
        if (response.status === 429) return res.json({ ...base, valid: true, state: 'quota_limited', error: message });
        return res.json({ ...base, valid: false, state: response.status === 401 || response.status === 403 ? 'invalid_key' : 'error', error: message });
    } catch (error) {
        return res.json({ ...base, valid: false, state: 'unreachable', error: String(error.message || error).slice(0, 240) });
    } finally {
        clearTimeout(timeout);
    }
});

app.post('/api/smart-sync', authMiddleware, async (req, res) => {
    const requestId = String(req.body?.requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    let targetCategory = req.body && req.body.category ? req.body.category : null;
    setManualSyncProgress(requestId, 'starting', targetCategory ? `Preparing Smart refresh for ${targetCategory}…` : 'Preparing Smart refresh…');
    try {
        const result = await smartNews.sync(progress => {
            setManualSyncProgress(requestId, progress.stage, progress.message, progress);
        }, targetCategory);
        finishManualSyncProgress(requestId, result.skipped ? 'Smart feed is already up to date.' : 'Smart refresh complete.', {
            failed: result.ok === false
        });
        res.json(result);
    } catch (error) {
        finishManualSyncProgress(requestId, 'Smart refresh failed.', { failed: true, error: error.message });
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.get('/api/sync-progress', authMiddleware, (req, res) => {
    const requestId = String(req.query.id || '');
    res.json(manualSyncProgress.get(requestId) || {
        stage: 'waiting',
        message: 'Waiting for refresh to start…',
        done: false
    });
});

app.get('/api/logs', authMiddleware, (req, res) => {
    pruneOldEntries(systemLogs);
    res.json(systemLogs);
});

app.get('/api/fetch-history', authMiddleware, (req, res) => {
    pruneOldEntries(fetchHistory);
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    // Return only the most recent `limit` entries (newest first)
    const start = Math.max(0, fetchHistory.length - limit);
    res.json(fetchHistory.slice(start).reverse());
});

app.get('/api/fetch-summary', authMiddleware, (req, res) => {
    pruneOldEntries(fetchHistory);
    const summary = {};
    for (const entry of fetchHistory) {
        if (!summary[entry.feedUrl]) {
            summary[entry.feedUrl] = { feedUrl: entry.feedUrl, feedTitle: entry.feedTitle, success: 0, error: 0, skipped: 0, total: 0, lastFetch: 0, lastStatus: '', lastDetails: '' };
        }
        const s = summary[entry.feedUrl];
        s.total++;
        if (entry.status === 'success') s.success++;
        else if (entry.status === 'error') s.error++;
        else if (entry.status === 'skipped') s.skipped++;
        if (entry.timestamp > s.lastFetch) {
            s.lastFetch = entry.timestamp;
            s.lastStatus = entry.status;
            s.lastDetails = entry.details;
        }
    }
    res.json(Object.values(summary).sort((a, b) => b.lastFetch - a.lastFetch));
});

// Error-only fetch history with full details for debugging
app.get('/api/fetch-errors', authMiddleware, (req, res) => {
    pruneOldEntries(fetchHistory);
    const limit = Math.min(parseInt(req.query.limit) || 100, 200);
    const errors = fetchHistory
        .filter(e => e.status === 'error')
        .map(e => ({
            timestamp: e.timestamp,
            feedUrl: e.feedUrl,
            feedTitle: e.feedTitle,
            details: e.details,
            durationMs: e.durationMs,
            httpStatus: e.httpStatus || null,
            errorType: e.errorType || 'unknown',
            responseSnippet: e.responseSnippet || null
        }))
        .reverse()
        .slice(0, limit);
    res.json(errors);
});

// Sync pause/resume toggle
app.post('/api/sync-toggle', authMiddleware, (req, res) => {
    syncPaused = !syncPaused;
    console.log(`[SYNC] Auto-sync ${syncPaused ? 'PAUSED' : 'RESUMED'} by user`);
    res.json({ paused: syncPaused });
});

app.get('/api/sync-status', authMiddleware, (req, res) => {
    res.json({
        paused: syncPaused,
        lastSyncCompletedAt: lastSyncCompletedAt,
    });
});

app.get('/api/debug-article', authMiddleware, async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'URL required' });

    try {
        let html = '';

        let fetchMethod = '';
        const fetchAttempts = [];

        // Attempt 1: Direct (with cookie persistence)
        try {
            html = await fetchWithCookies(url);
            if (html) {
                fetchMethod = 'direct';
                fetchAttempts.push({ method: 'direct', status: 'ok', length: html.length });
            } else {
                fetchAttempts.push({ method: 'direct', status: 'empty', detail: 'Returned null/empty (non-ok or redirect loop)' });
            }
        } catch (e) {
            fetchAttempts.push({ method: 'direct', status: 'error', detail: e.cause?.message || e.message });
        }

        // Attempt 2: CF Proxy
        if (!html) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000);
                const proxyRes = await fetch(CF_PROXY_BASE + encodeURIComponent(url), { signal: controller.signal });
                clearTimeout(timeout);
                if (proxyRes.ok) {
                    html = await proxyRes.text();
                    fetchMethod = 'cf-proxy';
                    fetchAttempts.push({ method: 'cf-proxy', status: 'ok', length: html.length });
                } else {
                    let errBody = '';
                    try { errBody = await proxyRes.text(); errBody = errBody.substring(0, 200).replace(/[\n\r\t]+/g, ' ').trim(); } catch (e) { }
                    fetchAttempts.push({ method: 'cf-proxy', status: `http-${proxyRes.status}`, detail: `${proxyRes.statusText}${errBody ? ` | ${errBody}` : ''}` });
                }
            } catch (e) {
                fetchAttempts.push({ method: 'cf-proxy', status: 'error', detail: e.cause?.message || e.message });
            }
        }

        // Attempt 3: Vietserver Proxy
        if (!html) {
            try {
                html = await fetchViaVietserver(url);
                if (html) {
                    fetchMethod = 'vietserver';
                    fetchAttempts.push({ method: 'vietserver', status: 'ok', length: html.length });
                }
            } catch (e) {
                fetchAttempts.push({ method: 'vietserver', status: 'error', detail: e.cause?.message || e.message });
            }
        }

        // Attempt 4: AllOrigins
        if (!html) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);
                const allOriginsRes = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), { signal: controller.signal });
                clearTimeout(timeout);
                if (allOriginsRes.ok) {
                    html = await allOriginsRes.text();
                    fetchMethod = 'allorigins';
                    fetchAttempts.push({ method: 'allorigins', status: 'ok', length: html.length });
                } else {
                    let errBody = '';
                    try { errBody = await allOriginsRes.text(); errBody = errBody.substring(0, 200).replace(/[\n\r\t]+/g, ' ').trim(); } catch (e) { }
                    fetchAttempts.push({ method: 'allorigins', status: `http-${allOriginsRes.status}`, detail: `${allOriginsRes.statusText}${errBody ? ` | ${errBody}` : ''}` });
                }
            } catch (e) {
                fetchAttempts.push({ method: 'allorigins', status: 'error', detail: e.cause?.message || e.message });
            }
        }

        if (!html) return res.json({ error: 'Failed to fetch page', url, fetchAttempts });

        const result = { url, htmlLength: html.length };

        // Meta tags
        const metaTags = html.match(/<meta[^>]+>/ig) || [];
        for (const tag of metaTags) {
            const contentMatch = tag.match(/content=["']([^"']+)["']/i);
            if (!contentMatch) continue;
            const c = contentMatch[1].trim();
            if (/og:title/i.test(tag) && !result.ogTitle) result.ogTitle = decodeHTMLEntities(c);
            if (/og:image/i.test(tag) && !tag.match(/og:image:(width|height|type|alt)/i) && !result.ogImage && !isInvalidImage(c)) result.ogImage = c;
            if (/og:site_name/i.test(tag) && !result.ogSiteName) result.ogSiteName = decodeHTMLEntities(c);
            if (/article:section/i.test(tag) && !result.articleSection) result.articleSection = decodeHTMLEntities(c);
            if (/(article:published_time|datepublished)/i.test(tag) && !result.metaDate) result.metaDate = decodeHTMLEntities(c);
        }

        // Title & H1
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch) result.htmlTitle = decodeHTMLEntities(titleMatch[1].trim());
        const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (h1Match) result.h1 = decodeHTMLEntities(h1Match[1].replace(/<[^>]+>/g, '').trim());

        // JSON-LD extraction
        const ldJsonMatches = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/ig) || [];
        result.jsonLdSummary = [];
        for (const block of ldJsonMatches) {
            try {
                const cleanJson = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').replace(/[\n\r\t]+/g, ' ').trim();
                const parsed = JSON.parse(cleanJson);
                const schemas = Array.isArray(parsed) ? parsed : [parsed];
                for (const schema of schemas) {
                    const entry = { type: schema['@type'] };
                    if (schema.headline) entry.headline = decodeHTMLEntities(schema.headline);
                    if (schema.datePublished) { entry.datePublished = schema.datePublished; result.ldDatePublished = schema.datePublished; }
                    if (schema.publisher?.name) { entry.publisher = decodeHTMLEntities(schema.publisher.name); result.ldPublisher = entry.publisher; }
                    if (schema.articleSection) { entry.articleSection = decodeHTMLEntities(schema.articleSection); result.ldArticleSection = entry.articleSection; }
                    if (schema['@type'] === 'BreadcrumbList' && schema.itemListElement) {
                        entry.breadcrumbs = schema.itemListElement.map(bc => ({ position: bc.position, name: decodeHTMLEntities(bc.item?.name || bc.name) }));
                        const cat = schema.itemListElement.find(bc => bc.position === 2);
                        if (cat?.item?.name) result.breadcrumbCategory = decodeHTMLEntities(cat.item.name);
                    }
                    if (schema.image) {
                        entry.image = typeof schema.image === 'string' ? schema.image : (schema.image.url || (Array.isArray(schema.image) ? schema.image[0] : null));
                    }
                    result.jsonLdSummary.push(entry);
                }
            } catch (e) { }
        }

        // Image via extractImageFromHtml
        result.extractedImage = extractImageFromHtml(html, url);

        // Logo alt or Title fallback
        const logoAltMatch = html.match(/<img[^>]*logo[^>]*alt=["']([^"']+)["']/i) ||
            html.match(/<img[^>]*alt=["']([^"']+)["'][^>]*logo[^>]*>/i) ||
            html.match(/<a[^>]*logo[^>]*title=["']([^"']+)["']/i) ||
            html.match(/<title>.*?[-\|]\s*([^<]+)<\/title>/i);
        if (logoAltMatch) {
            let extracted = decodeHTMLEntities(logoAltMatch[1]).trim();
            extracted = extracted.replace(/^(Báo điện tử|Báo|Tạp chí|Trang thông tin điện tử)\s+/i, '').trim();
            extracted = extracted.replace(/\s+News$/i, '').trim();
            if (extracted.includes('- Tin tức')) extracted = extracted.split('-')[0].trim();
            if (extracted.includes('|')) extracted = extracted.split('|')[0].trim();
            result.logoAlt = extracted;
        }

        res.json(result);
    } catch (e) {
        res.json({ error: e.message, url });
    }
});

// --- ADAPTIVE ARTICLE FETCH STRATEGY RANKING ---
const ARTICLE_FETCH_BASE_POINTS = {
    direct: 100,
    cloudflare: 80,
    vietserver: 70,
    allorigins: 55,
    jina: 40,
    opencli: 20
};
let articleFetchStrategyStats = null;
let articleFetchStatsSaveTimer = null;
const articleFetchProgress = new Map();

function updateArticleFetchProgress(requestId, stage, message, extra = {}) {
    if (!requestId) return;
    articleFetchProgress.set(requestId, {
        stage,
        message,
        ...extra,
        updatedAt: new Date().toISOString()
    });
}

function finishArticleFetchProgress(requestId, message, extra = {}) {
    updateArticleFetchProgress(requestId, 'complete', message, { ...extra, done: true });
    const cleanup = setTimeout(() => articleFetchProgress.delete(requestId), 2 * 60 * 1000);
    if (cleanup.unref) cleanup.unref();
}

async function ensureArticleFetchStats() {
    if (!articleFetchStrategyStats) {
        articleFetchStrategyStats = await env.RSS_DATA.get('articleFetchStrategyStats', { type: 'json' }) || {};
    }
    return articleFetchStrategyStats;
}

function scheduleArticleFetchStatsSave() {
    if (articleFetchStatsSaveTimer) return;
    articleFetchStatsSaveTimer = setTimeout(async () => {
        articleFetchStatsSaveTimer = null;
        try {
            await env.RSS_DATA.put('articleFetchStrategyStats', JSON.stringify(articleFetchStrategyStats || {}));
        } catch (error) {
            console.error('[ARTICLE FETCH] Could not persist adaptive scores:', error.message);
        }
    }, 5000);
    if (articleFetchStatsSaveTimer.unref) articleFetchStatsSaveTimer.unref();
}

async function rankArticleFetchStrategies(hostname) {
    const stats = await ensureArticleFetchStats();
    const sourceStats = stats[hostname] || {};
    const available = Object.keys(ARTICLE_FETCH_BASE_POINTS).filter(name => name !== 'vietserver' || Boolean(VIETSERVER_PROXY_BASE));
    const isRichDom = /(?:voz\.vn|tinhte\.vn|vnexpress\.net|tuoitre\.vn|vtv\.vn|kenh14\.vn|nhandan\.vn|thanhnien\.vn|dantri\.com\.vn|laodong\.vn|vietnamnet\.vn|soha\.vn|tienphong\.vn|znews\.vn|cafef\.vn|genk\.vn|afamily\.vn|\.vn|\.com\.vn)$/i.test(hostname);
    return available.sort((a, b) => {
        const aStats = sourceStats[a] || {};
        const bStats = sourceStats[b] || {};
        const aPenalty = ((aStats.consecutiveFailures || 0) >= 3 && !isRichDom) ? 100 : 0;
        const bPenalty = ((bStats.consecutiveFailures || 0) >= 3 && !isRichDom) ? 100 : 0;
        const aPreference = (isRichDom && a === 'jina') ? -200 : (aStats.userPreference === 1 ? 100 : (aStats.userPreference === -1 ? -120 : 0));
        const bPreference = (isRichDom && b === 'jina') ? -200 : (bStats.userPreference === 1 ? 100 : (bStats.userPreference === -1 ? -120 : 0));
        const aDomBonus = (isRichDom && ['cloudflare', 'direct', 'vietserver'].includes(a)) ? 350 : 0;
        const bDomBonus = (isRichDom && ['cloudflare', 'direct', 'vietserver'].includes(b)) ? 350 : 0;
        const aPoints = ARTICLE_FETCH_BASE_POINTS[a] + (aStats.qualityPoints || 0) + aPreference + aDomBonus - aPenalty;
        const bPoints = ARTICLE_FETCH_BASE_POINTS[b] + (bStats.qualityPoints || 0) + bPreference + bDomBonus - bPenalty;
        return bPoints - aPoints;
    });
}

async function getArticleFetchPreferences(hostname) {
    const stats = await ensureArticleFetchStats();
    const sourceStats = stats[hostname] || {};
    return Object.fromEntries(Object.keys(ARTICLE_FETCH_BASE_POINTS).map(strategy => [
        strategy,
        sourceStats[strategy]?.userPreference === 1 ? 'like' : (sourceStats[strategy]?.userPreference === -1 ? 'dislike' : '')
    ]));
}

async function setArticleFetchPreference(hostname, strategy, preference) {
    const stats = await ensureArticleFetchStats();
    stats[hostname] ||= {};
    stats[hostname][strategy] ||= {
        attempts: 0,
        successes: 0,
        failures: 0,
        consecutiveFailures: 0,
        qualityPoints: 0
    };
    stats[hostname][strategy].userPreference = preference === 'like' ? 1 : (preference === 'dislike' ? -1 : 0);
    stats[hostname][strategy].lastPreferenceAt = new Date().toISOString();
    scheduleArticleFetchStatsSave();
    return getArticleFetchPreferences(hostname);
}

async function recordArticleFetchOutcome(hostname, strategy, succeeded, error = '') {
    const stats = await ensureArticleFetchStats();
    stats[hostname] ||= {};
    const current = stats[hostname][strategy] || {
        attempts: 0,
        successes: 0,
        failures: 0,
        consecutiveFailures: 0,
        qualityPoints: 0
    };
    current.attempts += 1;
    current.lastAttemptAt = new Date().toISOString();
    if (succeeded) {
        current.successes += 1;
        current.consecutiveFailures = 0;
        current.qualityPoints = Math.min(50, Math.round((current.qualityPoints || 0) * 0.8 + 12));
        current.lastSuccessAt = current.lastAttemptAt;
        current.lastError = '';
    } else {
        current.failures += 1;
        current.consecutiveFailures += 1;
        current.qualityPoints = Math.max(-100, Math.round((current.qualityPoints || 0) * 0.8 - 25));
        current.lastError = String(error || 'No usable article content').slice(0, 240);
    }
    stats[hostname][strategy] = current;
    scheduleArticleFetchStatsSave();
}

function isUsableArticlePage(html) {
    if (!html || html.length < 800) return false;
    const sample = html.slice(0, 120000);
    const titleMatch = sample.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const titleText = titleMatch ? titleMatch[1].trim() : '';
    if (/(?:attention required|just a moment|access denied|cloudflare)/i.test(titleText) || /(?:cf-chl-|enable javascript and cookies to continue)/i.test(sample)) return false;
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

function cleanArticleMarkup(markup) {
    let cleaned = String(markup || '');
    cleaned = cleaned.split(/<div[^>]*class=["'][^"']*(?:thread-comment|comment-list|bdPostTree|replies|comments-area)[^"']*["']/i)[0];
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
    cleaned = cleaned.replace(/<(?:script|style|template|nav|aside|form|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|template|nav|aside|form|noscript)>/gi, '');

    // Promote image data attributes (data-large-src, data-original, data-src, data-url) to src so infographic and lazyloaded images display correctly
    cleaned = cleaned.replace(/<img\b[^>]*>/gi, (img) => {
        if (!cleaned.includes('voz-post') && /(class|src)=["'][^"']*(avatar|author|logo|smilie|emoji)[^"']*["']/i.test(img)) return '';
        if (cleaned.includes('voz-post') && /(class|src)=["'][^"']*logo[^"']*["']/i.test(img) && !/avatar/i.test(img)) return '';
        const realSrcMatch = img.match(/\s(?:data-large-src|data-original|data-src|data-url|data-zoom-image|data-img-src)=(?:"([^"]*)"|'([^']*)')/i);
        if (realSrcMatch) {
            let newImg = img.replace(/\bsrc=(?:"[^"]*"|'[^']*')/i, '');
            newImg = newImg.replace(/\b(?:data-large-src|data-original|data-src|data-url|data-zoom-image|data-img-src)=(?:"[^"]*"|'[^']*')/gi, '');
            const url = realSrcMatch[1] || realSrcMatch[2];
            return `<img src="${url}" ${newImg.replace(/^<img\s*/i, '')}`;
        }
        if (/src=(?:"data:image\/[^"]*"|'data:image\/[^']*')/i.test(img)) return '';
        return img;
    });

    // Convert VCCorp / publisher video embeds into clean video players
    cleaned = cleaned.replace(/<(?:div|figure)\b[^>]*(?:type=["']VideoStream["']|data-vid=["'][^"']+["']|data-video=["'][^"']+["'])[^>]*>[\s\S]*?<\/(?:div|figure)>/gi, (match) => {
        const vidMatch = match.match(/data-vid=(["'])([^"']+)\1/i) || match.match(/data-video=(["'])([^"']+)\1/i) || match.match(/data-src=(["'])([^"']+\.(?:mp4|m3u8)[^"']*)\1/i);
        if (!vidMatch) return match;
        let vidUrl = vidMatch[2];
        if (!vidUrl.startsWith('http://') && !vidUrl.startsWith('https://')) {
            vidUrl = 'https://' + vidUrl.replace(/^\/+/, '');
        }
        const thumbMatch = match.match(/data-thumb=(["'])([^"']+)\1/i) || match.match(/poster=(["'])([^"']+)\1/i);
        const posterAttr = thumbMatch && safeHttpUrl(thumbMatch[2]) ? `poster="${escapeHtml(safeHttpUrl(thumbMatch[2]))}"` : '';
        return `<div class="article-video-container my-4 rounded-xl overflow-hidden shadow-md"><video controls playsinline preload="metadata" class="w-full h-auto" src="${escapeHtml(vidUrl)}" ${posterAttr}>Video playback is not supported by this browser.</video></div>`;
    });

    // Format related article embeds cleanly into styled cards so users know they are separate clickable links without cluttering the text
    cleaned = cleaned.replace(/<(?:article|div)\b[^>]*(?:class=["'][^"']*(?:article-relate|summary__content|box-tin-lien-quan|ck-cms-insert-news|relate-news|box-related-news|related-topic)[^"']*["']|type=["'](?:RelatedOneNews|RelatedNewsBox)["']|data-source=["']related-news["'])[^>]*>([\s\S]*?)<\/(?:article|div)>/gi, (match, inner) => {
        const linkMatch = inner.match(/<a\b[^>]*href=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/i);
        if (!linkMatch) return '';
        const href = linkMatch[2];
        const titleText = linkMatch[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || inner.match(/<(?:h[1-6]|span)\b[^>]*>([\s\S]*?)<\/(?:h[1-6]|span)>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || 'Bài viết liên quan';
        if (!titleText || titleText.length < 10) return '';
        const descMatch = inner.match(/class=["'][^"']*(?:desc|sapo|summary|VCObjectBoxRelatedNewsItemSapo)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p|span)>/i);
        const descText = descMatch ? `<p class="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">${escapeHtml(descMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())}</p>` : '';
        return `<div class="styled-rel-card my-6 px-4 py-3.5 rounded-xl border-l-4 border-l-blue-600 dark:border-l-blue-500 bg-gray-50 dark:bg-gray-800/80 border border-gray-200/80 dark:border-gray-700 shadow-sm not-prose transition hover:shadow-md hover:border-l-blue-700"><div class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-2"><span>📰 Bài viết liên quan / Xem thêm:</span></div><a href="${escapeHtml(href)}" target="_blank" class="font-bold text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 text-base md:text-lg block leading-snug no-underline transition">${escapeHtml(titleText)} →</a>${descText}</div>`;
    });

    const noisePattern = /<(div|section|footer|header|ul|aside)\b[^>]*(?:class|id|data-module|role)=(["\'])[^"\']*(?:advert|adsbygoogle|ad-container|breadcrumb|pagination|related|recommend|share|social|reaction|signature|message-user|message-attribution|message-footer|message-cell--user|post-meta|author-box|author-info|singular-author|user-info|user-panel|member-header|comment-list|comments-area|newsletter|subscribe|topic-list|trending|popular-post|read-more|tags-list|article__tags|author-area|menu-area|menu-container|action-bar|thread-action|thread-editor|relate-news|box-topic|tinlienquan|knc-relate|box-relate|zone-interlink|article-audio|tts-player|dt-size-6|detail-comment|box-comment|box-bottom|cmbl|detail-tab|admzone|link-source-detail)[^"\']*\2[^>]*>[\s\S]*?<\/\1>/gi;
    for (let i = 0; i < 5; i++) cleaned = cleaned.replace(noisePattern, '');
    cleaned = cleaned.replace(/<(?:button)\b[^>]*>[\s\S]*?<\/(?:button)>/gi, '');
    if (!cleaned.includes('voz-post')) {
        cleaned = cleaned.replace(/<img\b[^>]*avatar[^>]*>/gi, '');
        cleaned = cleaned.replace(/<img\b[^>]*src=["'][^"']*avatars[^"']*["'][^>]*>/gi, '');
    }
    cleaned = trimArticleMarkupAtSemanticBoundary(cleaned);

    // Strip AVPlayer / video controls, audio player texts, ad markers, Image X: prefixes, trailing comment counts, category returns, search engine promos
    cleaned = cleaned.replace(/<(?:p|div|span|h[1-6]|li)\b[^>]*>\s*(?:Your browser does not support HTML5 audio\.?|Advertisement|Advertisements|Ads\s+by|Skip|Next|Stay|Back|Quality|Playback\s+speed|1x\s+Normal|Normal|\d+(?:\.\d+)?x|(?:Video|Audio)\s+\d+(?:\s+Shorts)?|Link bài gốc)\s*<\/(?:p|div|span|h[1-6]|li)>/gi, '');
    cleaned = cleaned.replace(/(?:<p[^>]*>|<div[^>]*>|\s)*Your browser does not support HTML5 audio\.?(?:<\/p>|<\/div>|\s)*/gi, ' ');
    cleaned = cleaned.replace(/<(?:p|div|span|h[1-6]|li)\b[^>]*>(?:[\s|/:-]|&nbsp;|<br\s*\/?>|<img[^>]*>)*(?:Advertisement|Advertisements|Ads\s+by|Skip|Next|Stay|Back|Quality|Playback\s+speed|1x\s+Normal|Normal|\d+(?:\.\d+)?x|(?:Video|Audio)\s+\d+(?:\s+Shorts)?|Link bài gốc)(?:[\s|/:-]|&nbsp;|<br\s*\/?>|<img[^>]*>)*<\/(?:p|div|span|h[1-6]|li)>/gi, '');
    cleaned = cleaned.replace(/Image\s+\d+:\s*/gi, '');
    cleaned = cleaned.replace(/\.(\d{1,4})(?=\s*<\/(?:p|div|span|h[1-6]|li)>)/g, '.');
    cleaned = cleaned.replace(/\.(\d{1,4})(?=\s*(?:\n|$))/g, '.');
    cleaned = cleaned.replace(/<(?:p|div|span|h[1-6])\b[^>]*>\s*(?:Trở lại|Quay lại)\s+(?:trang chủ|chuyên mục|Trang chủ|Chuyên mục)\s*<\/(?:p|div|span|h[1-6])>/giu, '');
    cleaned = cleaned.replace(/<(?:p|div|span|h[1-6])\b[^>]*>[\s\S]*?(?:Thêm\s+[^\n<]{1,80}\s+trên Google|Chọn\s+[^\n<]{1,80}\s+làm nguồn ưu tiên)[\s\S]*?<\/(?:p|div|span|h[1-6])>/gi, '');

    // Clean up duplicate author names at the start of Tuoi Tre / news articles (e.g., DUY LINH DUY LINH)
    cleaned = cleaned.replace(/^(?:\s*<(?:p|div|span)[^>]*>)?\s*([A-ZÀ-Ỹ\s]{3,25})\s+\1\b/u, '$1');

    if (!cleaned.includes('voz-post')) {
        const protectedLinks = [];
        cleaned = cleaned.replace(/<a\b[^>]*class=["'][^"']*(?:font-bold text-gray-900|embedded-suggested-card|embedded-suggested-overlay)[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, (match) => {
            protectedLinks.push(match);
            return `__PROTECTED_LINK_${protectedLinks.length - 1}__`;
        });
        for (let i = 0; i < 3; i++) cleaned = cleaned.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
        cleaned = cleaned.replace(/<\/?a\b[^>]*>/gi, '');
        for (let i = 0; i < protectedLinks.length; i++) {
            cleaned = cleaned.replace(`__PROTECTED_LINK_${i}__`, protectedLinks[i]);
        }
    }
    let protectedStyles = [];
    cleaned = cleaned.replace(/<(iframe|video|div|span|a)\b([^>]*)style=(["'])([^"']+)\3([^>]*)>/gi, (m, tag, pre, q, styleContent, post) => {
        if (tag.toLowerCase() === 'iframe' || tag.toLowerCase() === 'video' || m.includes('voz-like') || m.includes('embedded-suggested-card') || m.includes('box_tiso')) {
            protectedStyles.push(styleContent);
            return `<${tag}${pre}data-protected-style="${protectedStyles.length - 1}"${post}>`;
        }
        return m;
    });

    cleaned = cleaned.replace(/<img\b[^>]*(?:width|height)=(["\'])1\1[^>]*>/gi, '');
    cleaned = cleaned.replace(/\sstyle=(["\'])[\s\S]*?\1/gi, '');
    
    cleaned = cleaned.replace(/\sdata-protected-style=["'](\d+)["']/gi, (m, id) => {
        return ` style="${protectedStyles[id]}"`;
    });

    cleaned = cleaned.replace(/<(iframe|video|img|div|span|p|a|ul|li)\b([^>]*)>/gi, (m, tag, rest) => {
        if (tag.toLowerCase() === 'iframe' || tag.toLowerCase() === 'video') return m; // protect iframe/video from height stripping
        return `<${tag}${rest.replace(/\s(?:height|min-height|max-height)=["'][^"']*["']/gi, '')}>`;
    });
    cleaned = cleaned.replace(/\s(?:aria-hidden)=(["\'])true\1/gi, '');
    cleaned = cleaned.replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>');
    for (let i = 0; i < 3; i++) {
        cleaned = cleaned.replace(/<(p|div|span|section|figure)\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi, '');
    }
    return cleaned.replace(/>\s{3,}(?=<)/g, '>').replace(/\s{3,}/g, ' ').trim();
}

async function fetchArticleHtmlByStrategy(strategy, url) {
    if (strategy === 'direct') return await fetchWithCookies(url);
    if (strategy === 'vietserver') return await fetchViaVietserver(url);

    const controller = new AbortController();
    const timeoutMs = strategy === 'cloudflare' ? 8000 : 10000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const cbParam = (url.includes('?') ? '&' : '?') + '_cb=' + Date.now();
        const fetchUrl = strategy === 'cloudflare'
            ? CF_PROXY_BASE + encodeURIComponent(url + cbParam)
            : 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url + cbParam);
        const response = await fetch(fetchUrl, { signal: controller.signal });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return await response.text();
    } finally {
        clearTimeout(timeout);
    }
}

async function discoverArticleAudioUrls(html, pageUrl) {
    const discovered = [];
    const addUrl = value => {
        if (!value) return;
        try {
            const resolved = safeHttpUrl(new URL(decodeHTMLEntities(value), pageUrl).href);
            if (resolved && !discovered.includes(resolved)) discovered.push(resolved);
        } catch (e) { }
    };

    for (const match of String(html || '').matchAll(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi)) {
        for (const source of match[0].matchAll(/\s(?:src|data-src|data-url)=(['"])([\s\S]*?)\1/gi)) addUrl(source[2]);
    }
    for (const meta of String(html || '').matchAll(/<meta\b[^>]*(?:property|name)=(['"])(?:og:audio|twitter:player:stream)\1[^>]*>/gi)) {
        const content = meta[0].match(/\scontent=(['"])([\s\S]*?)\1/i);
        if (content) addUrl(content[2]);
    }

    // Several Vietnamese publishers use the shared VCCorp embedTTS player.
    // Its audio URL is assembled at runtime, so reconstruct and verify it.
    const ttsBlock = String(html || '').match(/embedTTS\.init\s*\(\s*\{([\s\S]{0,5000}?)\}\s*\)/i)?.[1] || '';
    if (ttsBlock) {
        const option = (name, fallback = '') => {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return ttsBlock.match(new RegExp('(?:^|[,\\n\\r])\\s*' + escaped + '\\s*:\\s*(["\\\'])([\\s\\S]*?)\\1', 'i'))?.[2] || fallback;
        };
        const newsId = option('newsId');
        const distributionDate = option('distributionDate');
        const namespace = option('nameSpace');
        const domainStorage = option('domainStorage', 'https://tts.mediacdn.vn').replace(/\/$/, '');
        const ext = option('ext', 'm4a');
        const voice = option('defaultVoice', 'nu');
        const format = option('srcAudioFormat', '{0}/{1}/{2}-{3}-{4}.{5}');
        const apiCheck = option('apiCheckUrlExists');
        if (newsId && distributionDate && namespace) {
            // VCCorp's placeholders are namespace, voice, then article id.
            // Keep the historical ordering as a fallback for other deployments.
            const valueOrders = [
                [domainStorage, distributionDate, namespace, voice, newsId, ext],
                [domainStorage, distributionDate, namespace, newsId, voice, ext]
            ];
            const candidates = [...new Set(valueOrders.map(values =>
                format.replace(/\{(\d+)\}/g, (_, index) => values[Number(index)] || '')
            ))];
            for (const candidate of candidates) {
                let exists = false;
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 4500);
                try {
                    if (apiCheck) {
                        const filename = candidate.startsWith(domainStorage + '/') ? candidate.slice(domainStorage.length + 1) : candidate;
                        const response = await fetch(apiCheck + (apiCheck.includes('?') ? '&' : '?') + 'filename=' + encodeURIComponent(filename), {
                            headers: { Referer: pageUrl, Origin: new URL(pageUrl).origin },
                            signal: controller.signal
                        });
                        const result = response.ok ? await response.json() : null;
                        exists = Boolean(result && Number(result.status) === 1);
                    } else {
                        const response = await fetch(candidate, { method: 'HEAD', signal: controller.signal });
                        exists = response.ok;
                    }
                } catch (e) { }
                finally { clearTimeout(timeout); }
                if (exists) {
                    addUrl(candidate);
                    break;
                }
            }
        }
    }

    return discovered.slice(0, 3);
}

app.get('/api/article-content-progress', authMiddleware, (req, res) => {
    const requestId = String(req.query.id || '');
    res.json(articleFetchProgress.get(requestId) || {
        stage: 'waiting',
        message: 'Preparing article reader…',
        done: false
    });
});

app.post('/api/article-fetch-preference', authMiddleware, async (req, res) => {
    try {
        const strategy = String(req.body?.strategy || '');
        const preference = String(req.body?.preference || '');
        if (!(strategy in ARTICLE_FETCH_BASE_POINTS)) return res.status(400).json({ error: 'Unknown fetch method' });
        if (!['like', 'dislike', ''].includes(preference)) return res.status(400).json({ error: 'Preference must be like, dislike, or empty' });
        const resolvedUrl = await resolveGoogleNewsUrl(req.body?.url);
        const hostname = new URL(resolvedUrl).hostname.toLowerCase();
        const preferences = await setArticleFetchPreference(hostname, strategy, preference);
        res.json({ ok: true, hostname, preferences, ranking: await rankArticleFetchStrategies(hostname) });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

function triggerVozNextPagePrefetch(nextUrl, depth = 1) {
    if (!nextUrl || !nextUrl.includes('voz.vn') || depth > 2) return;
    setTimeout(async () => {
        try {
            const cached = await getCachedArticle(nextUrl);
            if (cached && cached.content) return;
            console.log(`[VOZ PAGINATION PREFETCH] Background caching next page: ${nextUrl}`);
            const strategyOrder = await rankArticleFetchStrategies('voz.vn');
            for (const strategy of strategyOrder) {
                try {
                    const candidateHtml = await fetchArticleHtmlByStrategy(strategy, nextUrl);
                    if (candidateHtml && isUsableArticlePage(candidateHtml)) {
                        const result = await parseArticleHtmlContent(candidateHtml, nextUrl, strategy, [strategy], strategyOrder, {}, null);
                        if (result && result.content) {
                            result.cached = true;
                            await cacheArticleResult(nextUrl, result);
                            console.log(`[VOZ PAGINATION PREFETCH] Successfully cached ${nextUrl} via ${strategy} (${result.content.length} bytes)`);
                            if (result.pagination && result.pagination.nextUrl && depth < 2) {
                                triggerVozNextPagePrefetch(result.pagination.nextUrl, depth + 1);
                            }
                            break;
                        }
                    }
                } catch(e) {}
            }
        } catch (e) {
            console.error(`[VOZ PAGINATION PREFETCH ERROR] ${nextUrl}: ${e.message}`);
        }
    }, 150);
}

function triggerVozCurrentPageBackgroundUpdate(url, cachedArticle) {
    if (!url || !url.includes('voz.vn')) return;
    setTimeout(async () => {
        try {
            console.log(`[VOZ BACKGROUND UPDATE] Checking for new posts on ${url}`);
            const strategyOrder = await rankArticleFetchStrategies('voz.vn');
            for (const strategy of strategyOrder) {
                try {
                    const candidateHtml = await fetchArticleHtmlByStrategy(strategy, url);
                    if (candidateHtml && isUsableArticlePage(candidateHtml)) {
                        const result = await parseArticleHtmlContent(candidateHtml, url, strategy, [strategy], strategyOrder, {}, null);
                        if (result && result.content && result.content !== cachedArticle.content) {
                            result.cached = true;
                            await cacheArticleResult(url, result);
                            console.log(`[VOZ BACKGROUND UPDATE] Updated cache for ${url} (found new posts)`);
                            
                            // Also trigger next page prefetch if it has a new next page
                            if (result.pagination && result.pagination.nextUrl) {
                                triggerVozNextPagePrefetch(result.pagination.nextUrl, 1);
                            }
                            break;
                        } else if (result && result.content) {
                            console.log(`[VOZ BACKGROUND UPDATE] No new posts for ${url}`);
                            break;
                        }
                    }
                } catch(e) {}
            }
        } catch (e) {
            console.error(`[VOZ BACKGROUND UPDATE ERROR] ${url}: ${e.message}`);
        }
    }, 2000);
}

function triggerNextFiveArticlesPrefetch(currentUrl) {
    setTimeout(async () => {
        try {
            const articles = await env.RSS_DATA.get('articles', { type: 'json' }) || [];
            const smartClusters = await env.RSS_DATA.get('smartClusters', { type: 'json' }) || [];
            const urlsToPrefetch = new Set();

            // 1. Check if currentUrl is in smart clusters or has related articles
            for (const cluster of smartClusters) {
                const clusterUrl = cluster?.originalLink || cluster?.link;
                if (clusterUrl === currentUrl || (cluster?.cluster && cluster.cluster.some(r => (r.originalLink || r.link) === currentUrl))) {
                    if (cluster.cluster) {
                        for (const rel of cluster.cluster) {
                            const u = rel.originalLink || rel.link;
                            if (u && u !== currentUrl && urlsToPrefetch.size < 5) urlsToPrefetch.add(u);
                        }
                    }
                }
            }

            // 2. Check next 5 in active articles list
            const idx = articles.findIndex(a => (a.originalLink || a.link) === currentUrl);
            if (idx !== -1) {
                for (let i = idx + 1; i < Math.min(articles.length, idx + 6); i++) {
                    const u = articles[i]?.originalLink || articles[i]?.link;
                    if (u && u !== currentUrl && urlsToPrefetch.size < 5) urlsToPrefetch.add(u);
                }
            }

            if (urlsToPrefetch.size === 0) return;
            console.log(`[NEXT-5 PREFETCH] Triggered background prefetch for ${urlsToPrefetch.size} articles after reading ${currentUrl}`);

            for (const targetUrl of urlsToPrefetch) {
                let cached = await getCachedArticle(targetUrl);
                if (cached && cached.content) continue;
                try {
                    const hostname = (() => { try { return new URL(targetUrl).hostname.toLowerCase(); } catch(e) { return ''; } })();
                    const strategyOrder = await rankArticleFetchStrategies(hostname);
                    for (const strategy of strategyOrder) {
                        try {
                            const candidateHtml = await fetchArticleHtmlByStrategy(strategy, targetUrl);
                            if (isUsableArticlePage(candidateHtml)) {
                                const parsedPayload = await parseArticleHtmlContent(candidateHtml, targetUrl, strategy, [strategy], strategyOrder, {}, null);
                                if (parsedPayload && parsedPayload.content) {
                                    await cacheArticleResult(targetUrl, parsedPayload);
                                    console.log(`[NEXT-5 PREFETCH] Cached ready to serve: ${targetUrl}`);
                                    break;
                                }
                            }
                        } catch(e) {}
                    }
                } catch(e) {}
                await new Promise(r => setTimeout(r, 500));
            }
        } catch (e) {
            console.error(`[NEXT-5 PREFETCH ERROR] ${e.message}`);
        }
    }, 200);
}

app.post('/api/clear-article-cache', authMiddleware, async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    try {
        await deleteCachedArticle(url);
        // If it's a voz.vn thread, clear all pages of the thread
        if (url.includes('voz.vn/t/')) {
            const baseUrl = url.split('?')[0];
            const isSpecificPostOrPage = baseUrl.match(/\/(page-\d+|post-\d+|unread|latest)/i);
            if (!isSpecificPostOrPage) {
                const threadMatch = url.match(/\/t\/.*?\.(\d+)/);
                if (threadMatch) {
                    const threadId = threadMatch[1];
                    const files = await fs.readdir(ARTICLE_CACHE_DIR).catch(() => []);
                    for (const file of files) {
                        const filename = path.join(ARTICLE_CACHE_DIR, file);
                        try {
                            const cached = JSON.parse(await fs.readFile(filename, 'utf-8'));
                            if (cached.url && cached.url.includes(`voz.vn/t/`) && cached.url.includes(`.${threadId}`)) {
                                await fs.unlink(filename).catch(() => {});
                            }
                        } catch (e) {}
                    }
                }
            }
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to clear cache' });
    }
});

// --- ARTICLE CONTENT EXTRACTION ENDPOINT ---
app.get('/api/article-content', authMiddleware, async (req, res) => {
    const requestedUrl = req.query.url;
    if (!requestedUrl) return res.status(400).json({ error: 'URL required' });
    let url = requestedUrl;
    const requestId = String(req.query.requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    updateArticleFetchProgress(requestId, 'starting', 'Identifying source and loading its fetch history…');

    try {
        if (url.match(/\.pdf(\?|$)/i)) {
            finishArticleFetchProgress(requestId, 'PDF Document loaded.', { method: 'pdf' });
            return res.json({
                url,
                title: 'PDF Document',
                content: `<iframe src="https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true" style="width: 100%; aspect-ratio: 1/1.414; min-height: 800px; border: none; border-radius: 8px;" frameborder="0"></iframe>`,
                fetchStrategy: 'pdf',
                attemptedStrategies: ['pdf'],
                availableStrategies: [],
                methodPreferences: {}
            });
        }
        const requestedStrategy = String(req.query.strategy || '').trim();
        const rejectedStrategy = String(req.query.reject || '').trim();
        const excludedStrategies = new Set(String(req.query.exclude || '').split(',').map(value => value.trim()).filter(Boolean));
        if (requestedStrategy && requestedStrategy !== 'refresh' && !(requestedStrategy in ARTICLE_FETCH_BASE_POINTS)) {
            return res.status(400).json({ error: 'Unknown fetch method' });
        }
        const bypassCache = Boolean(req.query.bypassCache === 'true' || req.query.bypassCache === '1' || requestedStrategy || rejectedStrategy || excludedStrategies.size);
        if (bypassCache) {
            try { await deleteCachedArticle(requestedUrl); } catch(e) {}
        }

        if (isGoogleNewsArticleUrl(requestedUrl)) {
            url = await resolveGoogleNewsUrl(requestedUrl, {
                title: req.query.title,
                feedTitle: req.query.feedTitle,
                feedUrl: req.query.feedUrl,
                feedIcon: req.query.feedIcon,
                domain: req.query.domain
            }, { force: bypassCache, backgroundResolve: false });
        }

        if (!bypassCache) {
            let directCached = await getCachedArticle(requestedUrl);
            if (!directCached && googleNewsUrlCache && googleNewsUrlCache[requestedUrl]?.resolvedUrl) {
                url = googleNewsUrlCache[requestedUrl].resolvedUrl;
                directCached = await getCachedArticle(url);
            } else if (directCached && isGoogleNewsArticleUrl(directCached.url || requestedUrl)) {
                if (googleNewsUrlCache && googleNewsUrlCache[requestedUrl]?.resolvedUrl) {
                    url = googleNewsUrlCache[requestedUrl].resolvedUrl;
                    directCached = await getCachedArticle(url);
                } else {
                    directCached = null;
                }
            }
            if (directCached && !isGoogleNewsArticleUrl(directCached.url || '')) {
                let hostname = '';
                try { hostname = new URL(url).hostname.toLowerCase(); } catch (e) { }
                const availableStrategies = Object.keys(ARTICLE_FETCH_BASE_POINTS).filter(name => name !== 'vietserver' || Boolean(VIETSERVER_PROXY_BASE));
                const methodPreferences = await getArticleFetchPreferences(hostname);
                finishArticleFetchProgress(requestId, 'Article loaded from cache.', { method: 'cache', cached: true });
                if (directCached.pagination?.nextUrl && (hostname === 'voz.vn' || hostname.endsWith('.voz.vn'))) {
                    triggerVozNextPagePrefetch(directCached.pagination.nextUrl, 1);
                }
                if (hostname === 'voz.vn' || hostname.endsWith('.voz.vn')) {
                    triggerVozCurrentPageBackgroundUpdate(url, directCached);
                }
                triggerNextFiveArticlesPrefetch(url);
                return res.json({
                    url,
                    ...directCached,
                    content: cleanArticleMarkup(directCached.content),
                    title: normalizeArticleTitle(directCached.title),
                    cached: true,
                    attemptedStrategies: [directCached.fetchStrategy].filter(Boolean),
                    availableStrategies,
                    methodPreferences
                });
            }
        }

        if (!isGoogleNewsArticleUrl(requestedUrl)) {
            url = await resolveGoogleNewsUrl(requestedUrl, {
                title: req.query.title,
                feedTitle: req.query.feedTitle,
                feedUrl: req.query.feedUrl,
                feedIcon: req.query.feedIcon,
                domain: req.query.domain
            }, { force: bypassCache, backgroundResolve: false });
        }
        let hostname = '';
        try { hostname = new URL(url).hostname.toLowerCase(); } catch (e) { }
        if (rejectedStrategy && rejectedStrategy in ARTICLE_FETCH_BASE_POINTS) {
            excludedStrategies.add(rejectedStrategy);
            await recordArticleFetchOutcome(hostname, rejectedStrategy, false, 'Rejected by user');
            await deleteCachedArticle(url);
        }
        const availableStrategies = Object.keys(ARTICLE_FETCH_BASE_POINTS).filter(name => name !== 'vietserver' || Boolean(VIETSERVER_PROXY_BASE));
        const methodPreferences = await getArticleFetchPreferences(hostname);

        let html = '';
        let htmlStrategy = '';
        const attemptedStrategies = new Set();
        const rankedStrategies = await rankArticleFetchStrategies(hostname);
        const strategyOrder = ((requestedStrategy && requestedStrategy !== 'refresh') ? [requestedStrategy] : rankedStrategies)
            .filter(strategy => !excludedStrategies.has(strategy));
        const strategyLabels = {
            direct: 'publisher website',
            cloudflare: 'reader proxy',
            vietserver: 'Vietnam reader proxy',
            allorigins: 'backup reader proxy',
            jina: 'text reader backup',
            opencli: 'browser reader backup'
        };
        updateArticleFetchProgress(requestId, 'ranking', 'Choosing the best reader method for this source…', {
            methods: strategyOrder.length
        });

        for (let strategyIndex = 0; strategyIndex < strategyOrder.length; strategyIndex++) {
            const strategy = strategyOrder[strategyIndex];
            attemptedStrategies.add(strategy);
            updateArticleFetchProgress(requestId, 'fetching', `Trying ${strategyLabels[strategy] || strategy}…`, {
                current: strategyIndex + 1,
                total: strategyOrder.length
            });
            try {
                if (strategy === 'jina') {
                    const jinaResult = await fetchViaJina(url);
                    await recordArticleFetchOutcome(hostname, strategy, true);
                    finishArticleFetchProgress(requestId, 'Article is ready.', { method: strategy });
                    const payload = {
                        url,
                        ...jinaResult,
                        fetchStrategy: strategy,
                        attemptedStrategies: [...attemptedStrategies],
                        availableStrategies,
                        methodPreferences
                    };
                    await cacheArticleResult(url, payload);
                    triggerNextFiveArticlesPrefetch(url);
                    return res.json(payload);
                }

                if (strategy === 'opencli') {
                    const openCliResult = await fetchViaOpenCli(url);
                    await recordArticleFetchOutcome(hostname, strategy, true);
                    finishArticleFetchProgress(requestId, 'Article is ready.', { method: strategy });
                    const payload = {
                        url,
                        ...openCliResult,
                        fetchStrategy: strategy,
                        attemptedStrategies: [...attemptedStrategies],
                        availableStrategies,
                        methodPreferences
                    };
                    if (payload.pagination?.nextUrl && (hostname === 'voz.vn' || hostname.endsWith('.voz.vn'))) {
                        triggerVozNextPagePrefetch(payload.pagination.nextUrl, 1);
                    }
                    await cacheArticleResult(url, payload);
                    triggerNextFiveArticlesPrefetch(url);
                    return res.json(payload);
                }

                const candidateHtml = await fetchArticleHtmlByStrategy(strategy, url);
                if (hostname === 'voz.vn' || hostname.endsWith('.voz.vn')) {
                    if (candidateHtml.includes('Oops! We ran into some problems.') && candidateHtml.includes('The requested thread could not be found.')) {
                        let articles = await env.RSS_DATA.get('articles', { type: 'json' }) || [];
                        const articlesBefore = articles.length;
                        articles = articles.filter(a => !(a.link === url || a.url === url || (a.link && a.link.split('?')[0].replace(/\/unread\/?$/, '') === url.split('?')[0].replace(/\/unread\/?$/, ''))));
                        if (articles.length < articlesBefore) {
                            await env.RSS_DATA.put('articles', JSON.stringify(articles));
                            console.log(`[VOZ] Removed deleted thread: ${url}`);
                        }
                        return res.json({ error: 'Thread deleted', url });
                    }
                }

                if (!isUsableArticlePage(candidateHtml)) throw new Error('Fetched page did not contain usable article HTML');
                html = candidateHtml;
                htmlStrategy = strategy;
                break;
            } catch (error) {
                await recordArticleFetchOutcome(hostname, strategy, false, error.message);
            }
        }

        if (!html) {
            finishArticleFetchProgress(requestId, 'No reader method could load this article.', { failed: true });
            return res.json({
                error: 'Failed to fetch article',
                url,
                attemptedStrategies: [...attemptedStrategies],
                availableStrategies,
                methodPreferences
            });
        }

        const result = await parseArticleHtmlContent(html, url, htmlStrategy, [...attemptedStrategies], availableStrategies, methodPreferences, requestId, excludedStrategies);
        const extractedTextLength = (result.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
        const extractionSucceeded = extractedTextLength >= 200 || /<(?:video|audio|img)\b/i.test(result.content || '');

        finishArticleFetchProgress(requestId, extractionSucceeded ? 'Article is ready.' : 'Only part of the article could be recovered.', {
            method: result.fetchStrategy,
            partial: !extractionSucceeded
        });
        if (extractionSucceeded) await cacheArticleResult(url, result);
        if (result.pagination?.nextUrl && (hostname === 'voz.vn' || hostname.endsWith('.voz.vn'))) {
            triggerVozNextPagePrefetch(result.pagination.nextUrl, 1);
        }
        triggerNextFiveArticlesPrefetch(url);
        res.json(result);
    } catch (e) {
        finishArticleFetchProgress(requestId, 'Article loading failed.', { failed: true });
        res.json({ error: e.message, url });
    }
});

async function parseArticleHtmlContent(html, url, htmlStrategy, attemptedStrategiesInput = [], availableStrategies = [], methodPreferences = {}, requestId = null, excludedStrategiesInput = new Set()) {
    const attemptedStrategies = attemptedStrategiesInput instanceof Set ? attemptedStrategiesInput : new Set(attemptedStrategiesInput || []);
    const excludedStrategies = excludedStrategiesInput instanceof Set ? excludedStrategiesInput : new Set(excludedStrategiesInput || []);
    let hostname = '';
    try { hostname = new URL(url).hostname.toLowerCase(); } catch (e) { }
    if (requestId) updateArticleFetchProgress(requestId, 'extracting', 'Finding the article body, images, and video…');

    const pageAudioUrls = await discoverArticleAudioUrls(html, url);

    let sourceHandler = sourceRegistry.getHandler(url);
    const fetchWithTimeout = (url, options, timeout) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
    };
    if (sourceHandler && sourceHandler.preProcessHtml) {
        html = await sourceHandler.preProcessHtml(html, { fetchWithTimeout });
    }


    // Extract metadata from meta tags
    const result = { url };
    const metaTags = html.match(/<meta[^>]+>/ig) || [];
    for (const tag of metaTags) {
        const contentMatch = tag.match(/content=(["'])([\s\S]*?)\1/i);
        if (!contentMatch) continue;
        const c = contentMatch[2].trim();
        if (/og:title/i.test(tag) && !result.title) result.title = decodeHTMLEntities(c);
        if (/og:image/i.test(tag) && !tag.match(/og:image:(width|height|type|alt)/i) && !result.image && !isInvalidImage(c) && !c.includes('avplayer.com')) result.image = c;
        if (/og:site_name/i.test(tag) && !result.siteName) result.siteName = decodeHTMLEntities(c);
        if (/og:description/i.test(tag) && !result.description) result.description = decodeHTMLEntities(c);
        if (/(article:published_time|datepublished)/i.test(tag) && !result.date) result.date = c;
        if (/author/i.test(tag) && !result.author) result.author = decodeHTMLEntities(c);
    }

    // Fallback title from <title> tag
    if (!result.title) {
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch) result.title = decodeHTMLEntities(titleMatch[1].trim());
    }

    // Fallback image
    if (!result.image || isInvalidImage(result.image) || result.image.includes('avplayer.com')) {
        const extracted = extractImageFromHtml(html, url);
        if (extracted && !isInvalidImage(extracted) && !extracted.includes('avplayer.com')) {
            result.image = extracted;
        }
    }

    if (result.siteName === 'VOZ' || (url && url.includes('voz.vn'))) {
        result.image = null;
    }

    // Extract author from JSON-LD
    const ldJsonMatches = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/ig) || [];
    for (const block of ldJsonMatches) {
        try {
            const cleanJson = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').replace(/[\n\r\t]+/g, ' ').trim();
            const parsed = JSON.parse(cleanJson);
            const schemas = [];
            const schemaQueue = Array.isArray(parsed) ? [...parsed] : [parsed];
            while (schemaQueue.length) {
                const schema = schemaQueue.shift();
                if (!schema || typeof schema !== 'object') continue;
                schemas.push(schema);
                for (const value of Object.values(schema)) {
                    if (Array.isArray(value)) {
                        for (const item of value) if (item && typeof item === 'object') schemaQueue.push(item);
                    } else if (value && typeof value === 'object') {
                        schemaQueue.push(value);
                    }
                }
            }
            for (const schema of schemas) {
                const schemaTypes = Array.isArray(schema['@type']) ? schema['@type'] : [schema['@type']];
                const structuredTitle = schema.headline || (schemaTypes.some(type => /Article$/i.test(type || '')) ? schema.name : '');
                if (structuredTitle) {
                    const decodedTitle = decodeHTMLEntities(String(structuredTitle).trim());
                    if (!result.title || decodedTitle.length >= result.title.length) result.title = decodedTitle;
                }
                if (!result.author && schema.author) {
                    result.author = typeof schema.author === 'string' ? schema.author : (schema.author.name || (Array.isArray(schema.author) ? schema.author[0]?.name : ''));
                }
                if (!result.date && schema.datePublished) result.date = schema.datePublished;
                if (schema.articleBody) result.articleBody = schema.articleBody;
                if (schemaTypes.includes('VideoObject')) {
                    const rawVideoUrl = Array.isArray(schema.contentUrl) ? schema.contentUrl[0] : schema.contentUrl;
                    const videoUrl = safeHttpUrl(rawVideoUrl || schema.encoding?.contentUrl || '');
                    if (videoUrl && /\.(?:mp4|webm|ogg)(?:$|[?#])/i.test(videoUrl)) {
                        const thumbnail = Array.isArray(schema.thumbnailUrl) ? schema.thumbnailUrl[0] : schema.thumbnailUrl;
                        const video = {
                            url: videoUrl,
                            poster: safeHttpUrl(thumbnail || ''),
                            title: String(schema.name || schema.headline || '').trim()
                        };
                        result.videos ||= [];
                        if (!result.videos.some(item => item.url === video.url)) result.videos.push(video);
                    }
                }
            }
        } catch (e) { }
    }

    if (result.videos?.length) {
        result.videoUrl = result.videos[0].url;
        result.videoPoster = result.videos[0].poster;
    }

    // Extract main article content using common selectors via regex
    let articleHtml = '';

    let isCustomSource = false;
    sourceHandler = sourceRegistry.getHandler(url);
    if (sourceHandler && sourceHandler.parseArticleHtmlContent) {
        const parsedContent = sourceHandler.parseArticleHtmlContent(html, url, result, { escapeHtml, extractBalancedElementByClass, fetchWithTimeout });
        const resolvedContent = parsedContent instanceof Promise ? await parsedContent : parsedContent;
        if (resolvedContent !== false) {
            articleHtml = resolvedContent;
            isCustomSource = true;
        }
    }
    
    if (!isCustomSource) {
        const sapoMatch = html.match(/<(?:h[1-6]|div|p)\b[^>]*class=["'][^"']*(?:content-detail-sapo|article-sapo|singular-sapo|story-sapo|detail-sapo|sapo)[^"']*["'][^>]*>([\s\S]*?)<\/(?:h[1-6]|div|p)>/i);
        const sapoHtml = sapoMatch && sapoMatch[1].replace(/<[^>]+>/g, '').trim().length > 30 ? `<p class="article-sapo font-semibold text-lg mb-4 text-gray-800 dark:text-gray-200 leading-relaxed">${sapoMatch[1].trim()}</p>` : '';

        articleHtml = selectBestArticleMarkup(html);
        if (sapoHtml && articleHtml && !articleHtml.includes(sapoHtml.slice(0, 40))) {
            articleHtml = sapoHtml + '\n' + articleHtml;
        }
        if (!articleHtml || scoreArticleMarkup(cleanArticleMarkup(articleHtml)) < 250) {
            const articleSelectors = [
                /<article\b[^>]*>([\s\S]*?)<\/article>/i,
                /<main\b[^>]*>([\s\S]*?)<\/main>/i,
                /<div\b[^>]*class=["'][^"']*(?:article|post|content|entry-content|post-content|article-body|story-body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
                /<section\b[^>]*class=["'][^"']*(?:article|post|content|entry-content|post-content|article-body)[^"']*["'][^>]*>([\s\S]*?)<\/section>/i
            ];
            for (const regex of articleSelectors) {
                const match = html.match(regex);
                if (match) {
                    const captured = match[1] || match[0];
                    const textOnly = captured.replace(/<[^>]+>/g, '').trim();
                    if (textOnly.length > 200) {
                        articleHtml = (sapoHtml ? sapoHtml + '\n' : '') + captured;
                        break;
                    }
                }
            }
        }
    }

        // General final backup for pages whose HTML loaded but whose article
        // body could not be extracted reliably.
        if (!articleHtml && !attemptedStrategies.has('jina') && !excludedStrategies.has('jina')) {
            try {
                attemptedStrategies.add('jina');
                updateArticleFetchProgress(requestId, 'fallback', 'The page layout was unusual; trying the clean text reader…');
                const jinaResult = await fetchViaJina(url);
                if (htmlStrategy) await recordArticleFetchOutcome(hostname, htmlStrategy, false, 'HTML loaded but article body extraction failed');
                await recordArticleFetchOutcome(hostname, 'jina', true);
                finishArticleFetchProgress(requestId, 'Article is ready.', { method: 'jina' });
                const payload = { url, ...jinaResult, fetchStrategy: 'jina', attemptedStrategies: [...attemptedStrategies], availableStrategies, methodPreferences };
                await cacheArticleResult(url, payload);
                return res.json(payload);
            } catch (error) {
                await recordArticleFetchOutcome(hostname, 'jina', false, error.message);
            }
        }

        if (!articleHtml && !attemptedStrategies.has('opencli') && !excludedStrategies.has('opencli')) {
            try {
                attemptedStrategies.add('opencli');
                updateArticleFetchProgress(requestId, 'fallback', 'Trying the browser reader as the final backup…');
                const openCliResult = await fetchViaOpenCli(url);
                await recordArticleFetchOutcome(hostname, 'opencli', true);
                finishArticleFetchProgress(requestId, 'Article is ready.', { method: 'opencli' });
                const payload = { url, ...openCliResult, fetchStrategy: 'opencli', attemptedStrategies: [...attemptedStrategies], availableStrategies, methodPreferences };
                await cacheArticleResult(url, payload);
                return res.json(payload);
            } catch (error) {
                await recordArticleFetchOutcome(hostname, 'opencli', false, error.message);
            }
        }

        // Fallback: if we have articleBody from JSON-LD, wrap it in <p> tags
        if (!articleHtml && result.articleBody) {
            articleHtml = result.articleBody.split(/\n\n+/).map(p => `<p>${p.trim()}</p>`).join('');
        }

        // Fallback: use description/content snippet
        if (!articleHtml && result.description) {
            articleHtml = `<p>${result.description}</p>`;
        }

        updateArticleFetchProgress(requestId, 'cleaning', 'Cleaning spacing and removing unrelated page content…');
        if (!isCustomSource) {
            articleHtml = cleanArticleMarkup(articleHtml);
        } else {
            // Only strip scripts, styles, forms, and template tags for custom sources to preserve specialized markup
            articleHtml = articleHtml.replace(/<(?:script|style|template|nav|form|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|template|nav|form|noscript)>/gi, '');
        }

        if (!result.videos?.length) {
            const vidMatches = [...articleHtml.matchAll(/<video\b[^>]*\bsrc=(["'])(https?:\/\/[^"']+)\1[^>]*>/gi)];
            for (const m of vidMatches) {
                const vUrl = safeHttpUrl(m[2]);
                if (vUrl) {
                    result.videos ||= [];
                    if (!result.videos.some(item => item.url === vUrl)) result.videos.push({ url: vUrl, title: result.title || 'Video' });
                }
            }
            if (result.videos?.length) {
                result.videoUrl = result.videos[0].url;
                if (!result.videoPoster) {
                    const posterMatch = articleHtml.match(/<video\b[^>]*\bposter=(["'])(https?:\/\/[^"']+)\1/i);
                    if (posterMatch) result.videoPoster = safeHttpUrl(posterMatch[2]);
                }
            }
        }

        const preliminaryTextLength = articleHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
        const hasPreliminaryMedia = /<(?:img|picture|video|audio|iframe)\b/i.test(articleHtml);
        const malformedArticleMarkup = isMalformedArticleMarkup(articleHtml);
        if ((malformedArticleMarkup || (preliminaryTextLength < 200 && !hasPreliminaryMedia)) && !attemptedStrategies.has('jina') && !excludedStrategies.has('jina')) {
            try {
                attemptedStrategies.add('jina');
                updateArticleFetchProgress(requestId, 'fallback', 'The first result was incomplete; trying the clean text reader…');
                const jinaResult = await fetchViaJina(url);
                if (htmlStrategy) await recordArticleFetchOutcome(hostname, htmlStrategy, false, 'Extracted article fragment was incomplete');
                await recordArticleFetchOutcome(hostname, 'jina', true);
                finishArticleFetchProgress(requestId, 'Article is ready.', { method: 'jina' });
                const payload = { url, ...jinaResult, fetchStrategy: 'jina', attemptedStrategies: [...attemptedStrategies], availableStrategies, methodPreferences };
                await cacheArticleResult(url, payload);
                return res.json(payload);
            } catch (error) {
                await recordArticleFetchOutcome(hostname, 'jina', false, error.message);
                if (malformedArticleMarkup) articleHtml = '';
            }
        }

        if ((malformedArticleMarkup || (preliminaryTextLength < 200 && !hasPreliminaryMedia)) && !attemptedStrategies.has('opencli') && !excludedStrategies.has('opencli')) {
            try {
                attemptedStrategies.add('opencli');
                updateArticleFetchProgress(requestId, 'fallback', 'Trying the browser reader as the final backup…');
                const openCliResult = await fetchViaOpenCli(url);
                if (htmlStrategy) await recordArticleFetchOutcome(hostname, htmlStrategy, false, 'Extracted article fragment was incomplete');
                await recordArticleFetchOutcome(hostname, 'opencli', true);
                finishArticleFetchProgress(requestId, 'Article is ready.', { method: 'opencli' });
                const payload = { url, ...openCliResult, fetchStrategy: 'opencli', attemptedStrategies: [...attemptedStrategies], availableStrategies, methodPreferences };
                await cacheArticleResult(url, payload);
                return res.json(payload);
            } catch (error) {
                await recordArticleFetchOutcome(hostname, 'opencli', false, error.message);
                if (malformedArticleMarkup) articleHtml = '';
            }
        }

        const pendingVideos = (result.videos || []).filter(video => !articleHtml.includes(video.url));
        const renderVideo = video => {
            const poster = video.poster ? ' poster="' + escapeHtml(video.poster) + '"' : '';
            const label = video.title ? ' aria-label="' + escapeHtml(video.title) + '"' : '';
            return '<video controls playsinline preload="metadata"' + poster + label + ' src="' + escapeHtml(video.url) + '">Your browser does not support HTML5 video.</video>';
        };

        let placedVideoCount = 0;
        if (pendingVideos.length) {
            // Replace empty/custom player placeholders in document order so
            // video stays where the publisher placed it in the article.
            articleHtml = articleHtml.replace(
                /<(div|span|b|figure)\b[^>]*class=(["'])[^"']*(?:video-element|video-player|player-video|embed-video)[^"']*\2[^>]*>[\s\S]*?<\/\1>/gi,
                placeholder => placedVideoCount < pendingVideos.length ? renderVideo(pendingVideos[placedVideoCount++]) : placeholder
            );

            // Some publishers use a video iframe rather than an empty player
            // placeholder. Replace only frames that identify themselves as media.
            articleHtml = articleHtml.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, iframe => {
                if (placedVideoCount >= pendingVideos.length || !/(?:video|youtube|vimeo|player)/i.test(iframe)) return iframe;
                return renderVideo(pendingVideos[placedVideoCount++]);
            });

            // If structured video metadata exists but the source has no usable
            // placeholder, keep the video available as a graceful fallback.
            if (placedVideoCount === 0 && !/<video\b/i.test(articleHtml)) {
                articleHtml = renderVideo(pendingVideos[0]) + articleHtml;
                placedVideoCount = 1;
            }
        }

        // Clean the extracted HTML
        if (articleHtml) {
            // Remove script/style tags
            articleHtml = articleHtml.replace(/<script[\s\S]*?<\/script>/gi, '');
            articleHtml = articleHtml.replace(/<style[\s\S]*?<\/style>/gi, '');

            // Promote lazy-loaded media attributes to native browser
            // attributes while preserving each element's article position.
            try {
                const baseUrl = new URL(url);
                const resolveMediaUrl = value => {
                    try {
                        return safeHttpUrl(new URL(decodeHTMLEntities(value), baseUrl).href);
                    } catch (e) {
                        return '';
                    }
                };

                articleHtml = articleHtml.replace(/<(?:img|video|audio)\b[^>]*>/gi, tag => {
                    const lazySource = tag.match(/\s(?:data-src|data-url|data-original|data-original-src|data-lazy-src)=(["'])([\s\S]*?)\1/i);
                    if (lazySource) {
                        const resolved = resolveMediaUrl(lazySource[2]);
                        if (resolved) {
                            const attribute = ' src="' + escapeHtml(resolved) + '"';
                            tag = /\ssrc=(["'])([\s\S]*?)\1/i.test(tag)
                                ? tag.replace(/\ssrc=(["'])([\s\S]*?)\1/i, attribute)
                                : tag.replace(/\s*\/?>$/, attribute + '>');
                        }
                    }

                    const lazyPoster = tag.match(/\sdata-poster=(["'])([\s\S]*?)\1/i);
                    if (lazyPoster) {
                        const resolvedPoster = resolveMediaUrl(lazyPoster[2]);
                        if (resolvedPoster) {
                            const attribute = ' poster="' + escapeHtml(resolvedPoster) + '"';
                            tag = /\sposter=(["'])([\s\S]*?)\1/i.test(tag)
                                ? tag.replace(/\sposter=(["'])([\s\S]*?)\1/i, attribute)
                                : tag.replace(/\s*\/?>$/, attribute + '>');
                        }
                    }
                    return tag;
                });

                articleHtml = articleHtml.replace(/<source\b[^>]*>/gi, tag => {
                    const lazySource = tag.match(/\sdata-src=(["'])([\s\S]*?)\1/i);
                    if (lazySource) {
                        const resolved = resolveMediaUrl(lazySource[2]);
                        if (resolved) {
                            const attribute = ' src="' + escapeHtml(resolved) + '"';
                            tag = /\ssrc=(["'])([\s\S]*?)\1/i.test(tag)
                                ? tag.replace(/\ssrc=(["'])([\s\S]*?)\1/i, attribute)
                                : tag.replace(/\s*\/?>$/, attribute + '>');
                        }
                    }

                    const lazySrcset = tag.match(/\sdata-srcset=(["'])([\s\S]*?)\1/i);
                    if (lazySrcset) {
                        const resolvedSet = lazySrcset[2].split(',').map(candidate => {
                            const parts = candidate.trim().split(/\s+/);
                            const resolved = resolveMediaUrl(parts.shift() || '');
                            return resolved ? [resolved, ...parts].join(' ') : '';
                        }).filter(Boolean).join(', ');
                        if (resolvedSet) {
                            const attribute = ' srcset="' + escapeHtml(resolvedSet) + '"';
                            tag = /\ssrcset=(["'])([\s\S]*?)\1/i.test(tag)
                                ? tag.replace(/\ssrcset=(["'])([\s\S]*?)\1/i, attribute)
                                : tag.replace(/\s*\/?>$/, attribute + '>');
                        }
                    }
                    return tag;
                });
            } catch (e) { }

            articleHtml = articleHtml.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (iframeMatch) => {
                const srcMatch = iframeMatch.match(/\bsrc=(["'])([\s\S]*?)\1/i);
                const src = srcMatch ? srcMatch[2].toLowerCase() : '';
                if (!src || /(doubleclick|googlesyndication|adnxs|tracking|analytics|banner|widget\/like|fbevents)/i.test(src)) {
                    return '';
                }
                if (/(youtube|youtube-nocookie|youtu\.be|vimeo|tiktok|bilibili|dailymotion|facebook|instagram|twitter|x\.com|embed|player|video|tinhte\.vn)/i.test(src)) {
                    return iframeMatch;
                }
                return '';
            });
            // Remove inline event handlers
            articleHtml = articleHtml.replace(/\s+on\w+="[^"]*"/gi, '');
            articleHtml = articleHtml.replace(/\s+on\w+='[^']*'/gi, '');
            // Fix relative image URLs
            try {
                const baseUrl = new URL(url);
                articleHtml = articleHtml.replace(/src=["'](\/(?!api\/)[^"']+)["']/g, `src="${baseUrl.origin}$1"`);
                articleHtml = articleHtml.replace(/href=["'](\/(?!api\/)[^"']+)["']/g, `href="${baseUrl.origin}$1"`);
            } catch(e) {}
        }

        if (pageAudioUrls.length) {
            const missingAudio = pageAudioUrls.filter(audioUrl => !String(articleHtml || '').includes(audioUrl));
            if (missingAudio.length) {
                const players = missingAudio.map(audioUrl => '<audio controls playsinline preload="metadata" src="' + escapeHtml(audioUrl) + '">Your browser does not support HTML5 audio.</audio>').join('');
                articleHtml = players + (articleHtml || '');
            }
            result.audioCount = pageAudioUrls.length;
        }

        const extractedTextLength = (articleHtml || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
        const extractionSucceeded = extractedTextLength >= 200 || /<(?:video|audio|img)\b/i.test(articleHtml || '');
        if (htmlStrategy) {
            await recordArticleFetchOutcome(
                hostname,
                htmlStrategy,
                extractionSucceeded,
                extractionSucceeded ? '' : 'HTML loaded but extracted article content was too small'
            );
        }

        result.content = articleHtml || '<p>Could not extract article content. Please open the article directly.</p>';
        result.title = normalizeArticleTitle(result.title);
        result.fetchStrategy = htmlStrategy || 'none';
        result.attemptedStrategies = [...attemptedStrategies];
        result.availableStrategies = availableStrategies;
        result.methodPreferences = methodPreferences;
        delete result.articleBody; // Don't send raw JSON-LD body

    return result;
}

app.post('/api/feeds', authMiddleware, async (req, res) => {
    try {
        let { url: feedUrl, category } = req.body;
        feedUrl = feedUrl.trim();
        if (!feedUrl.startsWith('http')) feedUrl = 'https://' + feedUrl;
        let feeds = await env.RSS_DATA.get('feeds', { type: 'json' }) || [];

        if (!feeds.find(f => f.url === feedUrl)) {
            let cleanHostname = new URL(feedUrl).hostname;
            if (cleanHostname.includes('dj.com') || cleanHostname.includes('wsj')) cleanHostname = 'wsj.com';
            if (cleanHostname.includes('bbc')) cleanHostname = 'bbc.com';
            let iconUrl = publisherIcon(cleanHostname);
            
            feeds.push({
                url: feedUrl,
                title: cleanHostname,
                category: category || 'Others',
                icon: iconUrl
            });
            await env.RSS_DATA.put('feeds', JSON.stringify(feeds));
        }
        res.status(200).send('Added');
    } catch (e) {
        res.status(400).send(e.message);
    }
});

app.put('/api/feeds', authMiddleware, async (req, res) => {
    const { url: feedUrl, title, category } = req.body;
    let feeds = await env.RSS_DATA.get('feeds', { type: 'json' }) || [];
    let feedIndex = feeds.findIndex(f => f.url === feedUrl);
    if (feedIndex > -1) {
        feeds[feedIndex].title = title;
        feeds[feedIndex].category = category;
        await env.RSS_DATA.put('feeds', JSON.stringify(feeds));
        res.status(200).send('Updated');
    } else {
        res.status(404).send('Not Found');
    }
});

app.delete('/api/feeds', authMiddleware, async (req, res) => {
    const { url: feedUrl } = req.body;
    let feeds = await env.RSS_DATA.get('feeds', { type: 'json' }) || [];
    const beforeCount = feeds.length;
    feeds = feeds.filter(f => f.url !== feedUrl);
    if (feeds.length < beforeCount) {
        if (feeds.length === 0) return res.status(409).send('The final feed cannot be removed because it would leave the database without a source.');
        await env.RSS_DATA.put('feeds', JSON.stringify(feeds));
        // Also remove articles belonging to the deleted feed
        let articles = await env.RSS_DATA.get('articles', { type: 'json' }) || [];
        const articlesBefore = articles.length;
        articles = articles.filter(a => a.feedUrl !== feedUrl);
        if (articles.length > 0 || articlesBefore === 0) {
            await env.RSS_DATA.put('articles', JSON.stringify(articles), { allowLargeReduction: true });
        } else {
            console.error('[DB SAFETY] Feed removal would wipe every stored article; old articles were retained until another source syncs.');
        }
        console.log(`[FEEDS] Deleted feed "${feedUrl}" and removed ${articlesBefore - articles.length} associated articles.`);
    }
    res.status(200).send('Deleted');
});

app.post('/api/feeds/reorder', authMiddleware, async (req, res) => {
    try {
        const { feeds: newFeedsOrder } = req.body;
        if (!Array.isArray(newFeedsOrder)) return res.status(400).send('Invalid data format');
        const currentFeeds = await env.RSS_DATA.get('feeds', { type: 'json' }) || [];
        const currentUrls = currentFeeds.map(feed => feed.url).sort();
        const incomingUrls = newFeedsOrder.map(feed => feed?.url).filter(Boolean).sort();
        if (currentUrls.length !== incomingUrls.length || currentUrls.some((url, index) => url !== incomingUrls[index])) {
            return res.status(400).send('Reorder must contain every existing feed exactly once.');
        }
        await env.RSS_DATA.put('feeds', JSON.stringify(newFeedsOrder));
        res.status(200).send('Reordered');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.post('/api/categories/reorder', authMiddleware, async (req, res) => {
    try {
        const { categoryOrder } = req.body;
        if (!Array.isArray(categoryOrder)) return res.status(400).send('Invalid format');
        await env.RSS_DATA.put('categoryOrder', JSON.stringify(categoryOrder));
        res.status(200).send('Categories Reordered');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.post('/api/user-preferences', authMiddleware, async (req, res) => {
    try {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: 'Missing key' });
        let prefs = await env.RSS_DATA.get('userPreferences', { type: 'json' }) || {};
        prefs[key] = value;
        await env.RSS_DATA.put('userPreferences', prefs);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/toggle', authMiddleware, async (req, res) => {
    const { link, list, forceAdd, forceRemove } = req.body;
    if (!['readStates', 'savedStates', 'boardStates', 'hiddenStates'].includes(list)) return res.status(400).send('Invalid List');

    let stateArray = await env.RSS_DATA.get(list, { type: 'json' }) || [];
    if (forceRemove) {
        stateArray = stateArray.filter(item => item !== link);
    } else if (forceAdd) {
        stateArray = stateArray.filter(item => item !== link);
        stateArray.push(link);
    } else {
        if (stateArray.includes(link)) stateArray = stateArray.filter(l => l !== link);
        else stateArray.push(link);
    }
    if (stateArray.length > 2000) stateArray.shift();
    await env.RSS_DATA.put(list, JSON.stringify(stateArray));

    if (list === 'readStates' && forceAdd) {
        for (const bumpList of ['savedStates', 'boardStates']) {
            let bArray = await env.RSS_DATA.get(bumpList, { type: 'json' }) || [];
            if (bArray.includes(link)) {
                bArray = bArray.filter(l => l !== link);
                bArray.push(link);
                await env.RSS_DATA.put(bumpList, JSON.stringify(bArray));
            }
        }
    }

    res.status(200).send('Toggled');
});

app.get('/api/proxy-image', authMiddleware, async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing URL');
    try {
        const fetchUrl = CF_PROXY_BASE + encodeURIComponent(targetUrl);
        const imgRes = await fetch(fetchUrl, {
            headers: {
                ...BROWSER_HEADERS,
                'Referer': new URL(targetUrl).origin + '/',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
        });
        if (imgRes.ok) {
            const buffer = await imgRes.arrayBuffer();
            res.setHeader('Content-Type', imgRes.headers.get('Content-Type') || 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.send(Buffer.from(buffer));
        }
    } catch (e) {
        console.error(`[PROXY CRASH] ${e.message}`);
    }
    res.status(404).send('Not found');
});

app.get('/api/og-image', authMiddleware, async (req, res) => {
    const targetUrl = req.query.url;
    const rssFallback = req.query.rss;
    if (!targetUrl) return res.status(400).send('Missing URL');
    try {
        const scrapeUrl = targetUrl.replace(/\/unread\/?$/, '');
        const foundImg = await getBestImage(scrapeUrl, async (u) => fetch(u, { headers: BROWSER_HEADERS }), rssFallback);
        if (foundImg) {
            if (foundImg.includes('dantri.com.vn') || foundImg.includes('baodautu.vn')) {
                return res.redirect(301, `/api/proxy-image?url=${encodeURIComponent(foundImg)}`);
            }
            return res.redirect(301, foundImg);
        }
        res.status(404).send('Image not found');
    } catch (e) {
        res.status(500).send('Error');
    }
});

// ============================================================================
// CRON SCHEDULER & HTML SERVING
// ============================================================================

app.get('/script.js', async (req, res) => {
    try {
        const js = await fs.readFile('./script.js', 'utf8');
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(js);
    } catch (e) {
        res.status(500).send('Error loading script');
    }
});
app.get('/', async (req, res) => {
    try {
        const html = await fs.readFile('./index.html', 'utf8');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(html);
    } catch (e) {
        res.status(500).send('Please create an index.html file with your frontend code.');
    }
});

// ============================================================================
// CONTINUOUS SEQUENTIAL SYNC QUEUE & UNIVERSAL TAB PREFETCH
// ============================================================================

let isUniversalPrefetching = false;
async function runUniversalTabPrefetch(env) {
    if (isUniversalPrefetching) return;
    isUniversalPrefetching = true;
    try {
        console.log('\n[PREFETCH ENGINE] Starting universal prefetch for first 5 articles of all tabs...');
        const articles = await env.RSS_DATA.get('articles', { type: 'json' }) || [];
        const blockedKeywords = await env.RSS_DATA.get('blockedArticleKeywords', { type: 'json' }) || [];
        const blockedKeywordEntries = normalizeBlockedKeywordEntries(blockedKeywords);
        const articleIsBlocked = article => articleContentFilterMatches(article, blockedKeywordEntries);
        const safeDate = dateVal => { try { const d = new Date(dateVal); return isNaN(d.getTime()) ? 0 : d.getTime(); } catch(e) { return 0; } };
        const smartClustersRaw = await env.RSS_DATA.get('smartClusters', { type: 'json' }) || [];
        const smartClusters = smartClustersRaw.map(c => cleanStoredCluster(c)).filter(a => a && !articleIsBlocked(a));
        const activeArticles = articles.filter(a => a && !articleIsBlocked(a));

        const topArticlesMap = new Map();
        const addTopFive = (list) => {
            if (!Array.isArray(list)) return;
            for (let i = 0; i < Math.min(5, list.length); i++) {
                const art = list[i];
                if (!art) continue;
                const url = art.originalLink || art.link;
                if (url && !topArticlesMap.has(url)) {
                    topArticlesMap.set(url, art);
                }
            }
        };

        // 1. Smart tabs top 5 each
        const smartCategories = ['news_vietnam', 'news_world', 'finance_vietnam', 'finance_global', 'tech'];
        for (const cat of smartCategories) {
            const catArticles = smartClusters.filter(a => {
                if (cat === 'news_vietnam' || cat === 'news_world') return ['news_vietnam', 'news_world'].includes(a.smartCategory) && (cat === 'news_vietnam' ? a.smartCategory === 'news_vietnam' : a.smartCategory === 'news_world');
                if (cat === 'finance_vietnam' || cat === 'finance_global') return ['finance_vietnam', 'finance_global'].includes(a.smartCategory) && (cat === 'finance_vietnam' ? a.smartCategory === 'finance_vietnam' : a.smartCategory === 'finance_global');
                return a.smartCategory === cat;
            }).sort((a, b) =>
                (b.hotness || 0) - (a.hotness || 0) ||
                (b.sourceWeight || 1) - (a.sourceWeight || 1) ||
                (new Date(b.pubDate || 0).getTime()) - (new Date(a.pubDate || 0).getTime())
            );
            addTopFive(catArticles);
        }

        // 2. Standard main tabs top 5 each
        const todaySorted = [...activeArticles].sort((a, b) => (new Date(b.pubDate || 0).getTime()) - (new Date(a.pubDate || 0).getTime()));
        addTopFive(todaySorted);

        const now = Date.now();
        const hotToday = activeArticles.filter(a => safeDate(a.pubDate) > now - 24 * 60 * 60 * 1000)
            .sort((a, b) => ((b.views || 0) + (b.clicks || 0) * 3) - ((a.views || 0) + (a.clicks || 0) * 3));
        addTopFive(hotToday);

        const hotWeek = activeArticles.filter(a => safeDate(a.pubDate) > now - 7 * 24 * 60 * 60 * 1000)
            .sort((a, b) => ((b.views || 0) + (b.clicks || 0) * 3) - ((a.views || 0) + (a.clicks || 0) * 3));
        addTopFive(hotWeek);

        const viewsToday = [...activeArticles].filter(a => safeDate(a.pubDate) > now - 24 * 60 * 60 * 1000)
            .sort((a, b) => (b.views || 0) - (a.views || 0));
        addTopFive(viewsToday);

        // 3. Every Category tab top 5 each
        const allCategories = new Set(activeArticles.map(a => a.category).filter(Boolean));
        for (const catName of allCategories) {
            const catList = activeArticles.filter(a => a.category === catName)
                .sort((a, b) => (new Date(b.pubDate || 0).getTime()) - (new Date(a.pubDate || 0).getTime()));
            addTopFive(catList);
        }

        const toProcess = Array.from(topArticlesMap.values());
        console.log(`[PREFETCH ENGINE] Found ${toProcess.length} unique top-5 articles across all tabs. Checking cache and prefetching...`);

        let prefetchedCount = 0;
        for (const art of toProcess) {
            const url = art.originalLink || art.link;
            if (!url) continue;
            let cached = await getCachedArticle(url);
            if (!cached && googleNewsUrlCache && googleNewsUrlCache[url]?.resolvedUrl) {
                cached = await getCachedArticle(googleNewsUrlCache[url].resolvedUrl);
            }
            if (cached && cached.content) continue; // Already saved on disk, ready to serve!

            try {
                const hostname = (() => { try { return new URL(url).hostname.toLowerCase(); } catch(e) { return ''; } })();
                const strategyOrder = await rankArticleFetchStrategies(hostname);
                let html = '';
                let htmlStrategy = '';
                for (const strategy of strategyOrder) {
                    try {
                        const candidateHtml = await fetchArticleHtmlByStrategy(strategy, url);
                        if (isUsableArticlePage(candidateHtml)) {
                            html = candidateHtml;
                            htmlStrategy = strategy;
                            break;
                        }
                    } catch (e) {}
                }
                if (html) {
                    const parsedPayload = await parseArticleHtmlContent(html, url, htmlStrategy, [htmlStrategy], strategyOrder, {}, null);
                    if (parsedPayload && parsedPayload.content) {
                        parsedPayload.title = normalizeArticleTitle(parsedPayload.title || art.title || '');
                        await cacheArticleResult(url, parsedPayload);
                        prefetchedCount++;
                        await new Promise(r => setTimeout(r, 600));
                    }
                }
            } catch (e) {}
        }
        console.log(`[PREFETCH ENGINE] Universal prefetch completed. Prefetched and saved ${prefetchedCount} new articles to disk.`);
    } catch (err) {
        console.error('[PREFETCH ENGINE] Fatal error:', err.message);
    } finally {
        isUniversalPrefetching = false;
    }
}

async function startSequentialSyncLoop() {
    console.log('🚀 [SYNC QUEUE] Sequential sync engine initialized.');

    while (true) {
        if (syncPaused) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            continue;
        }

        const cycleStart = Date.now();

        try {
            let feeds = await env.RSS_DATA.get('feeds', { type: 'json' }) || [];

            if (feeds.length === 0) {
                console.log('[SYNC QUEUE] No feeds found. Waiting before next check...');
            } else {
                console.log(`\n[SYNC QUEUE] Starting new cycle. Processing ${feeds.length} feeds sequentially...`);

                for (let i = 0; i < feeds.length; i++) {
                    const feed = feeds[i];
                    console.log(`[SYNC QUEUE] (${i + 1}/${feeds.length}) Fetching: ${feed.title || feed.url}`);

                    await syncFeeds(env, feed.url);

                    if (i < feeds.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
                lastSyncCompletedAt = Date.now();
                runUniversalTabPrefetch(env).catch(e => console.error('[PREFETCH ENGINE] Error:', e.message));
            }
        } catch (err) {
            console.error('[SYNC QUEUE] Cycle encountered a fatal error:', err.message);
        }

        // Trigger garbage collection after each cycle to reclaim fetch buffers
        if (global.gc) {
            global.gc();
            const mem = process.memoryUsage();
            console.log(`[GC] Post-cycle: RSS=${(mem.rss / 1024 / 1024).toFixed(0)}MB, Heap=${(mem.heapUsed / 1024 / 1024).toFixed(0)}MB/${(mem.heapTotal / 1024 / 1024).toFixed(0)}MB`);
        }

        const cycleDuration = Date.now() - cycleStart;
        const MINIMUM_TIME = 10 * 60 * 1000;

        if (cycleDuration < MINIMUM_TIME) {
            const waitTime = MINIMUM_TIME - cycleDuration;
            console.log(`[SYNC QUEUE] Cycle finished in ${Math.round(cycleDuration / 1000)}s. Sleeping for ${Math.round(waitTime / 1000)}s to enforce 10-minute minimum...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
            console.log(`[SYNC QUEUE] Cycle took ${Math.round(cycleDuration / 1000)}s. Restarting immediately...`);
        }
    }
}

// IMPORTANT: Listen FIRST, then start sync. This ensures the HTTP server is
// always available even if the sync loop causes issues. Previously, the sync
// loop started before listen(), which meant OOM kills during sync could
// prevent port 3000 from ever binding.
const isMainModule = import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('/server.js') || import.meta.url.endsWith('\\server.js');
if (isMainModule) {
    app.listen(PORT, () => {
        console.log(`🚀 RSS Reader running on http://localhost:${PORT}`);
        cleanupArticleCache();
        const articleCacheCleanupTimer = setInterval(cleanupArticleCache, 60 * 60 * 1000);
        if (articleCacheCleanupTimer.unref) articleCacheCleanupTimer.unref();
        smartNews.start();
        startSequentialSyncLoop();
        setTimeout(() => runUniversalTabPrefetch(env), 8000);
        const prefetchTimer = setInterval(() => runUniversalTabPrefetch(env), 30 * 60 * 1000);
        if (prefetchTimer.unref) prefetchTimer.unref();
    });
}

export {
    parseJinaReaderText,
    trimJinaArticleMarkdown,
    stripJinaLeadingNavigation,
    cleanArticleMarkup,
    jinaMarkdownToHtml,
    normalizeArticleTitle
};
