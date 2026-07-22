import {
    SMART_SOURCES as DEFAULT_SMART_SOURCES,
    SMART_SOURCE_DISCOVERY_POOL
} from './smart-sources.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SMART_REFRESH_MS = 30 * 60 * 1000;
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const GEMINI_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const EVENT_MATCH_WINDOW_MS = 12 * 60 * 60 * 1000;
const SMART_CLUSTER_VERSION = 'gemini-category-review-v12-e5';
const SMART_ITEMS_PER_SOURCE = 10;
const EXCLUDED_SMART_FEED_URLS = new Set([
    'https://voz.vn/f/chuyen-tro-linh-tinh-tm.17/index.rss',
    'https://voz.vn/f/phan-mem.13/index.rss'
]);
const VALID_SMART_CATEGORIES = new Set(['news_vietnam', 'news_world', 'finance_vietnam', 'finance_global', 'tech']);

function stripHtml(value = '') {
    return String(value)
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z0-9#]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeText(value = '') {
    return stripHtml(value)
        .toLocaleLowerCase('vi')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const STOP_WORDS = new Set([
    // Existing & Expanded English
    'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'at', 'with', 'from', 'by', 'is', 'are',
    'this', 'that', 'after', 'new', 'says', 'as', 'it', 'its', 'be', 'has', 'have', 'will', 'more', 'about',
    'say', 'said', 'tells', 'told', 'according', 'announces', 'announced', 'report', 'reports', 'reported',
    'official', 'officials', 'market', 'markets', 'stock', 'stocks', 'share', 'shares', 'price', 'prices',
    'investor', 'investors', 'business', 'finance', 'financial', 'global', 'world', 'national', 'local',
    'state', 'country', 'government', 'company', 'companies', 'group', 'industry', 'percent', 'billion',
    'million', 'year', 'years', 'month', 'months', 'week', 'weeks', 'day', 'days', 'today', 'yesterday',
    'latest', 'breaking', 'update', 'updates', 'live', 'video', 'photo', 'watch', 'can', 'could', 'would',
    'should', 'may', 'might', 'must', 'over', 'under', 'into', 'through', 'against', 'what', 'why', 'how',
    'when', 'where', 'who', 'which', 'while', 'because', 'both', 'only', 'just', 'even', 'also', 'than',
    'other', 'another', 'some', 'any', 'all', 'every', 'much', 'many', 'most', 'very', 'already', 'still',

    // Existing & Expanded Vietnamese (NFD normalized without diacritics)
    'va', 'la', 'cua', 'cho', 'voi', 'tai', 'tu', 'trong', 'tren', 'sau', 'truoc', 'nhung', 'mot', 'cac',
    'khi', 'duoc', 'co', 'se', 've', 'theo', 'nay', 'dang', 'den', 'khong', 'nhieu',
    'chuyen', 'gia', 'tinh', 'thanh', 'quoc', 'viet', 'nam', 'gioi', 'cong', 'ty', 'giam', 'doc',
    'chu', 'tich', 'bo', 'truong', 'lanh', 'dao', 'chinh', 'phu', 'dau', 'tu', 'du', 'an', 'phat', 'trien',
    'kinh', 'te', 'thi', 'truong', 'ngan', 'hang', 'doanh', 'nghiep', 'phieu', 'chung', 'khoan', 'vang',
    'lai', 'suat', 'lam', 'xuat', 'khau', 'nhap', 'bat', 'dong', 'san', 'nha', 'dat', 'tieu', 'dung',
    'so', 'thu', 'hoi', 'quan', 'tri', 'ban', 'hanh', 'quyet', 'dinh', 'thong', 'tin', 'tuc', 'bao',
    'cao', 'nguoi', 'dan', 'to', 'can', 'tra', 'dieu', 'xu', 'ly', 'pham', 'giai', 'quyet', 'ho', 'tro',
    'tham', 'chuc', 'hoat', 'kien', 'van', 'de', 'ket', 'qua', 'muc', 'thoi', 'gian', 'khu', 'vuc',
    'pho', 'huyen', 'xa', 'phuong', 'ngay', 'thang', 'nam', 'ngoai', 'duoi', 'giua', 'lon', 'nho', 'moi',
    'cu', 'thap', 'tuy', 'nhien', 'do', 'nen', 'phai', 'hoac', 'cung', 'hai', 'ba', 'bon', 'sau',
    'bay', 'tam', 'chin', 'muoi', 'tram', 'nghin', 'trieu', 'ty', 'dong', 'usd', 'vnd', 'tuan', 'quy',
    'hom', 'qua', 'mai', 'tuyen', 'doi', 'bong', 'thuong', 'champions', 'league', 'cup', 'hien',
    'nghi', 'xuat', 'nghiep', 'dau', 'chi', 'khai', 'cap', 'danh', 'xem', 'xet', 'tiep', 'thuc', 'nang',
    'cai', 'thien', 'dam', 'kenh', 'phat', 'ky', 'tiet', 'hang', 'tuyet', 'doi', 'chua', 'tung'
]);

let batchStopTokens = new Set();
let _embeddingPipeline = null;
const _embeddingCache = new Map();

function cleanTitleForScoring(title) {
    if (!title) return '';
    let t = String(title).trim();
    t = t.replace(/^\[[^\]]+\]\s*|\([^)]+\)\s*/g, '');
    t = t.replace(/\s*[|–-]\s*[^\n|–-]{2,40}$/u, (match) => {
        if (/^[^\w\p{L}]*[\p{L}\d\s.&'"]+$/u.test(match) && match.length < 42) return '';
        return match;
    });
    t = t.replace(/\s*[|–-]\s*[A-Z0-9\s.,&'"]+$/i, '');
    t = t.replace(/\b(?:price prediction(?:\s*:\s*|\s+)\d{4}(?:,\s*\d{4})*(?:[-–]\d{4})?)\b/gi, '');
    t = t.replace(/\b(?:hints? and answers? for\s+[a-z]+\s+\d{1,2})\b/gi, '');
    t = t.replace(/\b(?:dự báo giá|bảng giá|cập nhật giá)\b/gi, '');
    return t.trim() || String(title).trim();
}

export function updateBatchStopTokens(articles) {
    batchStopTokens = new Set();
    if (!articles || articles.length < 50) return;
    const counts = new Map();
    const threshold = Math.max(15, Math.floor(articles.length * 0.025));
    for (const article of articles) {
        const words = new Set(normalizeText(cleanTitleForScoring(article.title)).split(' ').filter(word => word.length > 2 && !STOP_WORDS.has(word)));
        for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
    }
    for (const [w, c] of counts.entries()) {
        if (c > threshold) batchStopTokens.add(w);
    }
}



async function getEmbeddingVector(text) {
    if (!text) return null;
    if (!_embeddingPipeline) {
        try {
            const { pipeline } = await import('@xenova/transformers');
            _embeddingPipeline = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small');
        } catch (e) {
            console.warn('[SMART] Local @xenova/transformers embedding not loaded:', e.message);
            return null;
        }
    }
    try {
        const inputText = text.startsWith('passage: ') ? text : `passage: ${text}`;
        const out = await _embeddingPipeline(inputText, { pooling: 'mean', normalize: true });
        return out.data;
    } catch (e) {
        return null;
    }
}

function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0;
    for (let i = 0; i < vecA.length; i++) dot += vecA[i] * vecB[i];
    return dot;
}

export async function prepareEmbeddings(articles) {
    const uniqueTitles = [...new Set(articles.map(a => a.title).filter(Boolean))];
    for (const title of uniqueTitles) {
        if (!_embeddingCache.has(title)) {
            const vec = await getEmbeddingVector(cleanTitleForScoring(title));
            if (vec) _embeddingCache.set(title, vec);
        }
    }
    for (const article of articles) {
        article._vec = _embeddingCache.get(article.title) || null;
    }
    if (_embeddingCache.size > 5000) {
        const keys = Array.from(_embeddingCache.keys()).slice(0, _embeddingCache.size - 4000);
        keys.forEach(k => _embeddingCache.delete(k));
    }
}

function titleTokens(title) {
    const cleaned = cleanTitleForScoring(title);
    return new Set(normalizeText(cleaned).split(' ').filter(word => word.length > 2 && !STOP_WORDS.has(word) && !batchStopTokens.has(word)));
}

export function tokenSimilarity(a, b) {
    const aTokens = titleTokens(a);
    const bTokens = titleTokens(b);
    if (!aTokens.size || !bTokens.size) return 0;
    let shared = 0;
    for (const token of aTokens) if (bTokens.has(token)) shared++;
    const union = aTokens.size + bTokens.size - shared;
    const jaccard = union ? shared / union : 0;
    const containment = shared / Math.min(aTokens.size, bTokens.size);
    return Math.max(jaccard, containment * 0.82);
}

export function tokenOverlapCount(a, b) {
    const aTokens = titleTokens(a);
    const bTokens = titleTokens(b);
    let shared = 0;
    for (const token of aTokens) if (bTokens.has(token)) shared++;
    return shared;
}

function isVietnameseArticle(article) {
    if (!article) return false;
    if (article.region === 'vietnam' || article.smartCategory?.endsWith('_vietnam')) return true;
    if (article.region === 'foreign' || article.smartCategory?.endsWith('_world') || article.smartCategory?.endsWith('_global')) return false;
    const text = (article.title || '') + ' ' + (article.content || '');
    return /[ăâđêôơưàảãạáằẳẵặắầẩẫậấèẻẽẹéềểễệếìỉĩịíòỏõọóồổỗộốờởỡợớùủũụúừửữựứỳỷỹỵý]/i.test(text) || /\b(của|và|trong|cho|với|tại|theo|người|công|những|được|trên|này|khi)\b/i.test(text);
}

function isEnglishArticle(article) {
    return !isVietnameseArticle(article);
}

function isInvestingComSource(item) {
    if (!item) return false;
    const host = hostFromUrl(item.link || item.feedUrl || item.url || '');
    const text = [host, item.feedTitle, item.sourceName, item.source, item.link, item.feedUrl, item.url]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    return text.includes('investing.com');
}

export function refineArticleCategory(item, initialCategory) {
    if (!item) return initialCategory || 'news_vietnam';
    const host = hostFromUrl(item.link || item.feedUrl || '');
    const isVietnamese = host.endsWith('.vn') || host.includes('voz.vn') || host.includes('baomoi.com') || isVietnameseArticle(item);

    if (isInvestingComSource(item) && initialCategory === 'tech') {
        return isVietnamese ? 'finance_vietnam' : 'finance_global';
    }

    const titleText = normalizeText(item.title || '');
    const summaryText = normalizeText(item.content || item.summary || '');
    const combined = titleText + ' ' + summaryText;

    const strongCrimeLifestyleTerms = ['cong an', 'khoi to', 'bi bat', 'tai nan', 'giet nguoi', 'lua dao', 'chiem đoat', 'moi lam viec', 'xu phat', 'nu sinh', 'khoe anh', 'chang trai', 'đung ngoi khong yen', 'manga', 'anime', 'gay that vong', 'bi phat', 'hiep dam', 'cuop', 'đanh nhau', 'au đa', 'tu tu', 'ly hon', 'ngoai tinh'];
    const matchWord = (term) => new RegExp(`\\b${term}\\b`, 'i').test(combined);
    if (strongCrimeLifestyleTerms.some(matchWord)) {
        if (!matchWord('hack') && !matchWord('malware') && !matchWord('an ninh mang') && !matchWord('cybersecurity')) {
            return isVietnamese ? 'news_vietnam' : 'news_world';
        }
    }

    if (initialCategory === 'tech') {
        const strongTechProductTerms = ['ai', 'artificial intelligence', 'chatgpt', 'openai', 'gemini', 'apple', 'google', 'microsoft', 'meta', 'facebook', 'tiktok', 'samsung', 'iphone', 'android', 'semiconductor', 'ban dan', 'nvidia', 'cybersecurity', 'an ninh mang', 'smartphone', 'dien thoai', 'may tinh', 'laptop', 'phan mem', 'software', 'hardware', 'chip', 'robot', 'khoa hoc', 'science', 'nguyen tu', 'vien thong', '5g', '6g', 'internet'];
        const hasCoreTech = strongTechProductTerms.some(matchWord);

        const strongFinanceTerms = ['chung khoan', 'co phieu', 'tang truong', 'kinh te', 'tai chinh', 'doanh nghiep', 'gia vang', 'lai suat', 'ty gia', 'lam phat', 'ngan hang', 'vi mo', 'xuat khau', 'nhap khau', 'bat đong san', 'nha đat', 'nha pho', 'tieu dung', 'chi so cpi', 'gdp', 'thu nhap', 'chi tieu', 'thi truong', 'vn index', 'co cau hoan đoi', 'danh muc', 'quy đau tu', 'trai phieu', 'chao ban', 'thoi bao tai chinh', 'kinh te so', 'thue', 'san pham'];
        if (strongFinanceTerms.some(matchWord) && !hasCoreTech) {
            return isVietnamese ? 'finance_vietnam' : 'finance_global';
        }
    }
    let result = initialCategory || (isVietnamese ? 'news_vietnam' : 'news_world');
    if (result === 'tech' && isInvestingComSource(item)) {
        result = isVietnamese ? 'finance_vietnam' : 'finance_global';
    }
    return result;
}

function inferCategory(article, forceReinfer = false) {
    if (!forceReinfer && article.smartCategory && VALID_SMART_CATEGORIES.has(article.smartCategory)) {
        const refined = refineArticleCategory(article, article.smartCategory);
        if (refined !== 'tech' || !isInvestingComSource(article)) return refined;
    }
    const host = hostFromUrl(article.link || article.feedUrl || '');
    const isVietnamese = host.endsWith('.vn') || host.includes('voz.vn') || host.includes('baomoi.com') || isVietnameseArticle(article);
    const feedCat = normalizeText(article.feedCategory || '');
    const titleText = normalizeText(article.title || '');

    let category = isVietnamese ? 'news_vietnam' : 'news_world';
    if (isInvestingComSource(article)) {
        category = isVietnamese ? 'finance_vietnam' : 'finance_global';
    } else if (feedCat.includes('tech') || feedCat.includes('phan mem') || feedCat.includes('cong nghe') || feedCat.includes('khoa hoc')) {
        category = 'tech';
    } else if (feedCat.includes('finance') || feedCat.includes('business') || feedCat.includes('kinh te') || feedCat.includes('tai chinh') || feedCat.includes('chung khoan')) {
        category = isVietnamese ? 'finance_vietnam' : 'finance_global';
    } else {
        const financeTerms = ['finance', 'business', 'econom', 'stock', 'market', 'bank', 'chung khoan', 'tai chinh', 'kinh te', 'doanh nghiep', 'gia vang', 'crypto', 'bitcoin', 'lai suat', 'ty gia'];
        const techTerms = ['tech', 'technology', 'science', 'artificial intelligence', 'software', 'hardware', 'smartphone', 'apple', 'google', 'microsoft', 'startup', 'cong nghe', 'khoa hoc', 'tri tue nhan tao', 'chatgpt', 'openai', 'iphone', 'android', 'semiconductor', 'ban dan', 'nvidia', 'cybersecurity', 'an ninh mang'];
        const combinedTitle = feedCat + ' ' + titleText;
        if (financeTerms.some(term => combinedTitle.includes(term))) category = isVietnamese ? 'finance_vietnam' : 'finance_global';
        else if (techTerms.some(term => combinedTitle.includes(term))) category = 'tech';
    }
    return refineArticleCategory(article, category);
}

export function stableId(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function parsePublishedTimestamp(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value < 100000000000 ? value * 1000 : value;
    let raw = String(value || '').replace(/[\u200B-\u200D\u202F\u00A0]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!raw) return NaN;

    if (/^\d{10,13}$/.test(raw)) {
        const numeric = Number(raw);
        return raw.length <= 10 ? numeric * 1000 : numeric;
    }

    raw = raw.replace(/\bSA\b/i, 'AM').replace(/\bCH\b/i, 'PM');
    const makeVietnamTime = (year, month, day, hour = 0, minute = 0, second = 0, meridiem = '') => {
        year = Number(year);
        month = Number(month);
        day = Number(day);
        hour = Number(hour || 0);
        minute = Number(minute || 0);
        second = Number(second || 0);
        if (meridiem) {
            if (hour === 12) hour = 0;
            if (String(meridiem).toUpperCase() === 'PM') hour += 12;
        }
        if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return NaN;
        const timestamp = Date.UTC(year, month - 1, day, hour, minute, second) - VIETNAM_OFFSET_MS;
        const check = new Date(timestamp + VIETNAM_OFFSET_MS);
        if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return NaN;
        return timestamp;
    };

    const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2}|GMT[+-]\d{1,2})$/i.test(raw) || /\s(?:GMT|UTC|UT|ICT|[A-Z]{3,4})$/i.test(raw);
    if (hasExplicitZone) {
        const normalized = raw
            .replace(/\sICT$/i, ' GMT+0700')
            .replace(/GMT\+7$/i, 'GMT+0700');
        return new Date(normalized).getTime();
    }

    const yearFirst = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
    if (yearFirst) return makeVietnamTime(yearFirst[1], yearFirst[2], yearFirst[3], yearFirst[4], yearFirst[5], yearFirst[6], yearFirst[7]);

    const localNumeric = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
    if (localNumeric) {
        const first = Number(localNumeric[1]);
        const second = Number(localNumeric[2]);
        const hasMeridiem = Boolean(localNumeric[7]);
        const monthFirst = second > 12 || (first <= 12 && second <= 12 && hasMeridiem);
        const month = monthFirst ? first : second;
        const day = monthFirst ? second : first;
        return makeVietnamTime(localNumeric[3], month, day, localNumeric[4], localNumeric[5], localNumeric[6], localNumeric[7]);
    }

    return new Date(raw + ' GMT+0700').getTime();
}

function safeDate(value) {
    const time = parsePublishedTimestamp(value);
    return Number.isFinite(time) && time > 0 ? time : Date.now();
}

function toVietnamIso(value) {
    const timestamp = safeDate(value);
    const vietnamWallClock = new Date(timestamp + VIETNAM_OFFSET_MS).toISOString();
    return vietnamWallClock.slice(0, -1) + '+07:00';
}

function hostFromUrl(value) {
    try { return new URL(value).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

function publisherIcon(value) {
    const hostname = hostFromUrl(String(value || '').includes('://') ? value : `https://${value}`);
    if (hostname.includes('tuoitre.vn')) return 'https://statictuoitre.mediacdn.vn/web_images/favicon.ico';
    if (hostname.includes('kenh14.vn')) return 'https://kenh14cdn.com/web_images/kenh14-favicon.ico';
    if (hostname.includes('soha.vn')) return 'https://sohanews.sohacdn.com/icons/soha-32.png';
    if (hostname.includes('genk.vn')) return 'https://genk.mediacdn.vn/web_images/genk32.png';
    if (hostname.includes('vjst.vn')) return 'https://ictv.1cdn.vn/assets/static/images/logo.png';
    if (hostname.includes('vtv.vn')) return 'https://static.mediacdn.vn/vtv.vn/images/favicon.ico';
    if (hostname.includes('doanhnhansaigon.vn')) return 'https://dnsg.1cdn.vn/assets/images/favicon.ico';
    if (hostname.includes('tapchinganhang.gov.vn')) return 'https://tapchinganhang.gov.vn/modules/frontend/themes/tcnh/images/favicon/favicon.ico?v=2.620251216214508';
    if (hostname.includes('vccinews.')) return 'https://vccinews.com/images/logo.png';
    if (hostname.includes('haiquanonline.com.vn')) return 'https://www.google.com/s2/favicons?domain=customs.gov.vn&sz=64';
    if (hostname.includes('pcworld.com')) return 'https://icons.duckduckgo.com/ip3/pcworld.com.ico';
    return hostname ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64` : '';
}

function canonicalSourceUrl(value, omitQuery = false) {
    try {
        const url = new URL(String(value || '').trim());
        if (!['http:', 'https:'].includes(url.protocol)) return '';
        url.hash = '';
        if (omitQuery) url.search = '';
        return url.href.replace(/\/+$/, '');
    } catch (e) {
        return '';
    }
}

function isExcludedSmartUrl(value) {
    return EXCLUDED_SMART_FEED_URLS.has(canonicalSourceUrl(value, true));
}

export function isExcludedFromSmart(article) {
    return isExcludedSmartUrl(article && article.feedUrl);
}

function normalizeSmartSource(source) {
    const url = canonicalSourceUrl(source && source.url);
    if (!url || isExcludedSmartUrl(url)) return null;
    let category = VALID_SMART_CATEGORIES.has(source.category) ? source.category : 'news_world';
    if (category === 'tech' && isInvestingComSource(source)) {
        category = 'finance_global';
    }
    const region = category === 'tech'
        ? (source.region === 'vietnam' ? 'vietnam' : 'foreign')
        : (category.endsWith('_vietnam') ? 'vietnam' : 'foreign');
    const weight = Number(source.weight);
    return {
        title: stripHtml(source.title || hostFromUrl(url) || 'News source').slice(0, 120),
        domain: stripHtml(source.domain || hostFromUrl(url)).slice(0, 160),
        category,
        region,
        url,
        fallbackUrl: canonicalSourceUrl(source.fallbackUrl || ''),
        weight: Number.isFinite(weight) ? Math.max(0.5, Math.min(1.5, weight)) : 1,
        enabled: source.enabled !== false,
        discovered: source.discovered === true
    };
}

function countSmartSources(sources) {
    const counts = { news_vietnam: 0, news_world: 0, finance_vietnam: 0, finance_global: 0, tech: 0 };
    for (const source of sources) if (Object.hasOwn(counts, source.category)) counts[source.category]++;
    return counts;
}

export function normalizeArticle(item, source = {}) {
    const link = item.link || '';
    const sourceTitle = source.title || item.feedTitle || hostFromUrl(link) || 'News source';
    const rawCategory = source.category || inferCategory(item, true);
    const category = refineArticleCategory(item, rawCategory);
    const parsedPublicationTime = parsePublishedTimestamp(item.pubDate);
    const publicationTimeReliable = item.publicationTimeReliable !== false
        && Number.isFinite(parsedPublicationTime)
        && parsedPublicationTime >= Date.UTC(2000, 0, 1)
        && parsedPublicationTime <= Date.now() + 2 * 60 * 60 * 1000;
    const sortablePublicationTime = publicationTimeReliable ? parsedPublicationTime : Date.now() - 3.5 * DAY_MS;
    return {
        title: stripHtml(item.title || 'Untitled'),
        link,
        pubDate: toVietnamIso(sortablePublicationTime),
        rawPubDate: publicationTimeReliable ? undefined : String(item.pubDate || ''),
        publicationTimeReliable,
        content: stripHtml(item.content || '').slice(0, 900),
        image: item.image || item.imageUrl || '',
        feedTitle: sourceTitle,
        feedIcon: publisherIcon(source.domain || link) || item.feedIcon || ('https://icons.duckduckgo.com/ip3/' + hostFromUrl(link) + '.ico'),
        feedUrl: source.url || item.feedUrl || '',
        feedCategory: item.feedCategory || category,
        smartCategory: category,
        region: source.region || (category.endsWith('_vietnam') ? 'vietnam' : (category.endsWith('_world') || category.endsWith('_global') ? 'foreign' : '')),
        domain: source.domain || hostFromUrl(link),
        sourceWeight: source.weight || item.sourceWeight || 1,
        hiddenSmartSource: Boolean(source.hiddenSmartSource)
    };
}

export function deterministicGroups(articles) {
    const groups = [];
    const sorted = [...articles].sort((a, b) => safeDate(b.pubDate) - safeDate(a.pubDate));
    for (const article of sorted) {
        if (article.publicationTimeReliable === false) {
            groups.push({ id: 'g' + groups.length, category: article.smartCategory, earliestDate: article.pubDate, latestDate: article.pubDate, articles: [article] });
            continue;
        }
        let best = null;
        let bestScore = -1;
        for (const group of groups) {
            if (group.category !== article.smartCategory) continue;
            const candidateTime = safeDate(article.pubDate);
            const candidateStart = Math.min(safeDate(group.earliestDate), candidateTime);
            const candidateEnd = Math.max(safeDate(group.latestDate), candidateTime);
            if (candidateEnd - candidateStart > EVENT_MATCH_WINDOW_MS) continue;

            const anchor = group.articles[0];
            const score = tokenSimilarity(article.title, anchor.title);
            const vecSim = (article._vec && anchor._vec) ? cosineSimilarity(article._vec, anchor._vec) : null;

            if (isGenuinelyRelated(article, anchor, false)) {
                // Ensure consistency across existing articles in the group to prevent topic drift
                const matchesAll = group.articles.every(peer => peer === anchor || isGenuinelyRelated(article, peer, false));
                if (matchesAll) {
                    const combinedScore = score + Math.max(0, vecSim || 0);
                    if (combinedScore > bestScore) {
                        bestScore = combinedScore;
                        best = group;
                    }
                }
            }
        }
        if (best) {
            best.articles.push(article);
            if (safeDate(article.pubDate) > safeDate(best.latestDate)) best.latestDate = article.pubDate;
            if (safeDate(article.pubDate) < safeDate(best.earliestDate)) best.earliestDate = article.pubDate;
        } else {
            groups.push({ id: 'g' + groups.length, category: article.smartCategory, earliestDate: article.pubDate, latestDate: article.pubDate, articles: [article] });
        }
    }
    return groups;
}

function isPaywalledSource(article) {
    const link = String(article?.link || article?.url || '').toLowerCase();
    const feed = String(article?.feedTitle || article?.source || '').toLowerCase();
    return /(?:barrons\.com|barron['’s]|wsj\.com|wall street journal|bloomberg\.com|ft\.com|financial times|thetimes\.co\.uk|economist\.com)/i.test(link + ' ' + feed);
}

function chooseRepresentative(articles) {
    return [...articles].sort((a, b) => {
        const aPaywalled = isPaywalledSource(a);
        const bPaywalled = isPaywalledSource(b);
        if (aPaywalled !== bPaywalled) return aPaywalled ? 1 : -1;

        if (a.smartCategory === 'tech') {
            const aEng = isEnglishArticle(a);
            const bEng = isEnglishArticle(b);
            if (aEng !== bEng) return bEng ? 1 : -1;
        }
        const weightDiff = (b.sourceWeight || 1) - (a.sourceWeight || 1);
        if (weightDiff) return weightDiff;
        const reliableTimeDiff = Number(b.publicationTimeReliable !== false) - Number(a.publicationTimeReliable !== false);
        if (reliableTimeDiff) return reliableTimeDiff;
        const contentDiff = Math.min((b.content || '').length, 900) - Math.min((a.content || '').length, 900);
        if (contentDiff) return contentDiff;
        const imageDiff = Number(Boolean(b.image)) - Number(Boolean(a.image));
        if (imageDiff) return imageDiff;
        return safeDate(b.pubDate) - safeDate(a.pubDate);
    })[0];
}

function calculateHotness(articles, importance = 2) {
    if (!articles.some(article => article.publicationTimeReliable !== false)) return 1;
    const now = Date.now();
    const latest = Math.max(...articles.map(article => safeDate(article.pubDate)));
    const ageHours = Math.max(0, (now - latest) / (60 * 60 * 1000));
    const sources = new Set(articles.map(article => article.feedTitle)).size;
    const recentSources = new Set(articles.filter(article => now - safeDate(article.pubDate) < 8 * 60 * 60 * 1000).map(article => article.feedTitle)).size;
    const averageWeight = articles.reduce((sum, article) => sum + (article.sourceWeight || 1), 0) / Math.max(1, articles.length);

    const recencyScore = Math.exp(-ageHours / 24) * 32;
    // Use a higher denominator so singletons (log2(2)/3.5 ≈ 0.29) score
    // noticeably lower than multi-source clusters while preserving the
    // logarithmic shape that rewards broad coverage.
    const coverageScore = Math.min(1, Math.log2(1 + sources) / 3.5) * 32;
    const velocityScore = Math.min(1, recentSources / 4) * 16;
    const authorityScore = Math.min(1, averageWeight / 1.12) * 8;
    const aiScore = Math.max(0, Math.min(1, importance / 5)) * 12;
    return Math.max(1, Math.min(100, Math.round(recencyScore + coverageScore + velocityScore + authorityScore + aiScore)));
}

export function isGenuinelyRelated(article, representative, isAiClustered = false) {
    if (!article || !representative) return false;
    if (article.link === representative.link) return false;

    // Strict category checks: Never mix different single-language categories if both are explicitly set
    if (article.smartCategory && representative.smartCategory) {
        const validSingleLangCategories = new Set(['news_vietnam', 'news_world', 'finance_vietnam', 'finance_global']);
        if (validSingleLangCategories.has(article.smartCategory) && validSingleLangCategories.has(representative.smartCategory)) {
            if (article.smartCategory !== representative.smartCategory) return false;
        }
        if (article.smartCategory !== representative.smartCategory && !isAiClustered) {
            return false;
        }
    }

    // Check language mismatch for non-tech categories
    const aVn = isVietnameseArticle(article);
    const bVn = isVietnameseArticle(representative);
    if (article.smartCategory !== 'tech' && representative.smartCategory !== 'tech' && aVn !== bVn) return false;

    const vecSim = (article._vec && representative._vec) ? cosineSimilarity(article._vec, representative._vec) : null;
    const score = tokenSimilarity(article.title, representative.title);
    const overlap = tokenOverlapCount(article.title, representative.title);

    const sameSource = (article.feedTitle && representative.feedTitle && article.feedTitle === representative.feedTitle) ||
        (article.feedUrl && representative.feedUrl && article.feedUrl === representative.feedUrl) ||
        (article.domain && representative.domain && article.domain === representative.domain);

    if (sameSource) {
        // Two articles from the exact same news source should only be considered related/same-event
        // if they are virtually updates of the exact same story (high similarity + overlap)
        if (vecSim !== null) {
            return vecSim >= 0.92 && overlap >= 4 && score >= 0.35;
        }
        return overlap >= 4 && score >= 0.48;
    }

    if (vecSim !== null) {
        if (isAiClustered) {
            // AI (Gemini) grouped these or candidate attachment to AI cluster. Guard against hallucinations:
            if (vecSim >= 0.93 && (overlap >= 2 || score >= 0.18)) return true;
            if (vecSim >= 0.88 && overlap >= 2 && score >= 0.22) return true;
            if (vecSim >= 0.84 && overlap >= 3 && score >= 0.28) return true;
            if (vecSim >= 0.80 && overlap >= 4 && score >= 0.35) return true;
            return false;
        } else {
            // Pure local CPU deterministic clustering. Enforce strict, high-precision event matching:
            if (vecSim >= 0.93 && (overlap >= 2 || score >= 0.20)) return true;
            if (vecSim >= 0.89 && overlap >= 3 && score >= 0.26) return true;
            if (vecSim >= 0.85 && overlap >= 4 && score >= 0.34) return true;
            if (vecSim >= 0.80 && overlap >= 5 && score >= 0.42) return true;
            return false;
        }
    }

    // Fallback when embeddings are not available: rely purely on token Jaccard and overlap
    if (isAiClustered) {
        if (overlap >= 4 && score >= 0.32) return true;
        if (overlap >= 3 && score >= 0.30) return true;
        if (overlap >= 2 && score >= 0.44) return true;
        return false;
    } else {
        if (overlap >= 4 && score >= 0.34) return true;
        if (overlap >= 3 && score >= 0.34) return true;
        if (overlap >= 2 && score >= 0.46) return true;
        return false;
    }
}

export function buildCluster(articles, aiData = null) {
    const rawUnique = [];
    const links = new Set();
    for (const article of articles) {
        if (!article.link || links.has(article.link)) continue;
        links.add(article.link);
        rawUnique.push(article);
    }
    rawUnique.sort((a, b) => safeDate(b.pubDate) - safeDate(a.pubDate));
    const representative = chooseRepresentative(rawUnique);
    let unique = [representative, ...rawUnique.filter(article => article.link !== representative.link && isGenuinelyRelated(article, representative, Boolean(aiData && rawUnique.length > 1)))];
    const validCategories = ['news_vietnam', 'news_world', 'finance_vietnam', 'finance_global', 'tech'];
    let category = aiData && validCategories.includes(aiData.category) ? aiData.category : representative.smartCategory;

    if (category === 'tech') {
        if (isInvestingComSource(representative)) {
            category = isVietnameseArticle(representative) ? 'finance_vietnam' : 'finance_global';
        } else {
            unique = unique.filter(article => article.link === representative.link || !isInvestingComSource(article));
        }
    }

    const sources = [...new Set(unique.map(article => article.feedTitle).filter(Boolean))];
    const importance = aiData && Number.isFinite(Number(aiData.importance)) ? Number(aiData.importance) : (unique.length > 1 ? 2 : 1);
    const title = aiData && aiData.title && unique.length > 1 ? stripHtml(aiData.title) : representative.title;
    const summary = aiData && aiData.summary && unique.length > 1 ? stripHtml(aiData.summary) : representative.content;
    const id = stableId(unique.map(article => article.link).sort().join('|'));

    return {
        ...representative,
        title,
        content: summary || representative.content,
        smartCategory: category,
        feedCategory: category,
        isCluster: true,
        clusterId: id,
        clusterCount: unique.length,
        sourceCount: sources.length,
        sources,
        hotness: calculateHotness(unique, importance),
        aiClustered: Boolean(aiData && unique.length > 1),
        aiProposedArticleCount: aiData && Number(aiData.proposedArticleCount) || undefined,
        aiRemovedOutlierCount: (aiData && Number(aiData.removedOutlierCount) || 0) + (rawUnique.length - unique.length),
        aiLocallyAttachedArticleCount: aiData && Number(aiData.locallyAttachedArticleCount) || 0,
        // Exclude the representative so the overlay "Related coverage"
        // section never duplicates the article the user is already reading.
        relatedArticles: [...unique].filter(article => article.link !== representative.link).sort((a, b) => {
            if (representative.smartCategory === 'tech' && isEnglishArticle(representative)) {
                const aVn = isVietnameseArticle(a);
                const bVn = isVietnameseArticle(b);
                if (aVn !== bVn) return bVn ? 1 : -1;
            }
            return (b.sourceWeight || 1) - (a.sourceWeight || 1) || safeDate(b.pubDate) - safeDate(a.pubDate);
        }).map(article => ({
            title: article.title,
            link: article.link,
            pubDate: article.pubDate,
            publicationTimeReliable: article.publicationTimeReliable,
            feedTitle: article.feedTitle,
            feedIcon: article.feedIcon,
            image: article.image,
            sourceWeight: article.sourceWeight,
            region: article.region
        }))
    };
}

function compactGroup(group) {
    return {
        id: group.id,
        category: group.category,
        articles: group.articles.slice(0, 4).map(article => ({
            title: article.title,
            link: article.link,
            source: article.feedTitle,
            published: article.pubDate,
            summary: article.content.slice(0, 220)
        }))
    };
}

async function requestGeminiMerges(groups, apiKey, model) {
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
    const prompt = [
        'You are an event-clustering system for a multilingual news feed.',
        '',
        'Your task is to identify articles that report the same specific real-world event and merge them into one cluster.',
        'Each input item represents exactly one article. No previous clustering decisions have been made. You must evaluate all items yourself.',
        '',
        'SAME-EVENT REQUIREMENT',
        '',
        'Merge articles only when they describe the same core occurrence, involving substantially the same:',
        '- action or development;',
        '- principal people, organizations, or entities;',
        '- object or subject of the action;',
        '- place, when relevant;',
        '- event time or event stage.',
        '',
        'The wording, language, headline angle, and amount of detail may differ.',
        'For news (news_vietnam, news_world) and finance (finance_vietnam, finance_global), categories are single-language; do not merge across Vietnamese and foreign categories.',
        'For tech (tech), both English and Vietnamese articles share the category and should be merged if they report the exact same event or announcement.',
        'Articles may still belong to the same event when one provides additional confirmed details, reactions, or consequences directly tied to that occurrence, provided it does not primarily report a new occurrence.',
        '',
        'KEEP SEPARATE',
        '',
        'Do not merge articles merely because they concern the same broad topic, person, company, country, conflict, market, product, tournament, or ongoing story.',
        'Keep separate:',
        '- two articles mentioning the same person, company, or location unless they report the exact same specific action or incident;',
        '- different crime cases, investigations, arrests, or trials involving different defendants or charges (e.g. never merge two distinct fraud or corruption cases just because both involve "khởi tố" or "bắt tạm giam");',
        '- different infrastructure, real estate, or urban planning proposals (e.g. never merge two distinct ministry proposals or housing laws just because both mention "Bộ Xây dựng" or "Chung cư");',
        '- different matches, results, ceremonies, ticket announcements, or team developments within the same tournament;',
        '- different attacks, negotiations, sanctions, military operations, or diplomatic actions within the same conflict;',
        '- different company announcements, product launches, earnings reports, lawsuits, or management decisions;',
        '- general analysis, opinion, explainers, reviews, predictions, retrospectives, and unrelated follow-up events;',
        '- recurring statistical releases or market movements from different dates;',
        '- different stages of a developing story when each stage constitutes a distinct real-world occurrence.',
        '',
        'Never create broad-topic or rolling-news clusters. If a cluster would require a generic title such as "World Cup updates", "technology news", "market developments", or "US-Iran tensions", do not create it.',
        '',
        'HARD CONSTRAINTS',
        '',
        '- Never merge articles assigned to different categories.',
        '- All publication timestamps have been normalized to Vietnam time (UTC+7).',
        '- A cluster is valid only when the difference between its earliest and latest publication timestamp is 12 hours or less.',
        '- Return only clusters containing at least two groupIds.',
        '- Do not invent facts not present in the supplied articles.',
        '',
        'For each valid cluster return: all matching groupIds, one factual title, a concise one-sentence summary, the shared category, and importance (1-5).',
        '',
        'Importance scale:',
        '1 = Minor or narrowly relevant development',
        '2 = Notable development with limited wider impact',
        '3 = Significant news relevant to a broad audience',
        '4 = Major national or international development',
        '5 = Exceptional breaking news with widespread immediate consequences',
        '',
        JSON.stringify(groups.map(compactGroup))
    ].join('\n');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 65536,
                    responseMimeType: 'application/json',
                    responseJsonSchema: {
                        type: 'object',
                        properties: {
                            merges: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        groupIds: { type: 'array', items: { type: 'string' } },
                                        title: { type: 'string' },
                                        summary: { type: 'string' },
                                        category: { type: 'string', enum: ['news_vietnam', 'news_world', 'finance_vietnam', 'finance_global', 'tech'] },
                                        importance: { type: 'integer', minimum: 1, maximum: 5 }
                                    },
                                    required: ['groupIds', 'title', 'summary', 'category', 'importance'],
                                    additionalProperties: false
                                }
                            }
                        },
                        required: ['merges'],
                        additionalProperties: false
                    }
                }
            })
        });
        if (!response.ok) {
            const details = (await response.text()).slice(0, 500);
            throw new Error('Gemini HTTP ' + response.status + ': ' + details);
        }
        const responseBody = await response.text();
        let payload;
        try {
            payload = JSON.parse(responseBody);
        } catch (error) {
            throw new Error('Gemini returned an incomplete API response (' + responseBody.length + ' characters)');
        }
        const text = payload.candidates && payload.candidates[0] && payload.candidates[0].content && payload.candidates[0].content.parts
            ? payload.candidates[0].content.parts.map(part => part.text || '').join('')
            : '';
        const finishReason = payload.candidates && payload.candidates[0] && payload.candidates[0].finishReason;
        let parsed;
        try {
            parsed = JSON.parse(text || '{}');
        } catch (error) {
            throw new Error('Gemini returned incomplete structured JSON' + (finishReason ? ' (' + finishReason + ')' : '') + ' after ' + text.length + ' characters');
        }
        return Array.isArray(parsed.merges) ? parsed.merges : [];
    } finally {
        clearTimeout(timeout);
    }
}

async function requestGeminiMergesWithRetry(groups, apiKey, model, categoryName = 'unknown') {
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            return await requestGeminiMerges(groups, apiKey, model);
        } catch (error) {
            console.warn(`[SMART] Gemini request attempt ${attempt} failed for ${categoryName} (${groups.length} items): ${error.message}`);
            if (attempt === 2) throw error;
            await new Promise(resolve => setTimeout(resolve, 3500));
        }
    }
}

function largestTimeConsistentGroup(groups) {
    let best = [];
    let bestArticleCount = 0;
    const starts = groups.map(group => Math.min(...group.articles.map(article => safeDate(article.pubDate))));
    for (const start of starts) {
        const end = start + EVENT_MATCH_WINDOW_MS;
        const inliers = groups.filter(group => {
            const times = group.articles.map(article => safeDate(article.pubDate));
            return Math.min(...times) >= start && Math.max(...times) <= end;
        });
        const articleCount = inliers.reduce((sum, group) => sum + group.articles.length, 0);
        if (inliers.length > best.length || (inliers.length === best.length && articleCount > bestArticleCount)) {
            best = inliers;
            bestArticleCount = articleCount;
        }
    }
    return best;
}

function removeSemanticOutliers(groups, merge) {
    if (groups.length < 2) return groups;
    const anchor = groups.reduce((a, b) => (b.articles.length > a.articles.length || (b.articles.length === a.articles.length && (b.articles[0]?.sourceWeight || 1) > (a.articles[0]?.sourceWeight || 1))) ? b : a);
    const anchorArticle = anchor.articles[0];
    const reference = [merge.title, merge.summary].filter(Boolean).join(' ');

    return groups.filter((group) => {
        if (group === anchor) return true;
        const candidateArticle = group.articles[0];
        if (!candidateArticle) return false;

        // Check against anchor article using strict AI-clustered criteria
        if (isGenuinelyRelated(candidateArticle, anchorArticle, true)) {
            return true;
        }

        // Check against Gemini's explicit event title/summary
        const refScore = tokenSimilarity(candidateArticle.title, reference);
        const refShared = tokenOverlapCount(candidateArticle.title, reference);
        const vecSim = (candidateArticle._vec && anchorArticle?._vec) ? cosineSimilarity(candidateArticle._vec, anchorArticle._vec) : null;

        if (vecSim !== null) {
            return vecSim >= 0.88 && refShared >= 3 && refScore >= 0.25;
        }
        return refShared >= 4 && refScore >= 0.38;
    });
}

function isGenericClusterLabel(merge) {
    const label = normalizeText([merge.title, merge.summary].filter(Boolean).join(' '));
    return /\b(?:related events?|news updates?|latest updates?|roundup|overview|various stories|multiple events|general developments|aftermath and related|ongoing developments)\b/i.test(label) ||
        /\b(?:cap nhat (?:thong tin|tin tuc)|tong hop (?:tin|thong tin)|cac tin (?:lien quan|ve)|dien bien va cac hoat dong)\b/i.test(label);
}

function groupEventText(group) {
    return group.articles
        .map(article => [article.title, article.content].filter(Boolean).join(' '))
        .join(' ');
}

function highConfidenceAttachment(group, acceptedCluster) {
    const candidateArticle = group.articles[0];
    if (!candidateArticle) return { matches: false, score: 0, shared: 0 };

    const referenceText = [acceptedCluster.merge.title, acceptedCluster.merge.summary].filter(Boolean).join(' ');
    const referenceScore = tokenSimilarity(candidateArticle.title, referenceText);
    const referenceShared = tokenOverlapCount(candidateArticle.title, referenceText);
    let bestScore = 0;
    let bestShared = 0;
    let bestVecSim = 0;
    for (const peer of acceptedCluster.groups) {
        const peerArticle = peer.articles[0];
        if (!peerArticle) continue;
        const score = tokenSimilarity(candidateArticle.title, peerArticle.title);
        const shared = tokenOverlapCount(candidateArticle.title, peerArticle.title);
        const vecSim = (candidateArticle._vec && peerArticle._vec) ? cosineSimilarity(candidateArticle._vec, peerArticle._vec) : 0;
        if (score > bestScore || (score === bestScore && shared > bestShared)) {
            bestScore = score;
            bestShared = shared;
        }
        if (vecSim > bestVecSim) bestVecSim = vecSim;
    }

    const peerMatches = bestVecSim >= 0.88 && bestShared >= 3 && bestScore >= 0.25;
    const referenceMatches = referenceShared >= 4 && referenceScore >= 0.34 && bestVecSim >= 0.86;
    return {
        matches: (peerMatches || referenceMatches) && isGenuinelyRelated(candidateArticle, acceptedCluster.groups[0]?.articles[0], true),
        score: Math.min(referenceScore, bestScore),
        shared: Math.min(referenceShared, bestShared)
    };
}

export function cleanStoredCluster(cluster) {
    if (!cluster || typeof cluster !== 'object') return cluster;
    if (!Array.isArray(cluster.relatedArticles) || cluster.relatedArticles.length === 0) return cluster;
    const isAi = Boolean(cluster.aiClustered);
    const cleanRelated = cluster.relatedArticles.filter(related => {
        if (!related || !related.link || related.link === cluster.link) return false;
        return isGenuinelyRelated(related, cluster, isAi);
    });
    if (cleanRelated.length === cluster.relatedArticles.length) return cluster;
    const sources = [...new Set([cluster.feedTitle, ...cleanRelated.map(r => r.feedTitle)].filter(Boolean))];
    return {
        ...cluster,
        relatedArticles: cleanRelated,
        clusterCount: cleanRelated.length + 1,
        sourceCount: sources.length,
        sources
    };
}

function collectGeminiRetryCandidates(groups, limit = 500) {
    const retryIds = new Set();
    const categories = new Map();
    for (const group of groups) {
        if (!categories.has(group.category)) categories.set(group.category, []);
        categories.get(group.category).push(group);
    }

    for (const categoryGroups of categories.values()) {
        const groupById = new Map(categoryGroups.map(group => [group.id, group]));
        const tokenIndex = new Map();
        for (const group of categoryGroups) {
            const title = group.articles.map(article => article.title).join(' ');
            for (const token of titleTokens(title)) {
                if (!tokenIndex.has(token)) tokenIndex.set(token, []);
                tokenIndex.get(token).push(group.id);
            }
        }

        const sharedCounts = new Map();
        for (const ids of tokenIndex.values()) {
            // Very common words are not event identifiers and create noisy,
            // quadratic candidate sets. Gemini still saw these in pass one.
            if (ids.length > 120) continue;
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const key = ids[i] < ids[j] ? ids[i] + '|' + ids[j] : ids[j] + '|' + ids[i];
                    sharedCounts.set(key, (sharedCounts.get(key) || 0) + 1);
                }
            }
        }

        for (const [key, shared] of sharedCounts) {
            // Lower from 3 to 2 so more borderline pairs reach the
            // Gemini retry pass instead of staying as singletons.
            if (shared < 2) continue;
            const [leftId, rightId] = key.split('|');
            const left = groupById.get(leftId);
            const right = groupById.get(rightId);
            if (!left || !right) continue;
            if (Math.abs(safeDate(left.latestDate) - safeDate(right.latestDate)) > EVENT_MATCH_WINDOW_MS) continue;
            const leftTitle = left.articles.map(article => article.title).join(' ');
            const rightTitle = right.articles.map(article => article.title).join(' ');
            const score = tokenSimilarity(leftTitle, rightTitle);
            if (!((shared >= 3 && score >= 0.4) || (shared >= 5 && score >= 0.32))) continue;
            retryIds.add(leftId);
            retryIds.add(rightId);
        }
    }

    return groups
        .filter(group => retryIds.has(group.id))
        .sort((a, b) => safeDate(b.latestDate) - safeDate(a.latestDate))
        .slice(0, limit);
}

async function applyGeminiMerges(groups, apiKey, model, priorityLinks = []) {
    const recentCutoff = Date.now() - GEMINI_RECENT_WINDOW_MS;
    const categories = ['news_vietnam', 'news_world', 'finance_vietnam', 'finance_global', 'tech'];
    const priority = new Set(priorityLinks);
    const selected = categories.flatMap(category => {
        const eligibleGroups = [...groups]
            .filter(group => group.category === category && safeDate(group.latestDate) >= recentCutoff)
            .map(group => ({
                ...group,
                articles: group.articles.filter(article => article.publicationTimeReliable !== false && safeDate(article.pubDate) >= recentCutoff)
            }))
            .filter(group => group.articles.length > 0)
            .sort((a, b) => {
                const priorityDiff = Number(b.articles.some(article => priority.has(article.link))) - Number(a.articles.some(article => priority.has(article.link)));
                if (priorityDiff) return priorityDiff;
                const duplicateDiff = Math.min(4, b.articles.length) - Math.min(4, a.articles.length);
                return duplicateDiff || safeDate(b.latestDate) - safeDate(a.latestDate);
            });

        const seenLinks = new Set();
        const articles = [];
        for (const group of eligibleGroups) {
            const groupArticles = [...group.articles].sort((a, b) => {
                const priorityDiff = Number(priority.has(b.link)) - Number(priority.has(a.link));
                return priorityDiff || (b.sourceWeight || 1) - (a.sourceWeight || 1) || safeDate(b.pubDate) - safeDate(a.pubDate);
            });
            for (const article of groupArticles) {
                if (!article.link || seenLinks.has(article.link)) continue;
                seenLinks.add(article.link);
                articles.push(article);
            }
        }

        // Gemini sees every reviewed story as an independent item. The local
        // similarity pass only prioritizes likely neighborhoods for the token
        // budget; it never pre-merges anything Gemini must accept.
        return articles.map(article => ({
            id: 'a' + stableId(article.link),
            category: article.smartCategory,
            earliestDate: article.pubDate,
            latestDate: article.pubDate,
            articles: [article]
        }));
    });
    const selectedIds = new Set(selected.map(group => group.id));
    const selectedById = new Map(selected.map(group => [group.id, group]));
    const selectedLinks = new Set(selected.flatMap(group => group.articles.map(article => article.link)));
    const merges = [];
    const geminiByCategoryStats = {
        news_vietnam: { ok: false, reviewed: 0, error: 'No eligible articles' },
        news_world: { ok: false, reviewed: 0, error: 'No eligible articles' },
        finance_vietnam: { ok: false, reviewed: 0, error: 'No eligible articles' },
        finance_global: { ok: false, reviewed: 0, error: 'No eligible articles' },
        tech: { ok: false, reviewed: 0, error: 'No eligible articles' }
    };
    let previousRequestStartedAt = 0;

    for (const category of categories) {
        const categoryGroups = selected.filter(group => group.category === category);
        if (categoryGroups.length < 2) continue;
        
        try {
            const chunks = [];
            const chunkSize = 130; // Point #2: cap/shard largest categories like tech (~330 items)
            for (let i = 0; i < categoryGroups.length; i += chunkSize) {
                chunks.push(categoryGroups.slice(i, i + chunkSize));
            }

            const categoryMerges = [];
            for (let c = 0; c < chunks.length; c++) {
                const chunkGroups = chunks[c];
                const waitMs = Math.max(0, 4200 - (Date.now() - previousRequestStartedAt));
                if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
                previousRequestStartedAt = Date.now();
                const chunkMerges = await requestGeminiMergesWithRetry(chunkGroups, apiKey, model, `${category}[batch ${c+1}/${chunks.length}]`);
                categoryMerges.push(...chunkMerges);
            }

            merges.push(...categoryMerges.map(merge => ({ ...merge, _requestedCategory: category })));
            geminiByCategoryStats[category] = { ok: true, reviewed: categoryGroups.length, error: null };
        } catch (error) {
            // Point #1: isolate Gemini failures per category so one timeout doesn't discard all others
            console.error(`[SMART] Gemini merges aborted/failed for category ${category}: ${error.message}. Falling back to CPU local embedding clustering for ${category}.`);
            geminiByCategoryStats[category] = { ok: false, reviewed: 0, error: error.message };
        }
    }
    const used = new Set();
    const acceptedClusters = [];

    for (const merge of merges) {
        const proposedIds = [...new Set((merge.groupIds || []).filter(id => selectedIds.has(id) && !used.has(id)))];
        if (proposedIds.length < 2) continue;
        const proposed = proposedIds.map(id => selectedById.get(id)).filter(Boolean);
        const sameCategory = proposed.filter(group => group.category === merge._requestedCategory);
        const timeMatched = largestTimeConsistentGroup(sameCategory);
        const matched = removeSemanticOutliers(timeMatched, merge);
        if (matched.length < 2 || isGenericClusterLabel(merge)) continue;
        const ids = matched.map(group => group.id);
        ids.forEach(id => used.add(id));
        acceptedClusters.push({
            groups: matched,
            merge: {
                ...merge,
                category: merge._requestedCategory,
                proposedArticleCount: proposed.length,
                removedOutlierCount: proposed.length - matched.length,
                locallyAttachedArticleCount: 0
            }
        });
    }

    // A large first-pass list can occasionally make Gemini omit an obvious
    // event without explicitly rejecting it. Re-submit only the strongly
    // overlapping unmerged neighborhoods for one small Gemini verification
    // call. The local pass proposes candidates; it never approves the merge.
    const retryCandidates = collectGeminiRetryCandidates(selected.filter(group => !used.has(group.id)));
    if (retryCandidates.length >= 2) {
        try {
            const waitMs = Math.max(0, 4200 - (Date.now() - previousRequestStartedAt));
            if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
            previousRequestStartedAt = Date.now();
            const retryMerges = await requestGeminiMergesWithRetry(retryCandidates, apiKey, model, 'retry-candidates');
            const retryIds = new Set(retryCandidates.map(group => group.id));
            for (const merge of retryMerges) {
                const proposedIds = [...new Set((merge.groupIds || []).filter(id => retryIds.has(id) && !used.has(id)))];
                if (proposedIds.length < 2) continue;
                const proposed = proposedIds.map(id => selectedById.get(id)).filter(Boolean);
                const proposedCategories = [...new Set(proposed.map(group => group.category))];
                if (proposedCategories.length !== 1) continue;
                const category = proposedCategories[0];
                const timeMatched = largestTimeConsistentGroup(proposed);
                const matched = removeSemanticOutliers(timeMatched, merge);
                if (matched.length < 2 || isGenericClusterLabel(merge)) continue;
                matched.forEach(group => used.add(group.id));
                acceptedClusters.push({
                    groups: matched,
                    merge: {
                        ...merge,
                        category,
                        proposedArticleCount: proposed.length,
                        removedOutlierCount: proposed.length - matched.length,
                        locallyAttachedArticleCount: 0,
                        geminiRetryVerified: true
                    }
                });
            }
        } catch (error) {
            console.warn('[SMART] Gemini retry candidates step failed:', error.message);
        }
    }

    // Gemini remains authoritative for creating an event. This reconciliation
    // step can only attach a missed singleton to an already accepted Gemini
    // cluster when the category, 12-hour window, and wording all agree strongly.
    for (const group of selected) {
        if (used.has(group.id)) continue;
        const candidates = acceptedClusters
            .filter(cluster => cluster.merge.category === group.category)
            .filter(cluster => largestTimeConsistentGroup([...cluster.groups, group]).length === cluster.groups.length + 1)
            .map(cluster => ({ cluster, ...highConfidenceAttachment(group, cluster) }))
            .filter(candidate => candidate.matches)
            .sort((a, b) => b.score - a.score || b.shared - a.shared);
        if (!candidates.length) continue;
        // A wider gap prevents ambiguous matches where two clusters
        // score almost equally, which usually indicates a broad topic.
        if (candidates[1] && candidates[0].score - candidates[1].score < 0.10) continue;
        candidates[0].cluster.groups.push(group);
        candidates[0].cluster.merge.locallyAttachedArticleCount++;
        used.add(group.id);
    }

    const output = acceptedClusters.map(cluster => buildCluster(
        cluster.groups.flatMap(group => group.articles),
        cluster.merge
    ));

    const unmergedSelectedArticles = selected
        .filter(group => !used.has(group.id))
        .flatMap(group => group.articles);
    const remainingArticles = groups
        .flatMap(group => group.articles)
        .filter(article => !selectedLinks.has(article.link));
    const allFallbackArticles = [...unmergedSelectedArticles, ...remainingArticles];
    for (const group of deterministicGroups(allFallbackArticles)) output.push(buildCluster(group.articles));
    return { clusters: output, reviewedArticleCount: selected.length, geminiByCategory: geminiByCategoryStats };
}

async function fetchRssUrl(url, fastParseRSS, headers) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);
    try {
        const response = await fetch(url, {
            headers: {
                ...headers,
                Accept: 'application/rss+xml, application/xml, text/xml, */*'
            },
            redirect: 'follow',
            signal: controller.signal
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const xml = await response.text();
        if (!/<(?:item|entry)\b/i.test(xml)) throw new Error('Response is not a usable RSS/Atom feed');
        const parsed = fastParseRSS(xml);
        const items = (parsed.items || []).filter(item => item.link && item.title).slice(0, SMART_ITEMS_PER_SOURCE);
        if (!items.length) throw new Error('No articles found');
        return items;
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchSmartSource(source, fastParseRSS, headers) {
    const urls = [...new Set([source.url, source.fallbackUrl].filter(Boolean))];
    const errors = [];
    for (const url of urls) {
        try {
            const items = await fetchRssUrl(url, fastParseRSS, headers);
            const articles = items.map(item => normalizeArticle(item, {
                ...source,
                url,
                hiddenSmartSource: true
            }));
            return { source, articles, ok: true, fallbackUsed: url !== source.url };
        } catch (error) {
            errors.push((url === source.url ? 'primary' : 'fallback') + ': ' + error.message);
        }
    }
    return { source, articles: [], ok: false, error: errors.join(' | ') || 'No feed URL configured' };
}

async function fetchInBatches(sources, size, worker, onProgress = null) {
    const results = [];
    for (let index = 0; index < sources.length; index += size) {
        const batch = sources.slice(index, index + size);
        results.push(...await Promise.all(batch.map(worker)));
        if (onProgress) onProgress({
            stage: 'smart-sources',
            message: `Refreshing Smart sources… ${Math.min(index + batch.length, sources.length)}/${sources.length}`,
            current: Math.min(index + batch.length, sources.length),
            total: sources.length
        });
    }
    return results;
}

export function createSmartNewsEngine({ db, helpers, headers = {} }) {
    const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
    const apiKey = process.env.GEMINI_API_KEY || '';
    let running = false;
    let timer = null;

    async function getSourceSettings() {
        const stored = await db.get('smartSources', { type: 'json' });
        const input = Array.isArray(stored) && stored.length ? stored : DEFAULT_SMART_SOURCES;
        const seen = new Set();
        const identities = new Set();
        const sources = [];
        const identityFor = source => [source.category, source.region, source.domain || hostFromUrl(source.url)].join('|').toLowerCase();
        for (const rawSource of input) {
            const source = normalizeSmartSource(rawSource);
            const key = source && canonicalSourceUrl(source.url);
            if (!source || !key || seen.has(key)) continue;
            seen.add(key);
            identities.add(identityFor(source));
            sources.push(source);
        }
        // Merge newly shipped defaults once without overwriting an existing
        // enabled/disabled preference for the same publisher and Smart section.
        let defaultsAdded = 0;
        if (Array.isArray(stored) && stored.length) {
            for (const rawDefault of DEFAULT_SMART_SOURCES) {
                const source = normalizeSmartSource(rawDefault);
                const key = source && canonicalSourceUrl(source.url);
                const identity = source && identityFor(source);
                if (!source || !key || seen.has(key) || identities.has(identity)) continue;
                seen.add(key);
                identities.add(identity);
                sources.push(source);
                defaultsAdded++;
            }
        }
        if (defaultsAdded) await db.put('smartSources', JSON.stringify(sources));
        if (sources.length) return sources;
        return DEFAULT_SMART_SOURCES.map(normalizeSmartSource).filter(Boolean);
    }

    async function getSources() {
        return (await getSourceSettings()).filter(source => source.enabled !== false);
    }

    async function addSource(input) {
        const source = normalizeSmartSource({ ...(input || {}), enabled: true });
        if (!source) throw new Error('Enter a valid RSS/Atom URL. This source may also be excluded from Smart.');
        const sources = await getSourceSettings();
        const key = canonicalSourceUrl(source.url);
        const existingIndex = sources.findIndex(existing => canonicalSourceUrl(existing.url) === key);
        const updated = [...sources];
        if (existingIndex >= 0) updated[existingIndex] = { ...updated[existingIndex], ...source, enabled: true };
        else updated.push(source);
        await db.put('smartSources', JSON.stringify(updated));
        return updated;
    }

    async function setSourceEnabled(url, enabled) {
        const key = canonicalSourceUrl(url);
        if (!key) throw new Error('Invalid Smart source URL.');
        const sources = await getSourceSettings();
        const index = sources.findIndex(source => canonicalSourceUrl(source.url) === key);
        if (index < 0) throw new Error('Smart source not found.');
        const updated = sources.map((source, sourceIndex) => sourceIndex === index ? { ...source, enabled: Boolean(enabled) } : source);
        if (!updated.some(source => source.enabled !== false)) throw new Error('Smart must keep at least one enabled source.');
        await db.put('smartSources', JSON.stringify(updated));
        return updated;
    }

    async function removeSource(url) {
        return setSourceEnabled(url, false);
    }

    async function discoverSources(input = {}) {
        const category = VALID_SMART_CATEGORIES.has(input.category) ? input.category : '';
        const region = category === 'tech' ? (input.region === 'vietnam' ? 'vietnam' : 'foreign') : (category.endsWith('_vietnam') ? 'vietnam' : 'foreign');
        if (!category) throw new Error('Choose a Smart section before searching.');
        const sources = await getSourceSettings();
        const existing = new Set(sources.map(source => canonicalSourceUrl(source.url)));
        const candidates = SMART_SOURCE_DISCOVERY_POOL
            .map(source => normalizeSmartSource({ ...source, enabled: false, discovered: true }))
            .filter(source => source && source.category === category && source.region === region && !existing.has(canonicalSourceUrl(source.url)))
            .sort((a, b) => b.weight - a.weight || a.title.localeCompare(b.title))
            .slice(0, 5);
        if (!candidates.length) return { sources, candidates: [] };
        const updated = [...sources, ...candidates];
        // Remember every result immediately as disabled. A candidate the user
        // skips will not reappear, but can be reconsidered from Disabled.
        await db.put('smartSources', JSON.stringify(updated));
        return { sources: updated, candidates };
    }

    async function resetSources() {
        const sources = DEFAULT_SMART_SOURCES.map(source => normalizeSmartSource({ ...source, enabled: true })).filter(Boolean);
        await db.put('smartSources', JSON.stringify(sources));
        return sources;
    }

    async function getStatus() {
        const stored = await db.get('smartStatus', { type: 'json' }) || {};
        const sources = await getSources();
        return {
            ...stored,
            running,
            refreshMinutes: SMART_REFRESH_MS / 60000,
            configuredSourceCount: sources.length,
            sourceCounts: countSmartSources(sources),
            geminiConfigured: Boolean(apiKey),
            model
        };
    }

    async function setStatus(value) {
        await db.put('smartStatus', JSON.stringify(value));
    }

    async function sync(onProgress = null, targetCategory = null) {
        if (running) return { ok: true, skipped: true, reason: 'Smart refresh already running' };
        const smartSources = await getSources();
        const smartSourceCounts = countSmartSources(smartSources);
        const notify = (stage, message, extra = {}) => {
            if (typeof onProgress === 'function') onProgress({ stage, message, ...extra });
        };
        running = true;
        const startedAt = toVietnamIso(Date.now());
        const isTargeted = targetCategory && VALID_SMART_CATEGORIES.has(targetCategory);
        notify('smart-starting', isTargeted ? `Loading Smart sources for ${targetCategory}…` : 'Loading Smart source configuration…');
        const previousStatus = await db.get('smartStatus', { type: 'json' }) || {};
        await setStatus({
            ...previousStatus,
            state: 'refreshing',
            startedAt,
            geminiConfigured: Boolean(apiKey),
            model
        });

        try {
            let sourcesToFetch = isTargeted ? smartSources.filter(s => s.category === targetCategory || inferCategory({ feedCategory: s.category, title: '' }, true) === targetCategory) : smartSources;
            if (isTargeted && targetCategory === 'tech') {
                sourcesToFetch = sourcesToFetch.filter(s => !isInvestingComSource(s));
            }
            const sourceResults = await fetchInBatches(
                sourcesToFetch,
                16,
                source => fetchSmartSource(source, helpers.fastParseRSS, headers),
                onProgress
            );
            notify('smart-normalizing', 'Normalizing publication times to Vietnam time…');
            const fetchedArticles = sourceResults.flatMap(result => result.articles);
            const previousHidden = isTargeted ? (await db.get('smartRawArticles', { type: 'json' }) || []) : [];
            const preservedHidden = isTargeted ? previousHidden.filter(a => a.smartCategory !== targetCategory) : [];
            const hiddenArticles = isTargeted ? [...preservedHidden, ...fetchedArticles] : fetchedArticles;
            const sourceErrors = sourceResults.filter(result => !result.ok).map(result => ({
                title: result.source.title,
                url: result.source.url,
                error: result.error
            }));

            const existing = await db.get('articles', { type: 'json' }) || [];
            const cutoff = Date.now() - 4 * DAY_MS;
            const normalArticles = existing
                .filter(article => article.link && safeDate(article.pubDate) >= cutoff && !isExcludedFromSmart(article))
                .map(article => normalizeArticle(article));

            const articleMap = new Map();
            for (const article of [...normalArticles, ...hiddenArticles]) {
                if (article.link && safeDate(article.pubDate) >= cutoff && !isExcludedFromSmart(article)) articleMap.set(article.link, article);
            }
            const candidates = [...articleMap.values()];
            const currentLinks = candidates.map(article => article.link).sort();
            const previousLinks = await db.get('smartCandidateLinks', { type: 'json' }) || [];
            const previousLinkSet = new Set(previousLinks);
            const addedLinks = currentLinks.filter(link => !previousLinkSet.has(link));
            const candidateByLink = new Map(candidates.map(article => [article.link, article]));
            const geminiCutoff = Date.now() - GEMINI_RECENT_WINDOW_MS;
            const newGeminiCandidateLinks = addedLinks.filter(link => {
                const article = candidateByLink.get(link);
                return article && article.publicationTimeReliable !== false && safeDate(article.pubDate) >= geminiCutoff;
            });
            const signature = stableId(currentLinks.join('|'));
            const previousSignature = await db.get('smartCandidateSignature') || '';
            const previousAiConfig = await db.get('smartAiConfig') || '';
            const sourceSignature = stableId(smartSources.map(source => [source.url, source.category, source.region, source.weight].join('|')).sort().join('\n'));
            const aiConfig = (apiKey ? model : 'disabled') + '|' + SMART_CLUSTER_VERSION + '|' + sourceSignature;
            const aiConfigurationChanged = previousAiConfig !== aiConfig;
            const existingClusters = await db.get('smartClusters', { type: 'json' }) || [];

            if (!isTargeted && signature === previousSignature && existingClusters.length && !aiConfigurationChanged) {
                const completed = {
                    state: 'ready',
                    startedAt,
                    completedAt: toVietnamIso(Date.now()),
                    configuredSourceCount: smartSources.length,
                    sourceCounts: smartSourceCounts,
                    successfulSourceCount: sourceResults.length - sourceErrors.length,
                    failedSourceCount: sourceErrors.length,
                    sourceErrors,
                    candidateCount: candidates.length,
                    clusterCount: existingClusters.length,
                    newArticleCount: 0,
                    geminiConfigured: Boolean(apiKey),
                    geminiUsed: false,
                    geminiReviewMode: 'individual_articles',
                    geminiReviewedArticleCount: 0,
                    geminiReason: 'No new articles; reused existing clusters',
                    geminiCandidateWindowHours: GEMINI_RECENT_WINDOW_MS / 3600000,
                    maxMergeTimeGapHours: EVENT_MATCH_WINDOW_MS / 3600000,
                    timezone: 'Asia/Ho_Chi_Minh (UTC+7)',
                    model
                };
                await setStatus(completed);
                notify('smart-ready', 'No new articles; existing Smart clusters were reused.');
                return { ok: true, skipped: true, ...completed };
            }

            notify('smart-clustering', 'Pre-calculating local embedding vectors (CPU MiniLM)...');
            await prepareEmbeddings(candidates);
            updateBatchStopTokens(candidates);

            notify('smart-clustering', 'Matching related stories and calculating hotness…');
            const groups = deterministicGroups(candidates);
            let clusters = groups.map(group => buildCluster(group.articles));
            let geminiUsed = false;
            let geminiReviewedArticleCount = 0;
            let geminiError = null;
            let geminiByCategoryStats = {
                news_vietnam: { ok: false, reviewed: 0, error: 'Not requested / CPU clustered' },
                news_world: { ok: false, reviewed: 0, error: 'Not requested / CPU clustered' },
                finance_vietnam: { ok: false, reviewed: 0, error: 'Not requested / CPU clustered' },
                finance_global: { ok: false, reviewed: 0, error: 'Not requested / CPU clustered' },
                tech: { ok: false, reviewed: 0, error: 'Not requested / CPU clustered' }
            };
            const forceLocalOnly = process.env.SMART_ONLY_LOCAL === 'true' || process.env.USE_GEMINI === 'false';
            let geminiReason = forceLocalOnly
                ? 'Running 100% Local CPU model only (Gemini AI disabled by setting)'
                : (isTargeted ? 'Single tab quick refresh (CPU local clustering used)' : (apiKey
                    ? (addedLinks.length && !newGeminiCandidateLinks.length
                        ? 'New links were outside the 24-hour Gemini window'
                        : 'No new recent articles')
                    : 'GEMINI_API_KEY is not configured'));
            const geminiEligibleArticleCount = candidates.filter(article => article.publicationTimeReliable !== false && safeDate(article.pubDate) >= geminiCutoff).length;
            const shouldUseGemini = !forceLocalOnly && !isTargeted && Boolean(apiKey) && geminiEligibleArticleCount > 1 && (newGeminiCandidateLinks.length > 0 || aiConfigurationChanged);

            if (shouldUseGemini) {
                try {
                    notify('smart-ai', 'Asking Gemini to group every eligible recent article…');
                    const aiResult = await applyGeminiMerges(groups, apiKey, model, newGeminiCandidateLinks);
                    clusters = aiResult.clusters;
                    geminiReviewedArticleCount = aiResult.reviewedArticleCount;
                    if (aiResult.geminiByCategory) geminiByCategoryStats = aiResult.geminiByCategory;

                    const successCategories = Object.entries(geminiByCategoryStats).filter(([_, v]) => v.ok).map(([k]) => k);
                    if (successCategories.length === 5) {
                        geminiUsed = true;
                        geminiReason = 'All eligible recent articles reviewed individually across all 5 categories';
                    } else if (successCategories.length > 0) {
                        geminiUsed = true;
                        geminiReason = `Partial AI review: succeeded for (${successCategories.join(', ')}), others fell back to CPU local clustering`;
                    } else {
                        geminiUsed = false;
                        geminiReason = 'Gemini failed across all categories; deterministic CPU embedding clustering used';
                        clusters = groups.map(group => buildCluster(group.articles));
                        console.warn(`[SMART WARNING] geminiUsed is false despite geminiEligibleArticleCount (${geminiEligibleArticleCount}) > 0. All AI categories failed or fell back to CPU clustering.`);
                    }
                } catch (error) {
                    geminiError = error.message;
                    geminiReason = 'Gemini failed; deterministic CPU embedding clustering used';
                    console.error('[SMART] Gemini clustering failed:', error.message);
                }
            } else if (geminiEligibleArticleCount > 0 && !geminiUsed) {
                console.warn(`[SMART WARNING] geminiUsed is false (Reason: ${geminiReason}). Using deterministic CPU embedding clustering.`);
            }

            clusters.sort((a, b) =>
                (b.hotness || 0) - (a.hotness || 0) ||
                (b.sourceWeight || 1) - (a.sourceWeight || 1) ||
                safeDate(b.pubDate) - safeDate(a.pubDate) ||
                String(a.clusterId || a.link || '').localeCompare(String(b.clusterId || b.link || ''))
            );
            notify('smart-saving', 'Saving ranked Smart clusters…');
            clusters = clusters.map(c => cleanStoredCluster(c));
            for (const c of clusters) {
                if (c) delete c._vec;
                if (c?.relatedArticles) {
                    for (const r of c.relatedArticles) if (r) delete r._vec;
                }
            }
            for (const a of hiddenArticles) if (a) delete a._vec;
            const clusterVersion = toVietnamIso(Date.now()) + '_' + clusters.length;
            await db.put('smartRawArticles', JSON.stringify(hiddenArticles));
            await db.put('smartClusters', JSON.stringify(clusters));
            await db.put('smartClusterVersion', clusterVersion);
            await db.put('smartCandidateLinks', JSON.stringify(currentLinks));
            await db.put('smartCandidateSignature', signature);
            await db.put('smartAiConfig', aiConfig);

            const completed = {
                state: 'ready',
                startedAt,
                completedAt: toVietnamIso(Date.now()),
                configuredSourceCount: smartSources.length,
                sourceCounts: smartSourceCounts,
                successfulSourceCount: sourceResults.length - sourceErrors.length,
                failedSourceCount: sourceErrors.length,
                sourceErrors,
                hiddenArticleCount: hiddenArticles.length,
                candidateCount: candidates.length,
                clusterCount: clusters.length,
                newArticleCount: addedLinks.length,
                newGeminiCandidateCount: newGeminiCandidateLinks.length,
                geminiEligibleArticleCount,
                geminiConfigured: Boolean(apiKey),
                geminiUsed,
                geminiReviewMode: 'individual_articles',
                geminiReviewedArticleCount,
                geminiReason,
                geminiError,
                geminiByCategory: geminiByCategoryStats,
                geminiCandidateWindowHours: GEMINI_RECENT_WINDOW_MS / 3600000,
                maxMergeTimeGapHours: EVENT_MATCH_WINDOW_MS / 3600000,
                timezone: 'Asia/Ho_Chi_Minh (UTC+7)',
                model
            };
            await setStatus(completed);
            notify('smart-ready', `Smart feed ready: ${clusters.length} clusters.`);
            console.log('[SMART] Ready:', clusters.length, 'clusters from', candidates.length, 'articles;', sourceErrors.length, 'source errors; Gemini:', geminiReason);
            return { ok: true, ...completed };
        } catch (error) {
            const failed = {
                state: 'error',
                startedAt,
                completedAt: toVietnamIso(Date.now()),
                error: error.message,
                configuredSourceCount: smartSources.length,
                sourceCounts: smartSourceCounts,
                geminiConfigured: Boolean(apiKey),
                geminiCandidateWindowHours: GEMINI_RECENT_WINDOW_MS / 3600000,
                maxMergeTimeGapHours: EVENT_MATCH_WINDOW_MS / 3600000,
                timezone: 'Asia/Ho_Chi_Minh (UTC+7)',
                model
            };
            await setStatus(failed);
            notify('smart-error', 'Smart refresh failed.', { failed: true });
            console.error('[SMART] Refresh failed:', error.message);
            return { ok: false, ...failed };
        } finally {
            running = false;
            if (_embeddingCache && _embeddingCache.size > 2000) _embeddingCache.clear();
            if (global.gc) global.gc();
        }
    }

    function scheduleNext() {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            await sync();
            scheduleNext();
        }, SMART_REFRESH_MS);
        if (timer.unref) timer.unref();
    }

    function start() {
        const initial = setTimeout(() => sync(), 2500);
        if (initial.unref) initial.unref();
        scheduleNext();
        getSources()
            .then(sources => console.log('[SMART] Engine initialized with', sources.length, 'hidden sources; model:', model))
            .catch(error => console.error('[SMART] Could not load source settings:', error.message));
    }

    return { getStatus, getSources, getSourceSettings, addSource, removeSource, setSourceEnabled, discoverSources, resetSources, sync, start };
}
