import { decodeHTMLEntities, normalizeArticleTitle } from '../../feed-parsers.js';
import { safeHttpUrl, escapeHtml, isInvalidImage } from '../utils/article-utils.js';
import { isDeletedArticlePayload, deletedSourceKind, deletedSourceTitle } from '../article-source-state.js';
import sourceRegistry from '../sources/index.js';
import { normalizeArticleMediaMarkup } from '../../article-media.js';
import { cleanArticleMarkup } from './markup.js';

function renderJinaInline(text = '', pageUrl = '') {
    const placeholders = [];
    const stash = html => {
        const token = '@@JINA' + placeholders.length + '@@';
        placeholders.push(html);
        return token;
    };

    const resolveLink = value => {
        const decoded = decodeHTMLEntities(String(value || '').trim());
        if (/^#[^\s]+$/.test(decoded)) return decoded;
        try {
            const resolved = pageUrl ? new URL(decoded, pageUrl).href : decoded;
            return safeHttpUrl(resolved);
        } catch (error) {
            return '';
        }
    };
    const renderLinkLabel = value => escapeHtml(String(value || '').replace(/\\([\\`*_[\]{}()#+\-.!>])/g, '$1'))
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,;:!?])/g, '$1<em>$2</em>')
        .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/g, '$1<em>$2</em>')
        .replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');

    let rendered = String(text);
    // Empty Markdown links are icon-only share/comment controls after reader
    // extraction. They have no article text and are never useful in Reader.
    rendered = rendered.replace(/\[\]\([^\n)]*\)/g, '');
    rendered = rendered.replace(/\\\[\s*([a-z])\s*\\\]/gi, (match, marker) => {
        return stash('<sup class="article-reference-marker" aria-label="Reference ' + escapeHtml(marker) + '">[' + escapeHtml(marker) + ']</sup>');
    });
    rendered = rendered.replace(/\[\\\[\s*([a-z])\s*\\\]\]\((#[^)\s]+)(?:\s+"[^"]*")?\)/gi, (match, marker, anchor) => {
        return stash('<sup class="article-reference-marker"><a class="article-inline-link" href="' + escapeHtml(anchor) + '">[' + escapeHtml(marker) + ']</a></sup>');
    });
    rendered = rendered.replace(/\[([a-z])\]\((#[^)\s]+)(?:\s+"[^"]*")?\)/gi, (match, marker, anchor) => {
        return stash('<sup class="article-reference-marker"><a class="article-inline-link" href="' + escapeHtml(anchor) + '">[' + escapeHtml(marker) + ']</a></sup>');
    });
    rendered = rendered.replace(/(^|[\s(])\[([a-z])\](?=$|[\s).,;:!?])/gi, (match, prefix, marker) => {
        return prefix + stash('<sup class="article-reference-marker" aria-label="Reference ' + escapeHtml(marker) + '">[' + escapeHtml(marker) + ']</sup>');
    });
    rendered = rendered.replace(/<audio\b[^>]*\bsrc=(['"])([^'"]+)\1[^>]*>[\s\S]*?<\/audio>/gi, (match, quote, audioUrl) => {
        const safeAudio = safeHttpUrl(decodeHTMLEntities(audioUrl));
        if (!safeAudio || !/\.(?:mp3|m4a|aac|ogg|oga|wav|flac)(?:$|[?#])/i.test(safeAudio)) return '';
        return stash('<div class="article-audio-player"><audio controls playsinline preload="metadata" src="' + escapeHtml(safeAudio) + '">Audio playback is not supported by this browser.</audio></div>');
    });
    rendered = rendered.replace(/<video\b[^>]*\bsrc=(['"])([^'"]+)\1[^>]*>[\s\S]*?<\/video>/gi, (match, quote, videoUrl) => {
        const safeVideo = safeHttpUrl(decodeHTMLEntities(videoUrl));
        if (!safeVideo || !/\.(?:m3u8|mp4|webm|ogg)(?:$|[?#])/i.test(safeVideo)) return '';
        return stash('<video controls playsinline preload="metadata" src="' + escapeHtml(safeVideo) + '">Video playback is not supported by this browser.</video>');
    });
    rendered = rendered.replace(/\[!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g, (match, alt, imageUrl, linkUrl) => {
        const safeImage = resolveLink(imageUrl);
        if (!safeImage) return alt;
        return stash('<img src="' + escapeHtml(safeImage) + '" alt="' + escapeHtml(alt) + '">');
    });
    rendered = rendered.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g, (match, alt, imageUrl) => {
        const safeImage = resolveLink(imageUrl);
        if (!safeImage) return alt;
        return stash('<img src="' + escapeHtml(safeImage) + '" alt="' + escapeHtml(alt) + '">');
    });
    rendered = rendered.replace(/\[(?:Video|Clip)\s+\d+\]\((https?:\/\/[^)\s]+\.(?:m3u8|mp4|webm|ogg)(?:[?#][^)\s]*)?)(?:\s+"[^"]*")?\)/gi, (match, videoUrl) => {
        const safeVideo = resolveLink(videoUrl);
        if (!safeVideo) return '';
        return stash('<video controls playsinline preload="metadata" src="' + escapeHtml(safeVideo) + '">Video playback is not supported by this browser.</video>');
    });
    rendered = rendered.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+\.(?:mp3|m4a|aac|ogg|oga|wav|flac)(?:[?#][^)\s]*)?)(?:\s+"[^"]*")?\)/gi, (match, label, audioUrl) => {
        const safeAudio = resolveLink(audioUrl);
        if (!safeAudio) return label;
        return stash('<div class="article-audio-player"><audio controls playsinline preload="metadata" src="' + escapeHtml(safeAudio) + '">Audio playback is not supported by this browser.</audio></div>');
    });
    rendered = rendered.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g, (match, label, linkUrl) => {
        const safeLink = resolveLink(linkUrl);
        if (!safeLink) return label;
        return stash('<a class="article-inline-link" href="' + escapeHtml(safeLink) + '" target="_blank" rel="noopener noreferrer">' + renderLinkLabel(label) + '</a>');
    });
    rendered = rendered.replace(/\[([^\]]+)\]\((#[^)\s]+)(?:\s+"[^"]*")?\)/g, (match, label, anchor) => {
        return stash('<a class="article-inline-link" href="' + escapeHtml(anchor) + '">' + renderLinkLabel(label) + '</a>');
    });

    // Protect explicitly escaped Markdown punctuation before emphasis parsing.
    // This keeps identifiers such as \_id\_ literal without leaking the
    // backslashes into rendered article text.
    rendered = rendered.replace(/\\([\\`*_[\]{}()#+\-.!>])/g, (match, character) => stash(escapeHtml(character)));

    rendered = escapeHtml(rendered)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,;:!?])/g, '$1<em>$2</em>')
        .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/g, '$1<em>$2</em>')
        .replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');

    // A linked image can create a placeholder inside another placeholder.
    // Resolve repeatedly so no internal @@JINA…@@ token leaks into the UI.
    for (let pass = 0; pass <= placeholders.length && /@@JINA\d+@@/.test(rendered); pass++) {
        rendered = rendered.replace(/@@JINA(\d+)@@/g, (match, index) => placeholders[Number(index)] || '');
    }
    return rendered.replace(/@@JINA\d+@@/g, '');
}

function jinaMarkdownToHtml(markdown = '', pageUrl = '') {
    const html = [];
    let paragraph = [];
    let listType = null;

    const flushParagraph = () => {
        if (paragraph.length) {
            html.push('<p>' + renderJinaInline(paragraph.join(' '), pageUrl) + '</p>');
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
            html.push('<h' + level + '>' + renderJinaInline(heading[2], pageUrl) + '</h' + level + '>');
        } else if (unordered || ordered) {
            flushParagraph();
            const nextListType = unordered ? 'ul' : 'ol';
            if (listType !== nextListType) {
                closeList();
                listType = nextListType;
                html.push('<' + listType + '>');
            }
            html.push('<li>' + renderJinaInline((unordered || ordered)[1], pageUrl) + '</li>');
        } else if (quote) {
            flushParagraph();
            closeList();
            html.push('<blockquote>' + renderJinaInline(quote[1], pageUrl) + '</blockquote>');
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
        .filter(line => {
            const mediaControl = line.match(/^\s*\[(?:Video|Audio|Tập|Ep)\s+\d+\]\(([^)]+)\)\s*$/iu);
            return !mediaControl || /\.(?:m3u8|mp4|webm|ogg|mp3|m4a|aac|oga|wav|flac)(?:$|[?#])/i.test(mediaControl[1]);
        })
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
        const linkedHeadline = /\[[^\]]{8,}\]\(https?:\/\/[^)]+\)/i.test(last.replace(/\[!\[[\s\S]{0,500}?\]\]\([\s\S]{0,500}?\)/g, ''));
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
    if (isDeletedArticlePayload(url, text)) {
        const kind = deletedSourceKind(url);
        return {
            title: deletedSourceTitle(url),
            author: '',
            date: '',
            image: '',
            siteName: new URL(url).hostname.replace(/^www\./, ''),
            content: '',
            readerType: `deleted-${kind}`,
            source: 'jina-reader',
            isDeletedSource: true,
            isDeletedThread: kind === 'thread'
        };
    }
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
    let sourceMetadata = {};
    try {
        let sourceHandler = sourceRegistry.getHandler(url);
        if (sourceHandler && sourceHandler.parseJinaReaderText) {
            let handled = sourceHandler.parseJinaReaderText(markdown, { url });
            if (handled) {
                markdown = handled.markdown;
                readerType = handled.readerType || readerType;
                sourceMetadata = handled;
            }
        }
    } catch (e) { }

    const trimmed = trimJinaArticleMarkdown(markdown);
    markdown = trimmed.markdown;

    const allImages = [...markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1]);
    const validImage = allImages.find(img => !isInvalidImage(img) && !img.includes('avplayer.com')) || allImages.find(img => !isInvalidImage(img)) || '';
    let content = normalizeArticleMediaMarkup(cleanArticleMarkup(jinaMarkdownToHtml(markdown, url)), url);
    const sourceHandler = sourceRegistry.getHandler(url);
    if (readerType === 'techmeme-story' && sourceHandler?.cleanCachedArticleContent) {
        content = sourceHandler.cleanCachedArticleContent(content, { url, title, source: 'jina-reader' });
    }
    if (title) {
        const escapedTitle = escapeHtml(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        content = content.replace(new RegExp('^<h[1-3]>' + escapedTitle + '<\\/h[1-3]>', 'i'), '');
    }
    return {
        title,
        author: sourceMetadata.author || trimmed.author,
        date: dateMatch ? dateMatch[1].trim() : trimmed.extractedDate,
        image: sourceMetadata.image || (validImage ? safeHttpUrl(validImage) : ''),
        imageCaption: sourceMetadata.imageCaption || '',
        siteName: new URL(url).hostname.replace(/^www\./, ''),
        content,
        readerType,
        source: 'jina-reader'
    };
}

function parseOpenCliMarkdown(markdown, url, options = {}) {
    if (isDeletedArticlePayload(url, markdown)) {
        const kind = deletedSourceKind(url);
        return {
            title: deletedSourceTitle(url),
            author: '',
            date: '',
            image: '',
            siteName: new URL(url).hostname.replace(/^www\./, ''),
            content: '',
            readerType: `deleted-${kind}`,
            source: 'opencli',
            isDeletedSource: true,
            isDeletedThread: kind === 'thread'
        };
    }
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
    let sourceHandler = null;
    let readerType = 'browser-reader';
    let sourceMetadata = {};
    try {
        sourceHandler = sourceRegistry.getHandler(url);
        if (sourceHandler?.parseOpenCliMarkdown) {
            const handled = sourceHandler.parseOpenCliMarkdown(source, {
                url,
                diagnostics: options.diagnostics || ''
            });
            if (handled?.markdown) source = handled.markdown;
            if (handled?.readerType) readerType = handled.readerType;
            if (handled) sourceMetadata = handled;
        }
    } catch (error) {
        console.warn(`[OPENCLI] Source-specific Markdown cleanup failed for ${url}: ${error.message}`);
    }
    const trimmed = trimJinaArticleMarkdown(source);
    source = trimmed.markdown;
    let content = normalizeArticleMediaMarkup(cleanArticleMarkup(jinaMarkdownToHtml(source, url)), url);
    if (sourceHandler?.cleanCachedArticleContent) {
        content = sourceHandler.cleanCachedArticleContent(content, {
            url,
            source: 'opencli',
            title,
            chartUrls: sourceMetadata.chartUrls || [],
            latestArticles: sourceMetadata.latestArticles || null
        });
    }
    const allImages = [...source.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1]);
    const validImage = allImages.find(img => !isInvalidImage(img) && !img.includes('avplayer.com')) || allImages.find(img => !isInvalidImage(img)) || '';
    return {
        title,
        author: sourceMetadata.author || trimmed.author,
        date: trimmed.extractedDate,
        image: sourceMetadata.image || (validImage ? safeHttpUrl(validImage) : ''),
        imageCaption: sourceMetadata.imageCaption || '',
        siteName: new URL(url).hostname.replace(/^www\./, ''),
        content,
        readerType,
        source: 'opencli',
        ...(sourceMetadata.chartUrls?.length ? { chartUrls: sourceMetadata.chartUrls } : {}),
        ...(sourceMetadata.latestArticles?.items?.length ? { latestArticles: sourceMetadata.latestArticles } : {})
    };
}

export { parseOpenCliMarkdown, parseJinaReaderText, trimJinaArticleMarkdown, stripJinaLeadingNavigation, jinaMarkdownToHtml, renderJinaInline };
