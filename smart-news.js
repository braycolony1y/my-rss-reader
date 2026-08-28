import {
  SMART_SOURCES as DEFAULT_SMART_SOURCES,
  SMART_SOURCE_DISCOVERY_POOL
} from './smart-sources.js';
import { decodeHTMLEntities } from './feed-parsers.js';
import { normalizeArticleSourceUrl } from './src/article-source-state.js';
import { discardResponseBody } from './src/fetch-response.js';
import { createHash } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const SMART_REFRESH_MS = 30 * 60 * 1000;
const VIETNAM_OFFSET_MS = 7 * HOUR_MS;

const SMART_ITEMS_PER_SOURCE = 10;
const SMART_CLUSTER_VERSION =
  'v2.12_named_entity_gate_20260826';

const EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';
const EMBEDDING_CACHE_VERSION = 'e5-query-title-content-v2';
export const EMBEDDING_CACHE_FILE =
  process.env.SMART_EMBEDDING_CACHE_FILE ||
  fileURLToPath(
    new URL(
      './smart-embeddings-worker.json',
      import.meta.url
    )
  );

const VALID_SMART_CATEGORIES = new Set([
  'news_vietnam',
  'news_world',
  'finance_vietnam',
  'finance_global',
  'tech'
]);

const EXCLUDED_SMART_FEED_URLS = new Set([
  'https://voz.vn/f/chuyen-tro-linh-tinh-tm.17/index.rss',
  'https://voz.vn/f/phan-mem.13/index.rss'
]);

const SMART_NEWS_CLUSTER_CONFIG = {
  comparisonWindowHours: 72,
  newArticleTriggerHours: 24,
  activeClusterMaxAgeDays: 7,
  activeClusterRecentCoverageHours: 72,
  topKCandidates: 20,

  thresholds: {
    sameLanguage: {
      review: 0.88,
      autoMerge: 0.94
    },
    crossLanguage: {
      review: 0.86,
      autoMerge: 0.89
    }
  },

  heavyAI: {
    enabled: true,
    maxArticlesPerOnlineReview: 20,
    maxArticlesPerLocalReview: 12,
    keepSeparateOnFailure: true
  }
};

const SMART_NEWS_AI_CONFIG = {
  providers: [
    {
      id: 'gemini-flash-lite',
      type: 'gemini',
      model:
        process.env.GEMINI_FLASH_LITE_MODEL ||
        'gemini-3.5-flash-lite',
      priority: 1,
      timeoutMs: 15_000,
      maxRetries: 1
    },
    {
      id: 'gemini-flash',
      type: 'gemini',
      model:
        process.env.GEMINI_FLASH_MODEL ||
        process.env.GEMINI_MODEL ||
        'gemini-3.7-flash',
      priority: 3,
      timeoutMs: 25_000,
      maxRetries: 1
    },
    {
      id: 'local-qwen',
      type: 'ollama',
      model:
        process.env.OLLAMA_SMART_MODEL ||
        'qwen3.5:2b',
      baseUrl:
        process.env.OLLAMA_BASE_URL ||
        'http://127.0.0.1:11434',
      priority: 4,
      timeoutMs: Math.max(
        15_000,
        Math.min(
          120_000,
          Number(process.env.SMART_LOCAL_AI_TIMEOUT_MS) ||
          60_000
        )
      ),
      maxRetries: 0
    }
  ],

  keepSeparateOnFailure: true,

  cache: {
    enabled: true,
    maxEntries: 500,
    maxAgeMs: 14 * DAY_MS,
    promptVersion: 'event-verifier-v4',
    rulesVersion: 'event-rules-v4',
    schemaVersion: 'event-partition-v2'
  }
};

const LOCAL_AI_CONTEXT_TOKENS = Math.max(
  2048,
  Math.min(
    8192,
    Number(process.env.SMART_LOCAL_AI_NUM_CTX) || 4096
  )
);

const LOCAL_AI_OUTPUT_TOKENS = Math.max(
  256,
  Math.min(
    2048,
    Number(process.env.SMART_LOCAL_AI_NUM_PREDICT) || 768
  )
);

const LOCAL_AI_KEEP_ALIVE =
  process.env.SMART_LOCAL_AI_KEEP_ALIVE || '2m';

const EMBEDDING_BATCH_SIZE = Math.max(
  1,
  Math.min(
    16,
    Number(process.env.SMART_EMBEDDING_BATCH_SIZE) || 8
  )
);

export const MatchDecision = {
  AUTO_MERGE: 'auto_merge',
  REVIEW: 'review',
  REJECT: 'reject'
};

const PARTITION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    clusters: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          articleIds: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: {
              type: 'string'
            }
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1
          }
        },
        required: ['articleIds'],
        additionalProperties: false
      }
    },
    uncertain: {
      type: 'boolean'
    }
  },
  required: ['clusters', 'uncertain'],
  additionalProperties: false
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on',
  'at', 'with', 'from', 'by', 'is', 'are', 'this', 'that', 'after',
  'new', 'says', 'say', 'said', 'as', 'it', 'its', 'be', 'has',
  'have', 'will', 'more', 'about', 'according', 'announces',
  'announced', 'report', 'reports', 'reported', 'official',
  'officials', 'market', 'markets', 'stock', 'stocks', 'share',
  'shares', 'price', 'prices', 'business', 'finance', 'financial',
  'global', 'world', 'national', 'local', 'state', 'country',
  'government', 'company', 'companies', 'group', 'industry',
  'percent', 'billion', 'million', 'year', 'years', 'month',
  'months', 'week', 'weeks', 'day', 'days', 'today', 'yesterday',
  'latest', 'breaking', 'update', 'updates', 'live', 'video',
  'photo', 'watch', 'can', 'could', 'would', 'should', 'may',
  'might', 'must', 'over', 'under', 'into', 'through', 'against',
  'what', 'why', 'how', 'when', 'where', 'who', 'which', 'while',
  'because', 'both', 'only', 'just', 'even', 'also', 'than',
  'other', 'another', 'some', 'any', 'all', 'every', 'much',
  'many', 'most', 'very', 'already', 'still',

  'va', 'la', 'cua', 'cho', 'voi', 'tai', 'tu', 'trong', 'tren',
  'sau', 'truoc', 'nhung', 'mot', 'cac', 'khi', 'duoc', 'co',
  'se', 've', 'theo', 'nay', 'dang', 'den', 'khong', 'nhieu',
  'chuyen', 'gia', 'tinh', 'thanh', 'quoc', 'viet', 'nam',
  'gioi', 'cong', 'ty', 'giam', 'doc', 'chu', 'tich', 'bo',
  'truong', 'lanh', 'dao', 'chinh', 'phu', 'dau', 'tu', 'du',
  'an', 'phat', 'trien', 'kinh', 'te', 'thi', 'truong', 'ngan',
  'hang', 'doanh', 'nghiep', 'phieu', 'chung', 'khoan', 'vang',
  'lai', 'suat', 'lam', 'xuat', 'khau', 'nhap', 'bat', 'dong',
  'san', 'nha', 'dat', 'tieu', 'dung', 'so', 'thu', 'hoi',
  'quan', 'tri', 'ban', 'hanh', 'quyet', 'dinh', 'thong', 'tin',
  'tuc', 'bao', 'cao', 'nguoi', 'dan', 'to', 'can', 'tra',
  'dieu', 'xu', 'ly', 'pham', 'giai', 'quyet', 'ho', 'tro',
  'tham', 'chuc', 'hoat', 'kien', 'van', 'de', 'ket', 'qua',
  'muc', 'thoi', 'gian', 'khu', 'vuc', 'pho', 'huyen', 'xa',
  'phuong', 'ngay', 'thang', 'ngoai', 'duoi', 'giua', 'lon',
  'nho', 'moi', 'cu', 'thap', 'tuy', 'nhien', 'do', 'nen',
  'phai', 'hoac', 'cung', 'hai', 'ba', 'bon', 'sau', 'bay',
  'tam', 'chin', 'muoi', 'tram', 'nghin', 'trieu', 'ty', 'dong',
  'usd', 'vnd', 'tuan', 'quy', 'hom', 'qua', 'mai'
]);

const ACTION_GROUPS = {
  investigation: {
    en: ['investigate', 'investigation', 'probe', 'under investigation'],
    vi: ['dieu tra', 'xac minh']
  },
  arrest: {
    en: ['arrest', 'arrested', 'detain', 'detained', 'taken into custody'],
    vi: ['bat giu', 'tam giu', 'tam giam']
  },
  charge: {
    en: ['charge', 'charged', 'indict', 'indicted', 'prosecute'],
    vi: ['khoi to', 'truy to', 'cao buoc']
  },
  trial: {
    en: ['trial', 'stand trial', 'court hearing'],
    vi: ['xet xu', 'hau toa', 'phien toa']
  },
  conviction: {
    en: ['convict', 'convicted', 'found guilty'],
    vi: ['ket toi', 'tuyen co toi']
  },
  sentencing: {
    en: ['sentence', 'sentenced'],
    vi: ['ket an', 'tuyen an', 'linh an']
  },
  appeal: {
    en: ['appeal', 'appealed'],
    vi: ['khang cao', 'phuc tham']
  },
  sentenceUpheld: {
    en: ['uphold sentence', 'sentence upheld'],
    vi: ['y an', 'giu nguyen ban an']
  },
  resign: {
    en: ['resign', 'resigned', 'step down', 'quit'],
    vi: ['tu chuc', 'xin thoi', 'roi ghe']
  },
  appoint: {
    en: ['appoint', 'appointed', 'named as'],
    vi: ['bo nhiem', 'chi dinh']
  },
  nominate: {
    en: ['nominate', 'nominated'],
    vi: ['de cu']
  },
  acquire: {
    en: ['acquire', 'acquired', 'acquisition', 'buyout', 'merger'],
    vi: ['mua lai', 'sap nhap', 'thau tom']
  },
  launch: {
    en: ['launch', 'launched', 'release', 'released'],
    vi: ['ra mat', 'trinh lang', 'phat hanh']
  },
  approve: {
    en: ['approve', 'approved', 'passed'],
    vi: ['phe duyet', 'thong qua', 'chap thuan']
  },
  propose: {
    en: ['propose', 'proposed'],
    vi: ['de xuat', 'kien nghi']
  },
  earnings: {
    en: ['earnings', 'profit', 'revenue'],
    vi: ['ket qua kinh doanh', 'loi nhuan', 'doanh thu', 'bao lai']
  }
};

let batchStopTokens = new Set();
let embeddingPipeline = null;
const embeddingCache = new Map();

let providerHealthWriteChain = Promise.resolve();
let verificationCacheWriteChain = Promise.resolve();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stripHtml(value = '') {
  let decoded = String(value);

  for (let pass = 0; pass < 3; pass++) {
    const next = decodeHTMLEntities(decoded);
    if (next === decoded) break;
    decoded = next;
  }

  return decoded
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
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsNormalizedPhrase(normalizedText, phrase) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;

  const pattern = new RegExp(
    `(?:^|\\s)${escapeRegExp(normalizedPhrase).replace(/\s+/g, '\\s+')}(?:$|\\s)`,
    'i'
  );

  return pattern.test(normalizedText);
}

function cleanTitleForScoring(title) {
  if (!title) return '';

  let value = String(title).trim();

  value = value.replace(/^\[[^\]]+\]\s*|\([^)]+\)\s*/g, '');

  value = value.replace(
    /\s*[|–-]\s*[^\n|–-]{2,40}$/u,
    match => {
      if (
        /^[^\w\p{L}]*[\p{L}\d\s.&'"]+$/u.test(match) &&
        match.length < 42
      ) {
        return '';
      }
      return match;
    }
  );

  value = value.replace(
    /\s*[|–-]\s*[A-Z0-9\s.,&'"]+$/i,
    ''
  );

  value = value.replace(
    /\bprice prediction(?:\s*:\s*|\s+)\d{4}(?:,\s*\d{4})*(?:[-–]\d{4})?\b/gi,
    ''
  );

  value = value.replace(
    /\bhints? and answers? for\s+[a-z]+\s+\d{1,2}\b/gi,
    ''
  );

  value = value.replace(
    /\b(?:dự báo giá|bảng giá|cập nhật giá)\b/gi,
    ''
  );

  return value.trim() || String(title).trim();
}

export function updateBatchStopTokens(articles) {
  batchStopTokens = new Set();

  if (!Array.isArray(articles) || articles.length < 50) {
    return;
  }

  const counts = new Map();
  const threshold = Math.max(
    15,
    Math.floor(articles.length * 0.025)
  );

  for (const article of articles) {
    const words = new Set(
      normalizeText(cleanTitleForScoring(article.title))
        .split(' ')
        .filter(
          word =>
            word.length > 2 &&
            !STOP_WORDS.has(word)
        )
    );

    for (const word of words) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }

  for (const [word, count] of counts.entries()) {
    if (count > threshold) {
      batchStopTokens.add(word);
    }
  }
}

function titleTokens(title) {
  return new Set(
    normalizeText(cleanTitleForScoring(title))
      .split(' ')
      .filter(
        word =>
          word.length > 2 &&
          !STOP_WORDS.has(word) &&
          !batchStopTokens.has(word)
      )
  );
}

export function tokenSimilarity(left, right) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let shared = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared++;
    }
  }

  const union =
    leftTokens.size +
    rightTokens.size -
    shared;

  const jaccard = union ? shared / union : 0;
  const containment =
    shared /
    Math.min(leftTokens.size, rightTokens.size);

  return Math.max(
    jaccard,
    containment * 0.82
  );
}

export function tokenOverlapCount(left, right) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);

  let shared = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared++;
    }
  }

  return shared;
}

export function stableId(value) {
  const text = String(value || '');

  let hash = 2166136261;

  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function getArticleId(article) {
  if (article?.link) {
    return `a_${stableId(article.link)}`;
  }

  if (article?.id) {
    return `a_${stableId(article.id)}`;
  }

  return `a_${stableId([
    article?.title,
    article?.pubDate,
    article?.feedTitle
  ].filter(Boolean).join('|'))}`;
}

function createGroupId(articles) {
  const ids = articles
    .map(getArticleId)
    .sort();

  return `g_${stableId(ids.join('|'))}`;
}

function parsePublishedTimestamp(value) {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'number') {
    return value < 100000000000
      ? value * 1000
      : value;
  }

  let raw = String(value || '')
    .replace(/[\u200B-\u200D\u202F\u00A0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw) return NaN;

  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    return raw.length <= 10
      ? numeric * 1000
      : numeric;
  }

  raw = raw
    .replace(/\bSA\b/i, 'AM')
    .replace(/\bCH\b/i, 'PM');

  const makeVietnamTime = (
    year,
    month,
    day,
    hour = 0,
    minute = 0,
    second = 0,
    meridiem = ''
  ) => {
    year = Number(year);
    month = Number(month);
    day = Number(day);
    hour = Number(hour || 0);
    minute = Number(minute || 0);
    second = Number(second || 0);

    if (meridiem) {
      if (hour === 12) hour = 0;
      if (
        String(meridiem).toUpperCase() ===
        'PM'
      ) {
        hour += 12;
      }
    }

    if (
      year < 2000 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      return NaN;
    }

    const timestamp =
      Date.UTC(
        year,
        month - 1,
        day,
        hour,
        minute,
        second
      ) -
      VIETNAM_OFFSET_MS;

    const check = new Date(
      timestamp + VIETNAM_OFFSET_MS
    );

    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      return NaN;
    }

    return timestamp;
  };

  const hasExplicitZone =
    /(?:Z|[+-]\d{2}:?\d{2}|GMT[+-]\d{1,2})$/i.test(raw) ||
    /\s(?:GMT|UTC|UT|ICT|[A-Z]{3,4})$/i.test(raw);

  if (hasExplicitZone) {
    const normalized = raw
      .replace(/\sICT$/i, ' GMT+0700')
      .replace(/GMT\+7$/i, 'GMT+0700');

    return new Date(normalized).getTime();
  }

  const yearFirst = raw.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  );

  if (yearFirst) {
    return makeVietnamTime(
      yearFirst[1],
      yearFirst[2],
      yearFirst[3],
      yearFirst[4],
      yearFirst[5],
      yearFirst[6],
      yearFirst[7]
    );
  }

  const localNumeric = raw.match(
    /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  );

  if (localNumeric) {
    const first = Number(localNumeric[1]);
    const second = Number(localNumeric[2]);
    const hasMeridiem =
      Boolean(localNumeric[7]);

    const monthFirst =
      second > 12 ||
      (
        first <= 12 &&
        second <= 12 &&
        hasMeridiem
      );

    const month = monthFirst
      ? first
      : second;

    const day = monthFirst
      ? second
      : first;

    return makeVietnamTime(
      localNumeric[3],
      month,
      day,
      localNumeric[4],
      localNumeric[5],
      localNumeric[6],
      localNumeric[7]
    );
  }

  return new Date(
    `${raw} GMT+0700`
  ).getTime();
}

function safeDate(value) {
  const timestamp =
    parsePublishedTimestamp(value);

  return Number.isFinite(timestamp) &&
    timestamp > 0
    ? timestamp
    : Date.now();
}

function toVietnamIso(value) {
  const timestamp = safeDate(value);

  const vietnamWallClock = new Date(
    timestamp + VIETNAM_OFFSET_MS
  ).toISOString();

  return `${vietnamWallClock.slice(0, -1)}+07:00`;
}

function hostFromUrl(value) {
  try {
    return new URL(value)
      .hostname
      .replace(/^www\./, '');
  } catch {
    return '';
  }
}

function canonicalSourceUrl(
  value,
  omitQuery = false
) {
  try {
    const url = new URL(
      String(value || '').trim()
    );

    if (
      !['http:', 'https:'].includes(
        url.protocol
      )
    ) {
      return '';
    }

    url.hash = '';

    if (omitQuery) {
      url.search = '';
    }

    return url.href.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function canonicalSourceIdentity(article) {
  return (
    article?.domain ||
    hostFromUrl(article?.link || article?.feedUrl || '') ||
    article?.feedTitle ||
    ''
  )
    .toLowerCase()
    .replace(/^www\./, '')
    .trim();
}

function publisherIcon(value) {
  const hostname = hostFromUrl(
    String(value || '').includes('://')
      ? value
      : `https://${value}`
  );

  if (hostname.includes('tuoitre.vn')) {
    return 'https://statictuoitre.mediacdn.vn/web_images/favicon.ico';
  }

  if (hostname.includes('kenh14.vn')) {
    return 'https://kenh14cdn.com/web_images/kenh14-favicon.ico';
  }

  if (hostname.includes('soha.vn')) {
    return 'https://sohanews.sohacdn.com/icons/soha-32.png';
  }

  if (hostname.includes('genk.vn')) {
    return 'https://genk.mediacdn.vn/web_images/genk32.png';
  }

  if (hostname.includes('vjst.vn')) {
    return 'https://ictv.1cdn.vn/assets/static/images/logo.png';
  }

  if (hostname.includes('vtv.vn')) {
    return 'https://static.mediacdn.vn/vtv.vn/images/favicon.ico';
  }

  if (hostname.includes('pcworld.com')) {
    return 'https://icons.duckduckgo.com/ip3/pcworld.com.ico';
  }

  return hostname
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`
    : '';
}

function isExcludedSmartUrl(
  value,
  dynamicExcludedUrls = null
) {
  const url = canonicalSourceUrl(
    value,
    true
  );

  if (EXCLUDED_SMART_FEED_URLS.has(url)) {
    return true;
  }

  return Boolean(
    dynamicExcludedUrls?.has(url)
  );
}

export function isExcludedFromSmart(
  article,
  dynamicExcludedUrls = null
) {
  return isExcludedSmartUrl(
    article?.feedUrl,
    dynamicExcludedUrls
  );
}

function containsVietnameseSignals(text) {
  return (
    /[ăâđêôơưàảãạáằẳẵặắầẩẫậấèẻẽẹéềểễệếìỉĩịíòỏõọóồổỗộốờởỡợớùủũụúừửữựứỳỷỹỵý]/i.test(
      text
    ) ||
    /\b(của|và|trong|cho|với|tại|theo|người|công|những|được|trên|này|khi)\b/i.test(
      text
    )
  );
}

function detectArticleLanguage(article) {
  const explicit = String(
    article?.language ||
    article?.lang ||
    ''
  ).toLowerCase();

  if (explicit.startsWith('vi')) {
    return 'vi';
  }

  if (explicit.startsWith('en')) {
    return 'en';
  }

  const text = [
    article?.title,
    article?.content,
    article?.summary,
    article?.description
  ]
    .filter(Boolean)
    .join(' ');

  if (containsVietnameseSignals(text)) {
    return 'vi';
  }

  if (/[a-z]{3,}/i.test(text)) {
    return 'en';
  }

  return 'unknown';
}

function isVietnameseArticle(article) {
  return (
    article?.language === 'vi' ||
    detectArticleLanguage(article) === 'vi'
  );
}

function isEnglishArticle(article) {
  return (
    article?.language === 'en' ||
    detectArticleLanguage(article) === 'en'
  );
}

function isInvestingComSource(item) {
  if (!item) return false;

  const host = hostFromUrl(
    item.link ||
    item.feedUrl ||
    item.url ||
    ''
  );

  const text = [
    host,
    item.feedTitle,
    item.sourceName,
    item.source,
    item.link,
    item.feedUrl,
    item.url
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return text.includes('investing.com');
}

export function refineArticleCategory(
  item,
  initialCategory
) {
  if (!item) {
    return initialCategory ||
      'news_vietnam';
  }

  const host = hostFromUrl(
    item.link ||
    item.feedUrl ||
    ''
  );

  const language =
    item.language ||
    detectArticleLanguage(item);

  const isVietnamese =
    language === 'vi' ||
    host.endsWith('.vn') ||
    host.includes('voz.vn') ||
    host.includes('baomoi.com');

  if (
    isInvestingComSource(item) &&
    initialCategory === 'tech'
  ) {
    return isVietnamese
      ? 'finance_vietnam'
      : 'finance_global';
  }

  const titleText =
    normalizeText(item.title || '');

  const summaryText =
    normalizeText(
      item.content ||
      item.summary ||
      ''
    );

  const combined =
    `${titleText} ${summaryText}`;

  const crimeTerms = [
    'cong an',
    'khoi to',
    'bi bat',
    'tai nan',
    'giet nguoi',
    'lua dao',
    'xu phat',
    'hiep dam',
    'cuop',
    'danh nhau',
    'tu tu'
  ];

  if (
    crimeTerms.some(term =>
      containsNormalizedPhrase(
        combined,
        term
      )
    )
  ) {
    const isCyber =
      containsNormalizedPhrase(
        combined,
        'hack'
      ) ||
      containsNormalizedPhrase(
        combined,
        'malware'
      ) ||
      containsNormalizedPhrase(
        combined,
        'an ninh mang'
      ) ||
      containsNormalizedPhrase(
        combined,
        'cybersecurity'
      );

    if (!isCyber) {
      return isVietnamese
        ? 'news_vietnam'
        : 'news_world';
    }
  }

  if (initialCategory === 'tech') {
    const technologyTerms = [
      'ai',
      'artificial intelligence',
      'chatgpt',
      'openai',
      'gemini',
      'apple',
      'google',
      'microsoft',
      'meta',
      'tiktok',
      'samsung',
      'iphone',
      'android',
      'semiconductor',
      'ban dan',
      'nvidia',
      'cybersecurity',
      'an ninh mang',
      'smartphone',
      'dien thoai',
      'may tinh',
      'laptop',
      'phan mem',
      'software',
      'hardware',
      'chip',
      'robot',
      '5g',
      '6g',
      'internet'
    ];

    const financeTerms = [
      'chung khoan',
      'co phieu',
      'kinh te',
      'tai chinh',
      'doanh nghiep',
      'gia vang',
      'lai suat',
      'ty gia',
      'lam phat',
      'ngan hang',
      'gdp',
      'bat dong san',
      'thi truong',
      'trai phieu',
      'thue'
    ];

    const hasTechnology =
      technologyTerms.some(term =>
        containsNormalizedPhrase(
          combined,
          term
        )
      );

    const hasFinance =
      financeTerms.some(term =>
        containsNormalizedPhrase(
          combined,
          term
        )
      );

    if (
      hasFinance &&
      !hasTechnology
    ) {
      return isVietnamese
        ? 'finance_vietnam'
        : 'finance_global';
    }
  }

  let result =
    initialCategory ||
    (
      isVietnamese
        ? 'news_vietnam'
        : 'news_world'
    );

  if (
    result === 'tech' &&
    isInvestingComSource(item)
  ) {
    result = isVietnamese
      ? 'finance_vietnam'
      : 'finance_global';
  }

  return result;
}

function inferCategory(
  article,
  forceReinfer = false
) {
  if (
    !forceReinfer &&
    article.smartCategory &&
    VALID_SMART_CATEGORIES.has(
      article.smartCategory
    )
  ) {
    return refineArticleCategory(
      article,
      article.smartCategory
    );
  }

  const host = hostFromUrl(
    article.link ||
    article.feedUrl ||
    ''
  );

  const language =
    article.language ||
    detectArticleLanguage(article);

  const isVietnamese =
    language === 'vi' ||
    host.endsWith('.vn') ||
    host.includes('voz.vn') ||
    host.includes('baomoi.com');

  const feedCategory =
    normalizeText(
      article.feedCategory || ''
    );

  const title =
    normalizeText(article.title || '');

  let category = isVietnamese
    ? 'news_vietnam'
    : 'news_world';

  if (isInvestingComSource(article)) {
    category = isVietnamese
      ? 'finance_vietnam'
      : 'finance_global';
  } else if (
    feedCategory.includes('tech') ||
    feedCategory.includes('phan mem') ||
    feedCategory.includes('cong nghe') ||
    feedCategory.includes('khoa hoc')
  ) {
    category = 'tech';
  } else if (
    feedCategory.includes('finance') ||
    feedCategory.includes('business') ||
    feedCategory.includes('kinh te') ||
    feedCategory.includes('tai chinh') ||
    feedCategory.includes('chung khoan')
  ) {
    category = isVietnamese
      ? 'finance_vietnam'
      : 'finance_global';
  } else {
    const financeTerms = [
      'finance',
      'business',
      'econom',
      'stock',
      'market',
      'bank',
      'chung khoan',
      'tai chinh',
      'kinh te',
      'doanh nghiep',
      'gia vang',
      'crypto',
      'bitcoin',
      'lai suat',
      'ty gia'
    ];

    const technologyTerms = [
      'tech',
      'technology',
      'science',
      'artificial intelligence',
      'software',
      'hardware',
      'smartphone',
      'apple',
      'google',
      'microsoft',
      'startup',
      'cong nghe',
      'khoa hoc',
      'chatgpt',
      'openai',
      'iphone',
      'android',
      'semiconductor',
      'nvidia',
      'cybersecurity'
    ];

    const combined =
      `${feedCategory} ${title}`;

    if (
      financeTerms.some(term =>
        combined.includes(term)
      )
    ) {
      category = isVietnamese
        ? 'finance_vietnam'
        : 'finance_global';
    } else if (
      technologyTerms.some(term =>
        combined.includes(term)
      )
    ) {
      category = 'tech';
    }
  }

  return refineArticleCategory(
    article,
    category
  );
}

function normalizeSmartSource(source) {
  const url = canonicalSourceUrl(
    source?.url
  );

  if (
    !url ||
    isExcludedSmartUrl(url)
  ) {
    return null;
  }

  let category =
    VALID_SMART_CATEGORIES.has(
      source.category
    )
      ? source.category
      : 'news_world';

  if (
    category === 'tech' &&
    isInvestingComSource(source)
  ) {
    category = 'finance_global';
  }

  const region =
    category === 'tech'
      ? (
        source.region === 'vietnam'
          ? 'vietnam'
          : 'foreign'
      )
      : (
        category.endsWith('_vietnam')
          ? 'vietnam'
          : 'foreign'
      );

  const weight =
    Number(source.weight);

  return {
    title: stripHtml(
      source.title ||
      hostFromUrl(url) ||
      'News source'
    ).slice(0, 120),

    domain: stripHtml(
      source.domain ||
      hostFromUrl(url)
    ).slice(0, 160),

    category,
    region,
    url,

    fallbackUrl:
      canonicalSourceUrl(
        source.fallbackUrl || ''
      ),

    weight:
      Number.isFinite(weight)
        ? Math.max(
          0.5,
          Math.min(1.5, weight)
        )
        : 1,

    enabled:
      source.enabled !== false,

    discovered:
      source.discovered === true
  };
}

function countSmartSources(sources) {
  const counts = {
    news_vietnam: 0,
    news_world: 0,
    finance_vietnam: 0,
    finance_global: 0,
    tech: 0
  };

  for (const source of sources) {
    if (
      Object.hasOwn(
        counts,
        source.category
      )
    ) {
      counts[source.category]++;
    }
  }

  return counts;
}

export function normalizeArticle(
  item,
  source = {}
) {
  const link = normalizeArticleSourceUrl(
    item.link || ''
  );

  const sourceTitle =
    source.title ||
    item.feedTitle ||
    hostFromUrl(link) ||
    'News source';

  const language =
    item.language ||
    detectArticleLanguage(item);

  const rawCategory =
    source.category ||
    inferCategory(
      {
        ...item,
        language
      },
      true
    );

  const category =
    refineArticleCategory(
      {
        ...item,
        language
      },
      rawCategory
    );

  const parsedPublicationTime =
    parsePublishedTimestamp(item.pubDate);

  const publicationTimeReliable =
    item.publicationTimeReliable !== false &&
    Number.isFinite(
      parsedPublicationTime
    ) &&
    parsedPublicationTime >=
    Date.UTC(2000, 0, 1) &&
    parsedPublicationTime <=
    Date.now() + 2 * HOUR_MS;

  const sortablePublicationTime =
    publicationTimeReliable
      ? parsedPublicationTime
      : Date.now() - 3.5 * DAY_MS;

  const cleanedTitle = stripHtml(item.title || 'Untitled');
  const cleanedContent = stripHtml(
    item.content || item.summary || item.description || ''
  ).slice(0, 900);

  const articleKey =
    link ||
    `${sourceTitle}:${item.guid || ''}`;

  const contentHash = createHash('sha256')
    .update([
      cleanedTitle,
      cleanedContent.slice(0, 500),
      toVietnamIso(sortablePublicationTime),
      category
    ].join('\n'))
    .digest('hex');

  return {
    articleKey,
    contentHash,
    title: cleanedTitle,
    link,
    pubDate: toVietnamIso(sortablePublicationTime),
    rawPubDate: publicationTimeReliable ? undefined : String(item.pubDate || ''),
    publicationTimeReliable,
    content: cleanedContent,

    image:
      item.image ||
      item.imageUrl ||
      '',

    feedTitle: sourceTitle,

    feedIcon:
      publisherIcon(
        source.domain ||
        link
      ) ||
      item.feedIcon ||
      (
        'https://icons.duckduckgo.com/ip3/' +
        hostFromUrl(link) +
        '.ico'
      ),

    feedUrl:
      source.url ||
      item.feedUrl ||
      '',

    feedCategory:
      item.feedCategory ||
      category,

    smartCategory: category,
    language,

    region:
      source.region ||
      (
        category.endsWith('_vietnam')
          ? 'vietnam'
          : (
            category.endsWith('_world') ||
              category.endsWith('_global')
              ? 'foreign'
              : ''
          )
      ),

    domain:
      source.domain ||
      hostFromUrl(link),

    sourceWeight:
      source.weight ||
      item.sourceWeight ||
      1,

    hiddenSmartSource:
      Boolean(
        source.hiddenSmartSource
      )
  };
}

export function buildEmbeddingText(article) {
  const title = cleanTitleForScoring(article?.title || '');
  const description = stripHtml(
    article?.description ||
    article?.summary ||
    article?.content ||
    ''
  ).replace(/\s+/g, ' ').trim().slice(0, 500);

  return `query: ${[title, description].filter(Boolean).join('. ')}`;
}

export function embeddingCacheKey(article) {
  if (!article.contentHash) {
    throw new Error('article.contentHash is required for embeddingCacheKey');
  }
  return createHash('sha256')
    .update([
      'Xenova/multilingual-e5-small',
      'v3',
      article.contentHash
    ].join('\n'))
    .digest('hex');
}

import { Worker } from 'node:worker_threads';

let embeddingWorker = null;
let workerMsgId = 0;
const workerPromises = new Map();

let clusterWorker = null;

function getClusterWorker() {
  if (clusterWorker) return clusterWorker;

  clusterWorker = new Worker(
    new URL('./smart-cluster-worker.js', import.meta.url),
    { type: 'module' }
  );

  clusterWorker.on('error', err => {
    console.error(
      '[SMART CLUSTER WORKER] Fatal error:',
      err?.stack || err?.message || err
    );

    // onnxruntime-node 1.14.0 cannot safely initialize in a
    // replacement worker in the same Node process.
    // Restart the whole service instead.
    setImmediate(() => process.exit(1));
  });

  clusterWorker.on('exit', code => {
    clusterWorker = null;

    console.error(
      `[SMART CLUSTER WORKER] Unexpected exit with code ${code}; restarting service`
    );

    // Never create a second ONNX worker in this Node process.
    setImmediate(() => process.exit(1));
  });

  return clusterWorker;
}

export function disposeEmbeddingModel() {
  // Keep the embedding worker alive for the lifetime of this Node process.
  //
  // @xenova/transformers 2.17.2 uses onnxruntime-node 1.14.0, whose ARM64
  // native addon cannot be loaded successfully by a replacement Worker
  // after the first embedding Worker has been terminated.
  //
  // Reusing one persistent Worker also avoids repeatedly loading the E5 model.
  return;
}

function getEmbeddingWorker() {
  if (embeddingWorker) return embeddingWorker;

  embeddingWorker = new Worker(new URL('./smart-embedding-worker.js', import.meta.url), { type: 'module' });

  embeddingWorker.on('message', (msg) => {
    if (msg.type === 'pong') return;
    const p = workerPromises.get(msg.id);
    if (!p) return;
    workerPromises.delete(msg.id);

    if (msg.type === 'error') {
      p.reject(new Error(msg.error?.message || 'Worker error'));
    } else if (msg.type === 'result') {
      p.resolve(msg.vectors);
    }
  });

  embeddingWorker.on('error', (err) => {
    console.error('[SMART EMBEDDING WORKER] Error:', err.message);
    workerPromises.forEach(p => p.reject(new Error('Worker crashed')));
    workerPromises.clear();
    embeddingWorker = null;
  });

  embeddingWorker.on('exit', (code) => {
    if (code !== 0) {
      console.warn(`[SMART EMBEDDING WORKER] Exited with code ${code}`);
    }
    workerPromises.forEach(p => p.reject(new Error(`Worker exited with code ${code}`)));
    workerPromises.clear();
    embeddingWorker = null;
  });

  return embeddingWorker;
}

async function getEmbeddingVector(texts) {
  if (!texts || (Array.isArray(texts) && texts.length === 0)) return null;

  const worker = getEmbeddingWorker();
  const id = ++workerMsgId;
  const timeoutMs = Number(process.env.SMART_EMBEDDING_JOB_TIMEOUT_MS) || 120000;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      workerPromises.delete(id);
      reject(new Error('Embedding worker job timeout'));
    }, timeoutMs);

    workerPromises.set(id, {
      resolve: (res) => {
        clearTimeout(timeout);
        resolve(res);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      }
    });

    worker.postMessage({ type: 'embed', id, texts });
  });
}

import { monitorEventLoopDelay } from 'node:perf_hooks';

export async function prepareEmbeddings(
  articles,
  onProgress = null
) {
  const perfMonitor = monitorEventLoopDelay({ resolution: 10 });
  perfMonitor.enable();
  const startTime = Date.now();
  const entries = [];
  const seenKeys = new Set();
  let prepCounter = 0;

  for (const article of articles) {
    // If the article already has a valid vector attached, we don't need to re-embed.
    if (article._vec) continue;

    const text = buildEmbeddingText(article);
    const key = embeddingCacheKey(article);

    if (!seenKeys.has(key)) {
      seenKeys.add(key);

      entries.push({
        key,
        text
      });
    }

    prepCounter++;
    if (prepCounter % 50 === 0) {
      await new Promise(r => setImmediate(r));
    }
  }

  const missing = entries.filter(
    entry => !embeddingCache.has(entry.key)
  );

  const throttleMs = Number(process.env.SMART_PROGRESS_THROTTLE_MS) || 250;
  let lastProgress = 0;

  for (let start = 0; start < missing.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = missing.slice(start, start + EMBEDDING_BATCH_SIZE);

    const texts = batch.map(e => e.text);
    const vectors = await getEmbeddingVector(texts);

    if (vectors && vectors.length === batch.length) {
      for (let i = 0; i < batch.length; i++) {
        embeddingCache.set(batch[i].key, vectors[i]);
      }
    }

    // CRITICAL: Yield the event loop to prevent server lockup!
    await new Promise(r => setTimeout(r, 50));

    if (onProgress) {
      const now = Date.now();
      const isFinal = start + batch.length >= missing.length;
      if (isFinal || now - lastProgress > throttleMs) {
        lastProgress = now;
        onProgress({
          phase: 'embeddings',
          current: Math.min(start + batch.length, missing.length),
          total: missing.length
        });
      }
    }
  }

  for (const article of articles) {
    article._vec = embeddingCache.get(embeddingCacheKey(article)) || null;
  }

  if (embeddingCache.size > 5000) {
    const keys = Array.from(embeddingCache.keys()).slice(0, embeddingCache.size - 4000);
    for (const key of keys) {
      embeddingCache.delete(key);
    }
  }

  perfMonitor.disable();
  const maxDelay = Math.round(perfMonitor.max / 1e6); // nanoseconds to ms
  console.log(`[SMART PERFORMANCE] stage=embeddings durationMs=${Date.now() - startTime} maxEventLoopDelayMs=${maxDelay}`);
  console.log(`[SMART EMBEDDINGS] candidates=${articles.length} unique=${entries.length} hits=${entries.length - missing.length} misses=${missing.length} batches=${Math.ceil(missing.length / EMBEDDING_BATCH_SIZE)} durationMs=${Date.now() - startTime}`);
}

export function importEmbeddingCache(stored) {
  if (
    !stored ||
    typeof stored !== 'object'
  ) {
    return;
  }

  for (
    const [key, encoded]
    of Object.entries(stored)
  ) {
    if (
      typeof encoded !== 'string' ||
      embeddingCache.has(key)
    ) {
      continue;
    }

    try {
      const buffer =
        Buffer.from(
          encoded,
          'base64'
        );

      const vector =
        new Float32Array(
          buffer.buffer,
          buffer.byteOffset,
          buffer.length / 4
        );

      embeddingCache.set(
        key,
        new Float32Array(vector)
      );
    } catch {
      // Ignore corrupted cache entries.
    }
  }
}

export function exportEmbeddingCache() {
  const result = {};
  for (const [key, vector] of embeddingCache.entries()) {
    result[key] = Buffer.from(
      vector.buffer,
      vector.byteOffset,
      vector.byteLength
    ).toString('base64');
  }
  return result;
}

async function generateEmbeddingCacheJsonAsync() {
  let json = '{';
  let isFirst = true;
  let counter = 0;

  for (const [key, vector] of embeddingCache.entries()) {
    if (!isFirst) {
      json += ',';
    }
    isFirst = false;

    const base64 = Buffer.from(
      vector.buffer,
      vector.byteOffset,
      vector.byteLength
    ).toString('base64');

    json += `${JSON.stringify(key)}:"${base64}"`;

    counter++;
    if (counter % 50 === 0) {
      await new Promise(r => setImmediate(r));
    }
  }

  json += '}';
  return json;
}

export async function loadEmbeddings(db) {
  if (embeddingCache.size > 0) {
    return;
  }

  try {
    const stored = JSON.parse(
      await readFile(
        EMBEDDING_CACHE_FILE,
        'utf8'
      )
    );
    if (stored) {
      importEmbeddingCache(stored);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('[SMART] Failed to load embedding cache:', error.message);
    }
  }
}

export async function saveEmbeddings(db) {
  const temporaryPath =
    `${EMBEDDING_CACHE_FILE}.tmp-${process.pid}-${Date.now()}`;

  try {
    const jsonString = await generateEmbeddingCacheJsonAsync();
    await writeFile(
      temporaryPath,
      jsonString,
      'utf8'
    );
    await rename(
      temporaryPath,
      EMBEDDING_CACHE_FILE
    );
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    console.error('[SMART] Failed to save embedding cache:', error.message);
  }
}

function cosineSimilarity(
  left,
  right
) {
  if (
    !left ||
    !right ||
    left.length !== right.length
  ) {
    return 0;
  }

  let dot = 0;

  for (
    let index = 0;
    index < left.length;
    index++
  ) {
    dot += left[index] * right[index];
  }

  return dot;
}

function extractActionGroups(article) {
  const text = normalizeText(
    [
      article?.title,
      article?.content
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 1500)
  );

  const detected = new Set();

  for (
    const [groupName, group]
    of Object.entries(ACTION_GROUPS)
  ) {
    const phrases = [
      ...group.en,
      ...group.vi
    ];

    if (
      phrases.some(phrase =>
        containsNormalizedPhrase(
          text,
          phrase
        )
      )
    ) {
      detected.add(groupName);
    }
  }

  return detected;
}

const SPORTS_HEADLINE_FOCUS_PATTERNS = {
  match_prediction: [
    /\bdu doan\b/,
    /\bnhan dinh\b/,
    /\bsoi keo\b/,
    /\bty so\b/,
    /\bscore prediction\b/,
    /\bmatch prediction\b/,
    /\bbetting odds\b/
  ],
  player_availability: [
    /\bchua ra san\b/,
    /\bkhong ra san\b/,
    /\bkhong thi dau\b/,
    /\bvang mat\b/,
    /\bchan thuong\b/,
    /\btreo gio\b/,
    /\bhas not played\b/,
    /\bhasn t played\b/,
    /\bruled out\b/,
    /\bunused substitute\b/
  ],
  event_attendance: [
    /\bdu khan\b/,
    /\bchu tich fifa\b/,
    /\bfifa president\b/,
    /\bin attendance\b/
  ]
};

function extractSportsHeadlineFocus(article) {
  const title = normalizeText(
    article?.title || ''
  );

  const detected = new Set();

  for (
    const [focus, patterns]
    of Object.entries(
      SPORTS_HEADLINE_FOCUS_PATTERNS
    )
  ) {
    if (
      patterns.some(pattern =>
        pattern.test(title)
      )
    ) {
      detected.add(focus);
    }
  }

  return detected;
}

// Airline ticket-sale headlines often share nearly all of their vocabulary
// (Tet, sale dates, number of seats and reunion journeys) while describing
// separate commercial announcements. Keep the primary airline in the title as
// a hard event boundary so semantic similarity cannot merge competitors.
const AIRLINE_HEADLINE_PATTERNS = {
  vietjet: [
    /\bvietjet\b/
  ],
  vietnam_airlines: [
    /\bvietnam airlines\b/
  ],
  bamboo_airways: [
    /\bbamboo airways\b/
  ],
  vietravel_airlines: [
    /\bvietravel airlines\b/
  ],
  pacific_airlines: [
    /\bpacific airlines\b/
  ],
  vasco: [
    /\bvasco\b/
  ]
};

function extractHeadlineAirlines(article) {
  const title = normalizeText(
    article?.title || ''
  );
  const detected = new Set();

  for (
    const [airline, patterns]
    of Object.entries(
      AIRLINE_HEADLINE_PATTERNS
    )
  ) {
    if (
      patterns.some(pattern =>
        pattern.test(title)
      )
    ) {
      detected.add(airline);
    }
  }

  return detected;
}

function extractHeadlineNumbers(article) {
  const normalized =
    String(article?.title || '')
      .replace(/,/g, '');

  return Array.from(
    normalized.matchAll(
      /\b\d+(?:\.\d+)?\b/g
    )
  ).map(match => match[0]);
}

export function detectEventConflicts(
  articleA,
  articleB
) {
  const result = {
    hasHardConflict: false,
    hasSoftConflict: false,
    reasons: []
  };

  const timestampA =
    parsePublishedTimestamp(
      articleA?.pubDate
    );

  const timestampB =
    parsePublishedTimestamp(
      articleB?.pubDate
    );

  if (
    Number.isFinite(timestampA) &&
    Number.isFinite(timestampB)
  ) {
    const differenceHours =
      Math.abs(
        timestampA - timestampB
      ) /
      HOUR_MS;

    if (differenceHours > 72) {
      result.hasHardConflict = true;
      result.reasons.push(
        'Publication times are more than 72 hours apart'
      );
    } else if (differenceHours > 24) {
      result.hasSoftConflict = true;
      result.reasons.push(
        'Publication times are more than 24 hours apart'
      );
    }
  }

  // Explicit event dates check
  if (articleA?.eventDate && articleB?.eventDate && articleA.eventDate !== articleB.eventDate) {
    result.hasHardConflict = true;
    result.reasons.push('Conflicting explicit event dates');
  }

  const airlinesA =
    extractHeadlineAirlines(articleA);

  const airlinesB =
    extractHeadlineAirlines(articleB);

  if (
    airlinesA.size &&
    airlinesB.size &&
    ![...airlinesA].some(
      airline =>
        airlinesB.has(airline)
    )
  ) {
    result.hasHardConflict = true;
    result.reasons.push(
      `Different airline organizations: ${[
        ...airlinesA
      ].join(', ')} vs ${[
        ...airlinesB
      ].join(', ')}`
    );
  }

  const sportsFocusA =
    extractSportsHeadlineFocus(
      articleA
    );

  const sportsFocusB =
    extractSportsHeadlineFocus(
      articleB
    );

  if (
    sportsFocusA.size &&
    sportsFocusB.size &&
    ![...sportsFocusA].some(
      focus =>
        sportsFocusB.has(focus)
    )
  ) {
    result.hasHardConflict = true;
    result.reasons.push(
      `Different sports headline focus: ${[
        ...sportsFocusA
      ].join(', ')} vs ${[
        ...sportsFocusB
      ].join(', ')}`
    );
  }

  return result;
}

function countSharedValues(
  leftValues,
  rightValues
) {
  const rightSet =
    new Set(rightValues);

  let shared = 0;

  for (const value of leftValues) {
    if (rightSet.has(value)) {
      shared++;
    }
  }

  return shared;
}

function getEventEvidence(
  articleA,
  articleB
) {
  const languageA =
    articleA?.language ||
    detectArticleLanguage(
      articleA
    );

  const languageB =
    articleB?.language ||
    detectArticleLanguage(
      articleB
    );

  const crossLanguage =
    languageA !== 'unknown' &&
    languageB !== 'unknown' &&
    languageA !== languageB;

  const titleOverlap =
    tokenOverlapCount(
      articleA?.title,
      articleB?.title
    );

  const titleSimilarity =
    tokenSimilarity(
      articleA?.title,
      articleB?.title
    );

  const sharedNumbers =
    countSharedValues(
      extractHeadlineNumbers(
        articleA
      ),
      extractHeadlineNumbers(
        articleB
      )
    );

  const sharedActions =
    countSharedValues(
      extractActionGroups(
        articleA
      ),
      extractActionGroups(
        articleB
      )
    );

  let score = 0;

  if (titleOverlap >= 4) {
    score += 3;
  } else if (titleOverlap >= 3) {
    score += 2;
  } else if (titleOverlap >= 2) {
    score += 1;
  }

  if (titleSimilarity >= 0.45) {
    score += 2;
  } else if (
    titleSimilarity >= 0.30
  ) {
    score += 1;
  }

  if (sharedNumbers > 0) {
    score += 1;
  }

  if (sharedActions > 0) {
    score += 1;
  }

  return {
    score,
    crossLanguage,
    titleOverlap,
    titleSimilarity,
    sharedNumbers,
    sharedActions
  };
}

export function classifyE5Match(
  articleA,
  articleB,
  similarity
) {
  const languageA =
    articleA?.language ||
    detectArticleLanguage(
      articleA
    );

  const languageB =
    articleB?.language ||
    detectArticleLanguage(
      articleB
    );

  const crossLanguage =
    languageA !== 'unknown' &&
    languageB !== 'unknown' &&
    languageA !== languageB;

  const thresholds =
    crossLanguage
      ? SMART_NEWS_CLUSTER_CONFIG
        .thresholds
        .crossLanguage
      : SMART_NEWS_CLUSTER_CONFIG
        .thresholds
        .sameLanguage;

  if (
    similarity <
    thresholds.review
  ) {
    return {
      decision:
        MatchDecision.REJECT,
      conflicts: null,
      evidence: null
    };
  }

  const conflicts =
    detectEventConflicts(
      articleA,
      articleB
    );

  if (conflicts.hasHardConflict) {
    return {
      decision:
        MatchDecision.REJECT,
      conflicts,
      evidence: null
    };
  }

  const evidence =
    getEventEvidence(
      articleA,
      articleB
    );

  /*
   * Multilingual E5 is responsible for cross-language matching,
   * because translated headlines may share no literal tokens.
   *
   * Same-language pairs must also have concrete headline,
   * action or numeric evidence. This removes broad-topic pairs
   * that currently flood the REVIEW queue.
   */
  if (!crossLanguage) {
    const nearReviewBoundary =
      similarity <
      thresholds.review + 0.02;

    const insufficientEvidence =
      evidence.score < 2;

    const weakBoundaryEvidence =
      nearReviewBoundary &&
      evidence.score < 3;

    if (
      insufficientEvidence ||
      weakBoundaryEvidence
    ) {
      return {
        decision:
          MatchDecision.REJECT,
        conflicts,
        evidence
      };
    }
  }

  if (
    similarity >=
      thresholds.autoMerge &&
    !conflicts.hasSoftConflict
  ) {
    return {
      decision:
        MatchDecision.AUTO_MERGE,
      conflicts,
      evidence
    };
  }

  return {
    decision:
      MatchDecision.REVIEW,
    conflicts,
    evidence
  };
}

function pairKey(leftIndex, rightIndex) {
  return leftIndex < rightIndex
    ? `${leftIndex}|${rightIndex}`
    : `${rightIndex}|${leftIndex}`;
}

export function isPairWithinComparisonScope(
  articleA,
  articleB,
  now = Date.now()
) {
  const timestampA =
    parsePublishedTimestamp(
      articleA?.pubDate
    );

  const timestampB =
    parsePublishedTimestamp(
      articleB?.pubDate
    );

  if (
    !Number.isFinite(timestampA) ||
    !Number.isFinite(timestampB)
  ) {
    return false;
  }

  const normalWindowMs =
    SMART_NEWS_CLUSTER_CONFIG
      .comparisonWindowHours *
    HOUR_MS;

  if (
    Math.abs(
      timestampA - timestampB
    ) <= normalWindowMs
  ) {
    return true;
  }

  if (
    articleA?._activeClusterId &&
    articleA._activeClusterId ===
    articleB?._activeClusterId
  ) {
    return true;
  }

  const recentCutoff =
    now - normalWindowMs;

  const activeA =
    Number.isFinite(
      articleA?._activeClusterLatestAt
    ) &&
    articleA._activeClusterLatestAt >=
    recentCutoff;

  const activeB =
    Number.isFinite(
      articleB?._activeClusterLatestAt
    ) &&
    articleB._activeClusterLatestAt >=
    recentCutoff;

  if (
    activeA &&
    timestampB >= recentCutoff
  ) {
    return true;
  }

  if (
    activeB &&
    timestampA >= recentCutoff
  ) {
    return true;
  }

  return false;
}

function chooseMedoid(
  indices,
  pairSimilarities,
  nodes
) {
  let bestIndex = indices[0];
  let bestScore = -1;

  for (const index of indices) {
    let score = 0;

    for (
      const otherIndex
      of indices
    ) {
      if (index === otherIndex) {
        continue;
      }

      score +=
        pairSimilarities.get(
          pairKey(
            index,
            otherIndex
          )
        ) || 0;
    }

    const candidateId =
      nodes[index].id;

    const bestId =
      nodes[bestIndex].id;

    if (
      score > bestScore ||
      (
        score === bestScore &&
        candidateId.localeCompare(
          bestId
        ) < 0
      )
    ) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export { runIncrementalHnswClustering } from './smart-hnsw-clustering.js';

export async function deterministicGroups(
  articles,
  onProgress = null
) {
  const perfMonitor =
    monitorEventLoopDelay({
      resolution: 10
    });

  perfMonitor.enable();

  const startTime = Date.now();

  let lastYield = Date.now();

  const yieldIfNeeded =
    async force => {
      if (
        force ||
        Date.now() - lastYield > 15
      ) {
        await new Promise(
          resolve =>
            setImmediate(resolve)
        );

        lastYield = Date.now();
      }
    };

  const validArticles =
    articles.filter(
      article =>
        article.publicationTimeReliable !==
        false
    );

  const isolatedArticles =
    articles.filter(
      article =>
        article.publicationTimeReliable ===
        false
    );

  const nodes =
    validArticles.map(
      (article, index) => ({
        index,
        id: getArticleId(article),
        article
      })
    );

  const nodeCount =
    nodes.length;

  /*
   * topKCandidates now limits only uncertain REVIEW
   * relationships. AUTO_MERGE relationships are never
   * limited, so a large event may contain any number
   * of related articles.
   */
  const reviewLimit =
    Math.max(
      1,
      Number(
        SMART_NEWS_CLUSTER_CONFIG
          .topKCandidates
      ) || 20
    );

  /*
   * Union-find stores automatic connectivity using
   * O(number of articles) memory instead of retaining
   * millions of pair objects.
   */
  const parent =
    new Int32Array(nodeCount);

  const rank =
    new Uint8Array(nodeCount);

  for (
    let index = 0;
    index < nodeCount;
    index++
  ) {
    parent[index] = index;
  }

  const findRoot =
    index => {
      let root = index;

      while (
        parent[root] !== root
      ) {
        root = parent[root];
      }

      while (
        parent[index] !== index
      ) {
        const next =
          parent[index];

        parent[index] = root;
        index = next;
      }

      return root;
    };

  const unionNodes =
    (left, right) => {
      let leftRoot =
        findRoot(left);

      let rightRoot =
        findRoot(right);

      if (
        leftRoot === rightRoot
      ) {
        return false;
      }

      if (
        rank[leftRoot] <
        rank[rightRoot]
      ) {
        [
          leftRoot,
          rightRoot
        ] = [
            rightRoot,
            leftRoot
          ];
      }

      parent[rightRoot] =
        leftRoot;

      if (
        rank[leftRoot] ===
        rank[rightRoot]
      ) {
        rank[leftRoot]++;
      }

      return true;
    };

  const reviewCandidatesByNode =
    nodes.map(() => []);

  const compareReviewCandidates =
    (left, right) =>
      right.similarity -
      left.similarity ||
      nodes[left.target]
        .id
        .localeCompare(
          nodes[right.target].id
        );

  /*
   * Retain only the strongest uncertain links for each
   * article. This never removes AUTO_MERGE links.
   */
  const addReviewCandidate =
    (
      sourceIndex,
      targetIndex,
      similarity
    ) => {
      const list =
        reviewCandidatesByNode[
        sourceIndex
        ];

      const candidate = {
        target: targetIndex,
        similarity
      };

      if (
        list.length <
        reviewLimit
      ) {
        list.push(candidate);

        if (
          list.length ===
          reviewLimit
        ) {
          list.sort(
            compareReviewCandidates
          );
        }

        return;
      }

      const worst =
        list[
        list.length - 1
        ];

      if (
        compareReviewCandidates(
          candidate,
          worst
        ) < 0
      ) {
        list[
          list.length - 1
        ] = candidate;

        list.sort(
          compareReviewCandidates
        );
      }
    };

  const now = Date.now();

  let scopedPairCount = 0;
  let autoMergePairCount = 0;
  let reviewPairCount = 0;
  let rejectedPairCount = 0;

  /*
   * Compare pairs without storing every comparison.
   *
   * AUTO_MERGE:
   *   Apply immediately through union-find.
   *
   * REVIEW:
   *   Retain only top-K uncertain candidates.
   *
   * REJECT:
   *   Discard immediately.
   */
  for (
    let left = 0;
    left < nodeCount;
    left++
  ) {
    for (
      let right = left + 1;
      right < nodeCount;
      right++
    ) {
      if (
        !isPairWithinComparisonScope(
          nodes[left].article,
          nodes[right].article,
          now
        )
      ) {
        continue;
      }

      scopedPairCount++;

      const similarity =
        nodes[left].article._vec &&
          nodes[right].article._vec
          ? cosineSimilarity(
            nodes[left].article._vec,
            nodes[right].article._vec
          )
          : 0;

      const classification =
        classifyE5Match(
          nodes[left].article,
          nodes[right].article,
          similarity
        );

      if (
        classification.decision ===
        MatchDecision.AUTO_MERGE
      ) {
        unionNodes(left, right);

        autoMergePairCount++;
      } else if (
        classification.decision ===
        MatchDecision.REVIEW
      ) {
        addReviewCandidate(
          left,
          right,
          similarity
        );

        addReviewCandidate(
          right,
          left,
          similarity
        );

        reviewPairCount++;
      } else {
        rejectedPairCount++;
      }
    }

    await yieldIfNeeded();

    if (
      onProgress &&
      (
        left % 25 === 0 ||
        left === nodeCount - 1
      )
    ) {
      onProgress({
        phase: 'matching',
        current: left + 1,
        total: nodeCount
      });
    }
  }

  /*
   * Deduplicate retained uncertain relationships.
   * Maximum size is approximately articles × topK.
   */
  const selectedReviewPairs =
    new Map();

  for (
    let index = 0;
    index <
    reviewCandidatesByNode.length;
    index++
  ) {
    const candidates =
      reviewCandidatesByNode[
      index
      ];

    if (
      candidates.length <
      reviewLimit
    ) {
      candidates.sort(
        compareReviewCandidates
      );
    }

    for (
      const candidate
      of candidates
    ) {
      const key =
        pairKey(
          index,
          candidate.target
        );

      const existing =
        selectedReviewPairs.get(
          key
        );

      if (
        existing === undefined ||
        candidate.similarity >
        existing
      ) {
        selectedReviewPairs.set(
          key,
          candidate.similarity
        );
      }
    }

    await yieldIfNeeded();
  }

  /*
   * Convert union-find roots into initial automatic
   * components.
   */
  const componentsByRoot =
    new Map();

  for (
    let index = 0;
    index < nodeCount;
    index++
  ) {
    const root =
      findRoot(index);

    const component =
      componentsByRoot.get(root);

    if (component) {
      component.push(index);
    } else {
      componentsByRoot.set(
        root,
        [index]
      );
    }
  }

  const initialAutoComponents =
    [
      ...componentsByRoot.values()
    ];

  const finalAutoComponents = [];

  /*
   * Find the article with the strongest average
   * relationship to the rest of a component.
   *
   * Similarities are calculated when needed instead
   * of being stored for every global pair.
   */
  const chooseComponentMedoid =
    async indices => {
      if (
        indices.length <= 1
      ) {
        return indices[0];
      }

      const scores =
        new Float64Array(
          indices.length
        );

      let comparisons = 0;

      for (
        let left = 0;
        left < indices.length;
        left++
      ) {
        for (
          let right = left + 1;
          right < indices.length;
          right++
        ) {
          const leftIndex =
            indices[left];

          const rightIndex =
            indices[right];

          const similarity =
            nodes[leftIndex]
              .article
              ._vec &&
              nodes[rightIndex]
                .article
                ._vec
              ? cosineSimilarity(
                nodes[leftIndex]
                  .article
                  ._vec,
                nodes[rightIndex]
                  .article
                  ._vec
              )
              : 0;

          scores[left] +=
            similarity;

          scores[right] +=
            similarity;

          comparisons++;

          if (
            comparisons % 2000 ===
            0
          ) {
            await yieldIfNeeded(
              true
            );
          }
        }
      }

      let bestPosition = 0;

      for (
        let position = 1;
        position <
        indices.length;
        position++
      ) {
        const candidateId =
          nodes[
            indices[position]
          ].id;

        const bestId =
          nodes[
            indices[bestPosition]
          ].id;

        if (
          scores[position] >
          scores[bestPosition] ||
          (
            scores[position] ===
            scores[bestPosition] &&
            candidateId
              .localeCompare(
                bestId
              ) < 0
          )
        ) {
          bestPosition =
            position;
        }
      }

      return indices[
        bestPosition
      ];
    };

  /*
   * Rebuild connectivity only inside a component when
   * transitive chaining needs to be split. It uses
   * temporary O(component size) memory.
   */
  const partitionByDirectAutoLinks =
    async indices => {
      if (
        indices.length <= 1
      ) {
        return [indices];
      }

      const localParent =
        new Int32Array(
          indices.length
        );

      const localRank =
        new Uint8Array(
          indices.length
        );

      for (
        let index = 0;
        index < indices.length;
        index++
      ) {
        localParent[index] =
          index;
      }

      const localFind =
        index => {
          let root = index;

          while (
            localParent[root] !==
            root
          ) {
            root =
              localParent[root];
          }

          while (
            localParent[index] !==
            index
          ) {
            const next =
              localParent[index];

            localParent[index] =
              root;

            index = next;
          }

          return root;
        };

      const localUnion =
        (left, right) => {
          let leftRoot =
            localFind(left);

          let rightRoot =
            localFind(right);

          if (
            leftRoot === rightRoot
          ) {
            return;
          }

          if (
            localRank[leftRoot] <
            localRank[rightRoot]
          ) {
            [
              leftRoot,
              rightRoot
            ] = [
                rightRoot,
                leftRoot
              ];
          }

          localParent[rightRoot] =
            leftRoot;

          if (
            localRank[leftRoot] ===
            localRank[rightRoot]
          ) {
            localRank[leftRoot]++;
          }
        };

      let comparisons = 0;

      for (
        let left = 0;
        left < indices.length;
        left++
      ) {
        for (
          let right = left + 1;
          right < indices.length;
          right++
        ) {
          const leftIndex =
            indices[left];

          const rightIndex =
            indices[right];

          const similarity =
            nodes[leftIndex]
              .article
              ._vec &&
              nodes[rightIndex]
                .article
                ._vec
              ? cosineSimilarity(
                nodes[leftIndex]
                  .article
                  ._vec,
                nodes[rightIndex]
                  .article
                  ._vec
              )
              : 0;

          const classification =
            classifyE5Match(
              nodes[leftIndex]
                .article,
              nodes[rightIndex]
                .article,
              similarity
            );

          if (
            classification
              .decision ===
            MatchDecision
              .AUTO_MERGE
          ) {
            localUnion(
              left,
              right
            );
          }

          comparisons++;

          if (
            comparisons % 2000 ===
            0
          ) {
            await yieldIfNeeded(
              true
            );
          }
        }
      }

      const groups =
        new Map();

      for (
        let position = 0;
        position <
        indices.length;
        position++
      ) {
        const root =
          localFind(position);

        const group =
          groups.get(root);

        if (group) {
          group.push(
            indices[position]
          );
        } else {
          groups.set(
            root,
            [indices[position]]
          );
        }
      }

      return [
        ...groups.values()
      ];
    };

  /*
   * Prevent transitive chains from combining loosely
   * related events. Every article in an accepted
   * component must directly AUTO_MERGE with its medoid.
   */
  const splitComponent =
    async component => {
      await yieldIfNeeded();

      if (!component.length) {
        return;
      }

      if (
        component.length === 1
      ) {
        finalAutoComponents.push(
          component
        );

        return;
      }

      const medoid =
        await chooseComponentMedoid(
          component
        );

      const approved = [medoid];
      const remaining = [];

      for (
        const index
        of component
      ) {
        if (index === medoid) {
          continue;
        }

        const similarity =
          nodes[medoid]
            .article
            ._vec &&
            nodes[index]
              .article
              ._vec
            ? cosineSimilarity(
              nodes[medoid]
                .article
                ._vec,
              nodes[index]
                .article
                ._vec
            )
            : 0;

        const classification =
          classifyE5Match(
            nodes[medoid].article,
            nodes[index].article,
            similarity
          );

        if (
          classification.decision ===
          MatchDecision.AUTO_MERGE
        ) {
          approved.push(index);
        } else {
          remaining.push(index);
        }

        await yieldIfNeeded();
      }

      finalAutoComponents.push(
        approved
      );

      if (!remaining.length) {
        return;
      }

      const remainingComponents =
        await partitionByDirectAutoLinks(
          remaining
        );

      for (
        const subcomponent
        of remainingComponents
      ) {
        await splitComponent(
          subcomponent
        );
      }
    };

  for (
    const component
    of initialAutoComponents
  ) {
    await splitComponent(
      component
    );
  }

  const nodeToAutoCluster =
    new Map();

  finalAutoComponents.forEach(
    (
      component,
      clusterIndex
    ) => {
      for (
        const nodeIndex
        of component
      ) {
        nodeToAutoCluster.set(
          nodeIndex,
          clusterIndex
        );
      }
    }
  );

  /*
   * Build the uncertain cluster graph using only the
   * bounded REVIEW candidates.
   */
  const reviewAdjacency =
    finalAutoComponents.map(
      () => new Set()
    );

  for (
    const key
    of selectedReviewPairs.keys()
  ) {
    const [
      leftString,
      rightString
    ] = key.split('|');

    const left =
      Number(leftString);

    const right =
      Number(rightString);

    const leftCluster =
      nodeToAutoCluster.get(
        left
      );

    const rightCluster =
      nodeToAutoCluster.get(
        right
      );

    if (
      leftCluster === undefined ||
      rightCluster === undefined ||
      leftCluster === rightCluster
    ) {
      continue;
    }

    reviewAdjacency[
      leftCluster
    ].add(rightCluster);

    reviewAdjacency[
      rightCluster
    ].add(leftCluster);
  }

  const reviewVisited =
    new Set();

  const ambiguousAutoClusterIndexes =
    new Set();

  const ambiguousGroups = [];

  for (
    let clusterIndex = 0;
    clusterIndex <
    finalAutoComponents.length;
    clusterIndex++
  ) {
    if (
      reviewVisited.has(
        clusterIndex
      ) ||
      !reviewAdjacency[
        clusterIndex
      ].size
    ) {
      continue;
    }

    const componentClusters = [];
    const queue = [clusterIndex];

    let queueIndex = 0;

    reviewVisited.add(
      clusterIndex
    );

    while (
      queueIndex < queue.length
    ) {
      const current =
        queue[queueIndex++];

      componentClusters.push(
        current
      );

      ambiguousAutoClusterIndexes
        .add(current);

      for (
        const neighbor
        of reviewAdjacency[
        current
        ]
      ) {
        if (
          !reviewVisited.has(
            neighbor
          )
        ) {
          reviewVisited.add(
            neighbor
          );

          queue.push(neighbor);
        }
      }
    }

    const groupArticles =
      componentClusters.flatMap(
        current =>
          finalAutoComponents[
            current
          ].map(
            nodeIndex =>
              nodes[nodeIndex]
                .article
          )
      );

    ambiguousGroups.push({
      id:
        `review_${stableId(
          groupArticles
            .map(getArticleId)
            .sort()
            .join('|')
        )}`,

      articles:
        groupArticles
    });

    await yieldIfNeeded();
  }

  const autoMergedClusters = [];

  finalAutoComponents.forEach(
    (
      component,
      clusterIndex
    ) => {
      if (
        ambiguousAutoClusterIndexes
          .has(clusterIndex)
      ) {
        return;
      }

      const clusterArticles =
        component.map(
          nodeIndex =>
            nodes[nodeIndex]
              .article
        );

      autoMergedClusters.push({
        id:
          createGroupId(
            clusterArticles
          ),

        articles:
          clusterArticles,

        earliestDate:
          Math.min(
            ...clusterArticles.map(
              article =>
                safeDate(
                  article.pubDate
                )
            )
          ),

        latestDate:
          Math.max(
            ...clusterArticles.map(
              article =>
                safeDate(
                  article.pubDate
                )
            )
          )
      });
    }
  );

  for (
    const article
    of isolatedArticles
  ) {
    autoMergedClusters.push({
      id:
        createGroupId([article]),

      articles: [article],

      earliestDate:
        safeDate(
          article.pubDate
        ),

      latestDate:
        safeDate(
          article.pubDate
        )
    });
  }

  perfMonitor.disable();

  const durationMs =
    Date.now() - startTime;

  const maxDelay =
    Math.round(
      perfMonitor.max / 1e6
    );

  console.log(
    `[SMART MATCHING] nodes=${nodeCount} ` +
    `scopedPairs=${scopedPairCount} ` +
    `autoMergePairs=${autoMergePairCount} ` +
    `reviewPairs=${reviewPairCount} ` +
    `retainedReviewPairs=${selectedReviewPairs.size} ` +
    `rejectedPairs=${rejectedPairCount} ` +
    `autoComponents=${finalAutoComponents.length} ` +
    `ambiguousGroups=${ambiguousGroups.length}`
  );

  console.log(
    `[SMART PERFORMANCE] stage=matching durationMs=${durationMs} maxEventLoopDelayMs=${maxDelay}`
  );

  return {
    autoMergedClusters,
    ambiguousGroups
  };
}
function isPaywalledSource(article) {
  const link = String(
    article?.link ||
    article?.url ||
    ''
  ).toLowerCase();

  const feed = String(
    article?.feedTitle ||
    article?.source ||
    ''
  ).toLowerCase();

  return /(?:barrons\.com|barron['’s]|wsj\.com|wall street journal|bloomberg\.com|ft\.com|financial times|thetimes\.co\.uk|economist\.com)/i.test(
    `${link} ${feed}`
  );
}

function chooseRepresentative(articles) {
  return [...articles].sort(
    (left, right) => {
      const leftPaywalled =
        isPaywalledSource(left);

      const rightPaywalled =
        isPaywalledSource(right);

      if (
        leftPaywalled !==
        rightPaywalled
      ) {
        return leftPaywalled
          ? 1
          : -1;
      }

      if (
        left.smartCategory ===
        'tech'
      ) {
        const leftEnglish =
          isEnglishArticle(left);

        const rightEnglish =
          isEnglishArticle(right);

        if (
          leftEnglish !==
          rightEnglish
        ) {
          return rightEnglish
            ? 1
            : -1;
        }
      }

      const weightDifference =
        Number(
          right.sourceWeight || 1
        ) -
        Number(
          left.sourceWeight || 1
        );

      if (weightDifference) {
        return weightDifference;
      }

      const reliableDifference =
        Number(
          right.publicationTimeReliable !==
          false
        ) -
        Number(
          left.publicationTimeReliable !==
          false
        );

      if (reliableDifference) {
        return reliableDifference;
      }

      const contentDifference =
        Math.min(
          String(
            right.content || ''
          ).length,
          900
        ) -
        Math.min(
          String(
            left.content || ''
          ).length,
          900
        );

      if (contentDifference) {
        return contentDifference;
      }

      const imageDifference =
        Number(Boolean(right.image)) -
        Number(Boolean(left.image));

      if (imageDifference) {
        return imageDifference;
      }

      return (
        safeDate(right.pubDate) -
        safeDate(left.pubDate)
      );
    }
  )[0];
}

export function calculateHotness(articles) {
  const reliableArticles = articles.filter(
    article => article.publicationTimeReliable !== false
  );

  if (!reliableArticles.length) {
    return 1.0;
  }

  const now = Date.now();

  const latestPublishedAt = Math.max(
    ...reliableArticles.map(article =>
      safeDate(article.pubDate)
    )
  );

  const latestCoverageAgeHours = Math.max(
    0,
    (now - latestPublishedAt) / HOUR_MS
  );

  const allSourceIds = new Set(
    articles
      .map(canonicalSourceIdentity)
      .filter(Boolean)
  );

  const sourceIdsLast2Hours = new Set(
    reliableArticles
      .filter(
        article =>
          now - safeDate(article.pubDate) <=
          2 * HOUR_MS
      )
      .map(canonicalSourceIdentity)
      .filter(Boolean)
  );

  const sourceIdsLast24Hours = new Set(
    reliableArticles
      .filter(
        article =>
          now - safeDate(article.pubDate) <=
          24 * HOUR_MS
      )
      .map(canonicalSourceIdentity)
      .filter(Boolean)
  );

  const sourceCount = allSourceIds.size;
  const sourceCountLast2Hours =
    sourceIdsLast2Hours.size;
  const sourceCountLast24Hours =
    sourceIdsLast24Hours.size;

  const averageAuthority =
    articles.reduce(
      (sum, article) =>
        sum +
        Number(article.sourceWeight || 1),
      0
    ) / Math.max(1, articles.length);

  /*
   * Total independent coverage.
   *
   * Approximate behavior:
   * 1 source  -> 1.16 points
   * 2 sources -> 1.83 points
   * 3 sources -> 2.32 points
   * 5 sources -> 3.00 points
   * 10 sources -> 4.00 points
   */
  const coverageScore =
    Math.min(
      1,
      Math.log2(1 + sourceCount) /
      Math.log2(11)
    ) * 4.0;

  /*
   * Immediate breaking-news velocity.
   *
   * 1 recent source -> 0.4
   * 2 recent sources -> 0.8
   * 3 recent sources -> 1.2
   * 5 recent sources -> 2.0
   */
  const breakingVelocityScore =
    Math.min(
      1,
      sourceCountLast2Hours / 5
    ) * 2.0;

  /*
   * Sustained activity for stories that remain active.
   *
   * 5 recent sources -> 0.5
   * 10 recent sources -> 1.0
   */
  const sustainedCoverageScore =
    Math.min(
      1,
      sourceCountLast24Hours / 10
    ) * 1.0;

  /*
   * Freshness of the newest coverage, not the start of the event.
   *
   * Half-life is approximately 8.3 hours.
   */
  const latestCoverageScore =
    Math.exp(
      -latestCoverageAgeHours / 12
    ) * 2.0;

  const authorityScore =
    Math.min(
      1,
      averageAuthority / 1.12
    ) * 1.0;

  let hotness =
    coverageScore +
    breakingVelocityScore +
    sustainedCoverageScore +
    latestCoverageScore +
    authorityScore;

  /*
   * A one-source story may be new, but it has not yet been
   * independently confirmed as widely important.
   */
  if (sourceCount === 1) {
    hotness = Math.min(
      hotness,
      latestCoverageAgeHours <= 1
        ? 4.2
        : 3.7
    );
  }

  return (
    Math.round(
      Math.max(
        1,
        Math.min(10, hotness)
      ) * 10
    ) / 10
  );
}

export function getHotnessLabel(cluster) {
  const sourceCount =
    Number(cluster.sourceCount || 1);

  const hotness =
    Number(cluster.hotness || 1);

  if (
    sourceCount >= 4 &&
    hotness >= 7.5
  ) {
    return 'Breaking';
  }

  if (
    sourceCount >= 6 &&
    hotness >= 6.5
  ) {
    return 'Widely reported';
  }

  if (hotness >= 5.5) {
    return 'Hot';
  }

  return '';
}

export function isGenuinelyRelated(
  article,
  representative,
  isValidatedCluster = false
) {
  if (
    !article ||
    !representative
  ) {
    return false;
  }

  if (
    article.link &&
    article.link ===
    representative.link
  ) {
    return false;
  }

  const conflicts =
    detectEventConflicts(
      article,
      representative
    );

  if (conflicts.hasHardConflict) {
    return false;
  }

  const vectorSimilarity =
    article._vec &&
      representative._vec
      ? cosineSimilarity(
        article._vec,
        representative._vec
      )
      : null;

  const lexicalScore =
    tokenSimilarity(
      article.title,
      representative.title
    );

  const overlap =
    tokenOverlapCount(
      article.title,
      representative.title
    );

  const sameSource =
    canonicalSourceIdentity(article) ===
    canonicalSourceIdentity(
      representative
    );

  if (isValidatedCluster) {
    if (vectorSimilarity !== null) {
      return (
        vectorSimilarity >= 0.82
      );
    }

    return (
      overlap >= 2 &&
      lexicalScore >= 0.30
    );
  }

  if (sameSource) {
    if (vectorSimilarity !== null) {
      return (
        vectorSimilarity >= 0.92 &&
        overlap >= 4 &&
        lexicalScore >= 0.35
      );
    }

    return (
      overlap >= 4 &&
      lexicalScore >= 0.48
    );
  }

  if (vectorSimilarity !== null) {
    if (
      vectorSimilarity >= 0.93 &&
      (
        overlap >= 2 ||
        lexicalScore >= 0.20
      )
    ) {
      return true;
    }

    if (
      vectorSimilarity >= 0.89 &&
      overlap >= 3 &&
      lexicalScore >= 0.26
    ) {
      return true;
    }

    if (
      vectorSimilarity >= 0.85 &&
      overlap >= 4 &&
      lexicalScore >= 0.34
    ) {
      return true;
    }

    return false;
  }

  return (
    overlap >= 4 &&
    lexicalScore >= 0.34
  );
}

function isGoogleNewsWrapperUrl(value) {
  try {
    const url = new URL(
      String(value || '')
    );

    return (
      url.hostname ===
        'news.google.com' &&
      /\/(?:rss\/)?articles\//i.test(
        url.pathname
      )
    );
  } catch {
    return false;
  }
}

function headlineFingerprint(title) {
  return normalizeText(
    cleanTitleForScoring(
      title || ''
    )
  );
}

export function dedupeGoogleNewsWrappers(
  articles
) {
  const input =
    Array.isArray(articles)
      ? articles
      : [];

  const directHeadlines =
    new Set(
      input
        .filter(article =>
          article?.link &&
          !isGoogleNewsWrapperUrl(
            article.link
          )
        )
        .map(article =>
          headlineFingerprint(
            article.title
          )
        )
        .filter(Boolean)
    );

  return input.filter(article => {
    if (
      !isGoogleNewsWrapperUrl(
        article?.link
      )
    ) {
      return true;
    }

    const fingerprint =
      headlineFingerprint(
        article?.title
      );

    return (
      !fingerprint ||
      !directHeadlines.has(
        fingerprint
      )
    );
  });
}

export function buildCluster(
  articles,
  metadata = null
) {
  const uniqueArticles = [];
  const links = new Set();

  for (
    const article
    of dedupeGoogleNewsWrappers(
      articles
    )
  ) {
    if (
      !article?.link ||
      links.has(article.link)
    ) {
      continue;
    }

    links.add(article.link);
    uniqueArticles.push(article);
  }

  if (!uniqueArticles.length) {
    return null;
  }

  uniqueArticles.sort(
    (left, right) =>
      safeDate(right.pubDate) -
      safeDate(left.pubDate)
  );

  const representative =
    chooseRepresentative(
      uniqueArticles
    );

  const validated =
    metadata?.validated === true;

  let finalArticles;

  if (validated) {
    finalArticles = [
      representative,
      ...uniqueArticles.filter(
        article =>
          article.link !==
          representative.link
      )
    ];
  } else {
    finalArticles = [
      representative,
      ...uniqueArticles.filter(
        article =>
          article.link !==
          representative.link &&
          isGenuinelyRelated(
            article,
            representative,
            false
          )
      )
    ];
  }

  let category =
    VALID_SMART_CATEGORIES.has(
      metadata?.category
    )
      ? metadata.category
      : representative.smartCategory;

  if (
    category === 'tech' &&
    isInvestingComSource(
      representative
    )
  ) {
    category =
      isVietnameseArticle(
        representative
      )
        ? 'finance_vietnam'
        : 'finance_global';
  }

  const sourceNames =
    [
      ...new Set(
        finalArticles
          .map(
            article =>
              article.feedTitle
          )
          .filter(Boolean)
      )
    ];

  const clusterId =
    stableId(
      finalArticles
        .map(
          article =>
            article.link
        )
        .sort()
        .join('|')
    );

  return {
    ...representative,

    title:
      representative.title,

    content:
      representative.content,

    smartCategory: category,
    feedCategory: category,

    isCluster: true,

    clusterId,

    clusterCount:
      finalArticles.length,

    sourceCount:
      sourceNames.length,

    sources: sourceNames,

    hotness:
      calculateHotness(
        finalArticles
      ),

    aiClustered:
      metadata?.verification
        ?.method ===
      'ai_fallback' &&
      finalArticles.length > 1,

    verification:
      metadata?.verification,

    relatedArticles:
      finalArticles
        .filter(
          article =>
            article.link !==
            representative.link
        )
        .sort(
          (left, right) =>
            Number(
              right.sourceWeight ||
              1
            ) -
            Number(
              left.sourceWeight ||
              1
            ) ||
            safeDate(
              right.pubDate
            ) -
            safeDate(
              left.pubDate
            )
        )
        .map(article => ({
          title: article.title,
          link: article.link,
          pubDate: article.pubDate,
          publicationTimeReliable:
            article.publicationTimeReliable,
          feedTitle:
            article.feedTitle,
          feedIcon:
            article.feedIcon,
          feedUrl:
            article.feedUrl,
          image: article.image,
          sourceWeight:
            article.sourceWeight,
          region: article.region,
          language:
            article.language,
          domain: article.domain,
          smartCategory:
            article.smartCategory,
          feedCategory:
            article.feedCategory,
          content:
            String(
              article.content || ''
            ).slice(0, 900)
        }))
  };
}

export function cleanStoredCluster(cluster) {
  if (
    !cluster ||
    typeof cluster !== 'object'
  ) {
    return cluster;
  }

  if (
    !Array.isArray(
      cluster.relatedArticles
    ) ||
    !cluster.relatedArticles.length
  ) {
    return cluster;
  }

  const cleanRelated =
    cluster.relatedArticles.filter(
      related => {
        if (
          !related?.link ||
          related.link ===
          cluster.link
        ) {
          return false;
        }

        // Verification records describe how the cluster was accepted, but a
        // newer deterministic hard-conflict rule must still be able to repair
        // an already-saved cluster immediately after deployment.
        if (
          detectEventConflicts(
            related,
            cluster
          ).hasHardConflict
        ) {
          return false;
        }

        if (cluster.verification) {
          return true;
        }

        return isGenuinelyRelated(
          related,
          cluster,
          Boolean(
            cluster.aiClustered
          )
        );
      }
    );

  if (
    cleanRelated.length ===
    cluster.relatedArticles.length
  ) {
    return cluster;
  }

  const sources =
    [
      ...new Set(
        [
          cluster.feedTitle,
          ...cleanRelated.map(
            article =>
              article.feedTitle
          )
        ].filter(Boolean)
      )
    ];

  return {
    ...cluster,
    relatedArticles:
      cleanRelated,
    clusterCount:
      cleanRelated.length + 1,
    sourceCount:
      sources.length,
    sources
  };
}

function buildVerificationPrompt(articles) {
  const input =
    articles.map(article => ({
      id: getArticleId(article),
      title: article.title,
      description:
        String(
          article.content || ''
        ).slice(0, 600),
      source:
        article.feedTitle,
      domain:
        article.domain,
      language:
        article.language ||
        detectArticleLanguage(
          article
        ),
      category:
        article.smartCategory,
      publishedAt:
        article.pubDate
    }));

  return [
    'You are a precise multilingual exact-event clustering verifier.',
    '',
    'Partition the supplied articles into exact-event clusters.',
    '',
    'Group articles together only when they describe the same specific real-world occurrence.',
    '',
    'Do not group articles merely because they share:',
    '- the same broad topic;',
    '- the same person;',
    '- the same company;',
    '- the same city or country;',
    '- the same crime type;',
    '- the same market or industry;',
    '- the same product family;',
    '- the same tournament;',
    '- the same category;',
    '- the same ongoing story.',
    '',
    'The central action and the relevant people, organizations, object, place, and event time or event stage must be compatible.',
    '',
    'Different stages may represent separate events, including investigation, arrest, charge, trial, conviction, sentencing, appeal, and a sentence being upheld or overturned.',
    '',
    'For sports, predictions and previews may be grouped only when they concern the same fixture and the same leg or stage.',
    'Keep player availability or selection stories, VIP attendance, tournament administration, match reports, and post-match reactions separate when their primary news peg differs.',
    'A secondary reference to the same team, tournament, or match does not make two articles the same event.',
    'Every article in a cluster must match the central event directly; do not create a cluster through a chain of loosely related articles.',
    '',
    'Different languages or categories do not by themselves mean that articles describe different events.',
    '',
    'Do not invent facts.',
    'Do not rewrite headlines.',
    'Do not generate summaries.',
    'Do not assign Importance.',
    'Do not modify article IDs.',
    '',
    'Every input article ID must appear exactly once.',
    'Do not omit IDs.',
    'Do not duplicate IDs.',
    'Do not invent IDs.',
    '',
    'When the metadata is insufficient for a safe partition, keep questionable articles separate and set uncertain to true.',
    '',
    'Return valid JSON matching the supplied schema only.',
    '',
    JSON.stringify(
      { articles: input }
    )
  ].join('\n');
}

function parsePartitionResponse(
  raw,
  providerName
) {
  const text = String(raw || '')
    .replace(
      /^```(?:json)?\s*/i,
      ''
    )
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(text);
  } catch {
    const start =
      text.indexOf('{');

    const end =
      text.lastIndexOf('}');

    if (
      start < 0 ||
      end <= start
    ) {
      throw new Error(
        `${providerName} returned invalid JSON`
      );
    }

    try {
      return JSON.parse(
        text.slice(
          start,
          end + 1
        )
      );
    } catch {
      throw new Error(
        `${providerName} returned invalid JSON`
      );
    }
  }
}

function validatePartitionResult(
  result,
  articles
) {
  if (
    !result ||
    !Array.isArray(result.clusters) ||
    typeof result.uncertain !==
    'boolean'
  ) {
    return {
      valid: false,
      reason: 'invalid_schema'
    };
  }

  if (!result.clusters.length) {
    return {
      valid: false,
      reason: 'empty_cluster_array'
    };
  }

  const requestedIds =
    articles.map(getArticleId);

  const requestedSet =
    new Set(requestedIds);

  const returnedIds = [];

  for (const cluster of result.clusters) {
    if (
      !cluster ||
      !Array.isArray(
        cluster.articleIds
      ) ||
      !cluster.articleIds.length
    ) {
      return {
        valid: false,
        reason: 'empty_cluster'
      };
    }

    returnedIds.push(
      ...cluster.articleIds
    );
  }

  if (
    returnedIds.length !==
    requestedIds.length
  ) {
    return {
      valid: false,
      reason: 'wrong_article_count'
    };
  }

  if (
    new Set(returnedIds).size !==
    returnedIds.length
  ) {
    return {
      valid: false,
      reason: 'duplicate_article_ids'
    };
  }

  if (
    returnedIds.some(
      id =>
        !requestedSet.has(id)
    )
  ) {
    return {
      valid: false,
      reason: 'unknown_article_ids'
    };
  }

  if (
    requestedIds.some(
      id =>
        !returnedIds.includes(id)
    )
  ) {
    return {
      valid: false,
      reason: 'missing_article_ids'
    };
  }

  return {
    valid: true,
    reason: null
  };
}

function pairEligibleForVerifiedCluster(
  left,
  right
) {
  const conflicts =
    detectEventConflicts(
      left,
      right
    );

  if (conflicts.hasHardConflict) {
    return false;
  }

  if (
    left._vec &&
    right._vec
  ) {
    const similarity =
      cosineSimilarity(
        left._vec,
        right._vec
      );

    const classification =
      classifyE5Match(
        left,
        right,
        similarity
      );

    return (
      classification.decision !==
      MatchDecision.REJECT
    );
  }

  return (
    tokenOverlapCount(
      left.title,
      right.title
    ) >= 2 &&
    tokenSimilarity(
      left.title,
      right.title
    ) >= 0.30
  );
}

function postValidatePartition(
  result,
  articles
) {
  const articleById =
    new Map(
      articles.map(article => [
        getArticleId(article),
        article
      ])
    );

  for (const cluster of result.clusters) {
    const clusterArticles =
      cluster.articleIds.map(
        id => articleById.get(id)
      );

    if (
      clusterArticles.some(
        article => !article
      )
    ) {
      return false;
    }

    if (
      clusterArticles.length <= 1
    ) {
      continue;
    }

    for (
      let left = 0;
      left <
      clusterArticles.length;
      left++
    ) {
      for (
        let right = left + 1;
        right <
        clusterArticles.length;
        right++
      ) {
        const conflicts =
          detectEventConflicts(
            clusterArticles[left],
            clusterArticles[right]
          );

        if (
          conflicts.hasHardConflict
        ) {
          return false;
        }
      }
    }

    const visited =
      new Set([0]);

    const queue = [0];

    while (queue.length) {
      const current =
        queue.shift();

      for (
        let candidate = 0;
        candidate <
        clusterArticles.length;
        candidate++
      ) {
        if (
          visited.has(candidate)
        ) {
          continue;
        }

        if (
          pairEligibleForVerifiedCluster(
            clusterArticles[current],
            clusterArticles[candidate]
          )
        ) {
          visited.add(candidate);
          queue.push(candidate);
        }
      }
    }

    if (
      visited.size !==
      clusterArticles.length
    ) {
      return false;
    }
  }

  return true;
}

function sanitizeProviderErrorMessage(
  message
) {
  return String(
    message ||
    'Unknown provider error'
  )
    .replace(
      /([?&]key=)[^&\s]+/gi,
      '$1[REDACTED]'
    )
    .replace(
      /Bearer\s+[A-Za-z0-9._~-]+/gi,
      'Bearer [REDACTED]'
    )
    .replace(
      /x-goog-api-key\s*[:=]\s*[^\s,}]+/gi,
      'x-goog-api-key: [REDACTED]'
    )
    .split('\n')[0]
    .slice(0, 300);
}

function normalizeProviderError(error) {
  const status =
    Number(
      error?.status ||
      error?.httpStatus
    ) || null;

  return {
    code:
      error?.code ||
      (
        status
          ? `HTTP_${status}`
          : 'UNKNOWN_ERROR'
      ),

    httpStatus: status,

    message:
      sanitizeProviderErrorMessage(
        error?.message ||
        error
      )
  };
}

function isTransientProviderError(
  error
) {
  const status =
    Number(
      error?.status ||
      error?.httpStatus
    );

  return (
    error?.name === 'AbortError' ||
    error?.code === 'ETIMEDOUT' ||
    error?.code === 'ECONNRESET' ||
    error?.code === 'EAI_AGAIN' ||
    [429, 500, 502, 503, 504]
      .includes(status)
  );
}

function providerEnabled(
  provider,
  hasGeminiKey
) {
  const onlyLocal =
    process.env.SMART_ONLY_LOCAL ===
    'true';

  const geminiEnabled =
    process.env.USE_GEMINI !==
    'false' &&
    !onlyLocal;

  const localEnabled =
    process.env
      .SMART_LOCAL_AI_ENABLED !==
    'false';

  if (
    provider.type === 'gemini'
  ) {
    return (
      geminiEnabled &&
      hasGeminiKey
    );
  }

  if (
    provider.type === 'ollama'
  ) {
    return localEnabled;
  }

  return false;
}

let preferredClusteringModel = null;
export function setClusteringModel(model) {
  preferredClusteringModel = model;
}

function getEnabledVerificationProviders(
  hasGeminiKey
) {
  const providers = SMART_NEWS_AI_CONFIG
    .providers
    .filter(provider =>
      providerEnabled(
        provider,
        hasGeminiKey
      )
    )
    .sort(
      (left, right) =>
        left.priority -
        right.priority
    );

  if (preferredClusteringModel) {
    const preferredIdx = providers.findIndex(p =>
      p.model === preferredClusteringModel || p.id === preferredClusteringModel
    );
    if (preferredIdx > 0) {
      const preferred = providers.splice(preferredIdx, 1)[0];
      providers.unshift(preferred);
    }
  }

  return providers;
}

async function getProviderHealth(db) {
  try {
    return (
      await db.get(
        'smartAiProviderHealth',
        {
          type: 'json'
        }
      )
    ) || {};
  } catch {
    return {};
  }
}

async function updateProviderHealth(
  db,
  provider,
  updater
) {
  providerHealthWriteChain =
    providerHealthWriteChain.then(
      async () => {
        const state =
          await getProviderHealth(db);

        const existing =
          state[provider.id] || {
            providerId:
              provider.id,
            type:
              provider.type,
            model:
              provider.model,
            enabled: true,
            status: 'healthy',
            lastAttemptAt: null,
            lastSuccessAt: null,
            lastErrorAt: null,
            lastErrorCode: null,
            lastErrorMessage:
              null,
            consecutiveFailures:
              0
          };

        const next =
          typeof updater ===
            'function'
            ? updater({
              ...existing
            })
            : {
              ...existing,
              ...updater
            };

        state[provider.id] = {
          ...existing,
          ...next,
          providerId:
            provider.id,
          type:
            provider.type,
          model:
            provider.model
        };

        await db.put(
          'smartAiProviderHealth',
          JSON.stringify(state)
        );
      }
    );

  try {
    await providerHealthWriteChain;
  } catch (error) {
    console.error(
      '[SMART] Failed to update provider health:',
      error.message
    );
  }
}

async function recordProviderAttempt(
  db,
  provider
) {
  await updateProviderHealth(
    db,
    provider,
    existing => ({
      ...existing,
      enabled: true,
      lastAttemptAt:
        new Date().toISOString()
    })
  );
}

async function recordProviderSuccess(
  db,
  provider
) {
  await updateProviderHealth(
    db,
    provider,
    existing => ({
      ...existing,
      status: 'healthy',
      lastSuccessAt:
        new Date().toISOString(),
      consecutiveFailures: 0
    })
  );
}

async function recordProviderError(
  db,
  provider,
  error
) {
  const normalized =
    normalizeProviderError(error);

  await updateProviderHealth(
    db,
    provider,
    existing => {
      const failures =
        Number(
          existing
            .consecutiveFailures ||
          0
        ) + 1;

      return {
        ...existing,
        status:
          failures >= 3
            ? 'unavailable'
            : 'degraded',
        lastErrorAt:
          new Date().toISOString(),
        lastErrorCode:
          normalized.code,
        lastErrorMessage:
          normalized.message,
        consecutiveFailures:
          failures
      };
    }
  );
}

async function requestGeminiPartition(
  articles,
  apiKey,
  model,
  timeoutMs
) {
  if (!apiKey) {
    const error =
      new Error(
        'No Gemini API key available'
      );

    error.code =
      'NOT_CONFIGURED';

    throw error;
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const response =
      await fetch(endpoint, {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',
          'x-goog-api-key':
            apiKey
        },

        signal:
          controller.signal,

        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    buildVerificationPrompt(
                      articles
                    )
                }
              ]
            }
          ],

          generationConfig: {
            maxOutputTokens:
              2048,
            responseMimeType:
              'application/json',
            responseJsonSchema:
              PARTITION_RESPONSE_SCHEMA
          }
        })
      });

    if (!response.ok) {
      const details =
        await response
          .text()
          .catch(() => '');

      const error =
        new Error(
          `Gemini HTTP ${response.status}: ${details.slice(0, 300)}`
        );

      error.status =
        response.status;

      throw error;
    }

    const payload =
      await response.json();

    const text =
      payload?.candidates?.[0]
        ?.content?.parts
        ?.map(
          part =>
            part.text || ''
        )
        .join('') || '';

    if (!text) {
      throw new Error(
        'Gemini returned an empty response'
      );
    }

    return parsePartitionResponse(
      text,
      model
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function requestLocalPartition(
  articles,
  baseUrl,
  model,
  timeoutMs
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const endpoint =
      `${String(baseUrl).replace(/\/$/, '')}/api/chat`;

    const response =
      await fetch(endpoint, {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        signal:
          controller.signal,

        body: JSON.stringify({
          model,

          messages: [
            {
              role: 'user',
              content:
                buildVerificationPrompt(
                  articles
                )
            }
          ],

          stream: false,
          think: false,
          format:
            PARTITION_RESPONSE_SCHEMA,
          keep_alive:
            LOCAL_AI_KEEP_ALIVE,

          options: {
            temperature: 0,
            num_ctx:
              LOCAL_AI_CONTEXT_TOKENS,
            num_predict:
              LOCAL_AI_OUTPUT_TOKENS,
            seed: 17
          }
        })
      });

    if (!response.ok) {
      const details =
        await response
          .text()
          .catch(() => '');

      const error =
        new Error(
          `Local AI HTTP ${response.status}: ${details.slice(0, 300)}`
        );

      error.status =
        response.status;

      throw error;
    }

    const payload =
      await response.json();

    const text =
      payload?.message?.content ||
      '';

    if (!text) {
      throw new Error(
        'Local AI returned an empty response'
      );
    }

    return parsePartitionResponse(
      text,
      model
    );
  } finally {
    clearTimeout(timeout);
  }
}

function isModelOutputError(
  error
) {
  const code =
    String(error?.code || '')
      .toUpperCase();

  const message =
    String(error?.message || '')
      .toLowerCase();

  return (
    code === 'INVALID_JSON' ||
    code === 'INVALID_PARTITION' ||
    code === 'POST_VALIDATION_FAILED' ||
    message.includes(
      'invalid json'
    ) ||
    message.includes(
      'invalid partition'
    ) ||
    message.includes(
      'empty response'
    ) ||
    message.includes(
      'empty content'
    ) ||
    message.includes(
      'post-validation'
    )
  );
}

async function callVerificationProvider(
  provider,
  group,
  keyManager
) {
  if (
    provider.type === 'gemini'
  ) {
    if (
      keyManager?.waitForRateSlot
    ) {
      await keyManager.waitForRateSlot(
        1000
      );
    }

    const keyObject =
      keyManager?.getCurrentKeyObj
        ? keyManager
          .getCurrentKeyObj()
        : null;

    if (
      keyManager?.recordUsage
    ) {
      keyManager.recordUsage();
    }

    return requestGeminiPartition(
      group.articles,
      keyObject?.key,
      provider.model,
      provider.timeoutMs
    );
  }

  if (
    provider.type === 'ollama'
  ) {
    if (
      group.articles.length >
      SMART_NEWS_CLUSTER_CONFIG
        .heavyAI
        .maxArticlesPerLocalReview
    ) {
      const error =
        new Error(
          `Local review group is too large: ${group.articles.length}`
        );

      error.code =
        'GROUP_TOO_LARGE';

      throw error;
    }

    return requestLocalPartition(
      group.articles,
      provider.baseUrl,
      provider.model,
      provider.timeoutMs
    );
  }

  throw new Error(
    `Unsupported provider type: ${provider.type}`
  );
}

async function attemptProviderVerification(
  provider,
  group,
  keyManager,
  db
) {
  const maximumAttempts =
    Number(provider.maxRetries || 0) +
    1;

  for (
    let attempt = 1;
    attempt <= maximumAttempts;
    attempt++
  ) {
    const attemptStartedAt =
      Date.now();

    await recordProviderAttempt(
      db,
      provider
    );

    try {
      const parsed =
        await callVerificationProvider(
          provider,
          group,
          keyManager
        );

      if (
        provider.type === 'gemini' &&
        process.env
          .SMART_LOG_GEMINI_RESPONSES ===
          'true'
      ) {
        console.log(
          '[SMART GEMINI RESPONSE]',
          JSON.stringify({
            groupId:
              group?.id || null,
            providerId:
              provider.id,
            model:
              provider.model,
            articleCount:
              Array.isArray(
                group?.articles
              )
                ? group.articles.length
                : 0,
            response:
              parsed
          })
        );
      }

      const validation =
        validatePartitionResult(
          parsed,
          group.articles
        );

      if (!validation.valid) {
        const error =
          new Error(
            `Invalid partition: ${validation.reason}`
          );

        error.code =
          'INVALID_PARTITION';

        if (
          provider.type === 'gemini' &&
          process.env
            .SMART_LOG_GEMINI_RESPONSES ===
            'true'
        ) {
          console.warn(
            '[SMART GEMINI DECISION]',
            JSON.stringify({
              groupId:
                group?.id || null,
              providerId:
                provider.id,
              model:
                provider.model,
              accepted: false,
              reason:
                validation.reason
            })
          );
        }

        await recordProviderError(
          db,
          provider,
          error
        );

        return {
          valid: false,
          uncertain: true,
          reason:
            validation.reason,
          error
        };
      }

      /*
       * Validate each returned cluster independently.
       *
       * A single invalid Gemini cluster must not discard every other
       * valid cluster in the response. Invalid or insufficiently
       * confident clusters are conservatively split into singletons.
       */
      const modelWasUncertain =
        parsed.uncertain === true;

      const articleById =
        new Map(
          group.articles.map(
            article => [
              getArticleId(article),
              article
            ]
          )
        );

      const diagnoseCluster =
        articleIds => {
          const clusterArticles =
            articleIds
              .map(id =>
                articleById.get(id)
              )
              .filter(Boolean);

          if (
            clusterArticles.length !==
            articleIds.length
          ) {
            return {
              valid: false,
              reason:
                'unknown_article_id'
            };
          }

          for (
            let left = 0;
            left <
              clusterArticles.length;
            left++
          ) {
            for (
              let right = left + 1;
              right <
                clusterArticles.length;
              right++
            ) {
              const conflicts =
                detectEventConflicts(
                  clusterArticles[left],
                  clusterArticles[right]
                );

              if (
                conflicts.hasHardConflict
              ) {
                return {
                  valid: false,
                  reason:
                    'hard_event_conflict',
                  conflictReasons:
                    conflicts.reasons
                };
              }
            }
          }

          if (
            clusterArticles.length <= 1
          ) {
            return {
              valid: true,
              reason: null
            };
          }

          const visited =
            new Set([0]);

          const queue = [0];

          while (queue.length) {
            const current =
              queue.shift();

            for (
              let candidate = 0;
              candidate <
                clusterArticles.length;
              candidate++
            ) {
              if (
                visited.has(
                  candidate
                )
              ) {
                continue;
              }

              if (
                pairEligibleForVerifiedCluster(
                  clusterArticles[current],
                  clusterArticles[candidate]
                )
              ) {
                visited.add(
                  candidate
                );

                queue.push(
                  candidate
                );
              }
            }
          }

          if (
            visited.size !==
            clusterArticles.length
          ) {
            return {
              valid: false,
              reason:
                'disconnected_under_deterministic_rules',
              connectedArticles:
                visited.size,
              totalArticles:
                clusterArticles.length
            };
          }

          return {
            valid: true,
            reason: null
          };
        };

      const safeClusters = [];
      const splitClusters = [];

      for (
        let clusterIndex = 0;
        clusterIndex <
          parsed.clusters.length;
        clusterIndex++
      ) {
        const cluster =
          parsed.clusters[
            clusterIndex
          ];

        const articleIds =
          Array.isArray(
            cluster?.articleIds
          )
            ? [...cluster.articleIds]
            : [];

        const confidence =
          Number(
            cluster?.confidence
          );

        if (
          articleIds.length <= 1
        ) {
          safeClusters.push({
            ...cluster,
            articleIds
          });

          continue;
        }

        let failure = null;

        /*
         * For an explicitly uncertain response, only retain a
         * multi-article merge when Gemini confidence is at least 0.95.
         * Deterministic validation is still required afterward.
         */
        if (
          modelWasUncertain &&
          (
            !Number.isFinite(
              confidence
            ) ||
            confidence < 0.95
          )
        ) {
          failure = {
            valid: false,
            reason:
              'uncertain_confidence_below_0.95'
          };
        }

        if (!failure) {
          const diagnosis =
            diagnoseCluster(
              articleIds
            );

          if (!diagnosis.valid) {
            failure =
              diagnosis;
          }
        }

        if (!failure) {
          safeClusters.push({
            ...cluster,
            articleIds
          });

          continue;
        }

        splitClusters.push({
          clusterIndex,
          articleIds,
          confidence:
            Number.isFinite(
              confidence
            )
              ? confidence
              : null,
          reason:
            failure.reason,
          conflictReasons:
            failure
              .conflictReasons ||
            undefined,
          connectedArticles:
            failure
              .connectedArticles,
          totalArticles:
            failure
              .totalArticles
        });

        for (
          const articleId
          of articleIds
        ) {
          safeClusters.push({
            articleIds:
              [articleId],
            confidence:
              Number.isFinite(
                confidence
              )
                ? confidence
                : 1
          });
        }
      }

      const safeResult = {
        clusters:
          safeClusters,
        uncertain: false
      };

      /*
       * This should always pass because every failing merge has been
       * converted into singletons. Keep a final defensive assertion.
       */
      if (
        !postValidatePartition(
          safeResult,
          group.articles
        )
      ) {
        const error =
          new Error(
            'Salvaged partition failed final validation'
          );

        error.code =
          'SALVAGED_PARTITION_INVALID';

        throw error;
      }

      parsed.clusters =
        safeClusters;

      parsed.uncertain =
        false;

      if (
        provider.type === 'gemini' &&
        process.env
          .SMART_LOG_GEMINI_RESPONSES ===
          'true'
      ) {
        console.log(
          '[SMART GEMINI DECISION]',
          JSON.stringify({
            groupId:
              group?.id || null,
            providerId:
              provider.id,
            model:
              provider.model,
            accepted: true,
            reason:
              splitClusters.length
                ? (
                  modelWasUncertain
                    ? 'conservative_uncertain_partition'
                    : 'partial_partition_salvage'
                )
                : 'verified',
            originalClusters:
              parsed.clusters.length -
              splitClusters.reduce(
                (total, cluster) =>
                  total +
                  Math.max(
                    0,
                    cluster.articleIds
                      .length - 1
                  ),
                0
              ),
            resultingClusters:
              safeClusters.length,
            splitClusterCount:
              splitClusters.length,
            splitClusters
          })
        );
      }

      await recordProviderSuccess(
        db,
        provider
      );

      if (
        provider.type ===
        'gemini'
      ) {
        console.log(
          '[ONLINE AI]',
          JSON.stringify({
            at:
              new Date()
                .toISOString(),
            provider:
              'gemini',
            operation:
              'smart-clustering',
            providerId:
              provider.id,
            model:
              provider.model,
            status:
              'success',
            attempt,
            durationMs:
              Date.now() -
              attemptStartedAt,
            groupId:
              group?.id || null,
            articleCount:
              Array.isArray(
                group?.articles
              )
                ? group.articles.length
                : 0
          })
        );
      }

      return {
        valid: true,
        uncertain: false,
        postValidationPassed: true,
        clusters:
          safeClusters,
        conservativeUncertain:
          modelWasUncertain,
        salvaged:
          splitClusters.length > 0
      };
    } catch (error) {
      if (
        provider.type ===
        'gemini'
      ) {
        console.log(
          '[ONLINE AI]',
          JSON.stringify({
            at:
              new Date()
                .toISOString(),
            provider:
              'gemini',
            operation:
              'smart-clustering',
            providerId:
              provider.id,
            model:
              provider.model,
            status:
              'failed',
            httpStatus:
              Number(
                error?.status ||
                error?.httpStatus
              ) || null,
            errorCode:
              String(
                error?.code ||
                error?.name ||
                'UNKNOWN'
              ).slice(0, 80),
            attempt,
            durationMs:
              Date.now() -
              attemptStartedAt,
            groupId:
              group?.id || null,
            articleCount:
              Array.isArray(
                group?.articles
              )
                ? group.articles.length
                : 0
          })
        );
      }

      console.warn(
        `[SMART VERIFY] ${provider.id} ` +
        `model=${provider.model} failed: ` +
        `${error?.message || error}`
      );

      await recordProviderError(
        db,
        provider,
        error
      );

      if (
        provider.type ===
        'gemini' &&
        keyManager?.reportError &&
        !isModelOutputError(
          error
        )
      ) {
        keyManager.reportError(
          error
        );
      }

      if (
        attempt >=
        maximumAttempts ||
        !isTransientProviderError(
          error
        )
      ) {
        return {
          valid: false,
          uncertain: true,
          error
        };
      }

      await sleep(
        1000 * attempt
      );
    }
  }

  return {
    valid: false,
    uncertain: true,
    error:
      new Error(
        'Provider attempts exhausted'
      )
  };
}

function normalizedVerificationArticles(
  articles
) {
  return articles
    .map(article => ({
      id:
        getArticleId(article),
      title:
        normalizeText(
          article.title || ''
        ),
      /*
       * Do not include mutable RSS descriptions in the cache key.
       * Cached partitions are still post-validated against the
       * current articles before being accepted.
       */
      publishedAt:
        article.pubDate,
      language:
        article.language,
      category:
        article.smartCategory
    }))
    .sort(
      (left, right) =>
        left.id.localeCompare(
          right.id
        )
    );
}

function verificationCacheKey(
  group,
  providers
) {
  const payload = {
    articles:
      normalizedVerificationArticles(
        group.articles
      ),

    embeddingModel:
      EMBEDDING_MODEL,

    embeddingCacheVersion:
      EMBEDDING_CACHE_VERSION,

    /*
     * Do not include the current enabled provider stack.
     * Gemini key availability and provider order can change between
     * refreshes without changing the correctness of cached results.
     */
    verificationCacheKeyVersion:
      'provider-independent-v1',

    promptVersion:
      SMART_NEWS_AI_CONFIG
        .cache
        .promptVersion,

    rulesVersion:
      SMART_NEWS_AI_CONFIG
        .cache
        .rulesVersion,

    schemaVersion:
      SMART_NEWS_AI_CONFIG
        .cache
        .schemaVersion,

    clusterVersion:
      SMART_CLUSTER_VERSION
  };

  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

async function getVerificationCache(db) {
  try {
    return (
      await db.get(
        'smartEventVerificationCache',
        {
          type: 'json'
        }
      )
    ) || {};
  } catch {
    return {};
  }
}

async function getCachedVerificationDecision(
  db,
  group,
  providers
) {
  if (
    !SMART_NEWS_AI_CONFIG
      .cache
      .enabled
  ) {
    return null;
  }

  const cache =
    await getVerificationCache(db);

  const key =
    verificationCacheKey(
      group,
      providers
    );

  const entry = cache[key];

  if (!entry) return null;

  if (
    !entry.expiresAt ||
    Date.now() >
    Number(entry.expiresAt)
  ) {
    return null;
  }

  const validation =
    validatePartitionResult(
      entry.result,
      group.articles
    );

  if (
    !validation.valid ||
    entry.result.uncertain ||
    !postValidatePartition(
      entry.result,
      group.articles
    )
  ) {
    return null;
  }

  return {
    ...entry.result,
    providerId:
      entry.providerId,
    model:
      entry.model,
    verifiedAt:
      entry.verifiedAt
  };
}

async function setCachedVerificationDecision(
  db,
  group,
  providers,
  result
) {
  if (
    !SMART_NEWS_AI_CONFIG
      .cache
      .enabled
  ) {
    return;
  }

  verificationCacheWriteChain =
    verificationCacheWriteChain.then(
      async () => {
        const cache =
          await getVerificationCache(
            db
          );

        const key =
          verificationCacheKey(
            group,
            providers
          );

        const now = Date.now();

        cache[key] = {
          providerId:
            result.providerId,
          model:
            result.model,
          verifiedAt:
            result.verifiedAt,
          createdAt: now,
          expiresAt:
            now +
            SMART_NEWS_AI_CONFIG
              .cache
              .maxAgeMs,
          result: {
            clusters:
              result.clusters,
            uncertain: false
          }
        };

        const entries =
          Object.entries(cache)
            .filter(
              ([, entry]) =>
                Number(
                  entry.expiresAt
                ) > now
            )
            .sort(
              (
                [, left],
                [, right]
              ) =>
                Number(
                  right.createdAt
                ) -
                Number(
                  left.createdAt
                )
            )
            .slice(
              0,
              SMART_NEWS_AI_CONFIG
                .cache
                .maxEntries
            );

        await db.put(
          'smartEventVerificationCache',
          JSON.stringify(
            Object.fromEntries(
              entries
            )
          )
        );
      }
    );

  try {
    await verificationCacheWriteChain;
  } catch (error) {
    console.error(
      '[SMART] Failed to save verification cache:',
      error.message
    );
  }
}

async function verifyWithProviderChain(
  group,
  providers,
  keyManager,
  db
) {
  const cached =
    await getCachedVerificationDecision(
      db,
      group,
      providers
    );

  if (cached) {
    console.log(
      '[SMART VERIFY CACHE HIT]',
      JSON.stringify({
        groupId:
          group?.id || null,
        articles:
          Array.isArray(
            group?.articles
          )
            ? group.articles.length
            : 0,
        providerId:
          cached.providerId || null,
        model:
          cached.model || null
      })
    );

    return {
      valid: true,
      uncertain: false,
      providerId:
        cached.providerId,
      model:
        cached.model,
      clusters:
        cached.clusters,
      verifiedAt:
        cached.verifiedAt,
      attemptedProviders: [],
      resolution: 'cached'
    };
  }

  console.log(
    '[SMART VERIFY CACHE MISS]',
    JSON.stringify({
      groupId:
        group?.id || null,
      articles:
        Array.isArray(
          group?.articles
        )
          ? group.articles.length
          : 0
    })
  );

  const attemptedProviders = [];

  for (const provider of providers) {
    attemptedProviders.push(
      provider.id
    );

    const result =
      await attemptProviderVerification(
        provider,
        group,
        keyManager,
        db
      );

    if (
      result.valid &&
      !result.uncertain &&
      result.postValidationPassed
    ) {
      const finalResult = {
        valid: true,
        uncertain: false,
        providerId:
          provider.id,
        model:
          provider.model,
        clusters:
          result.clusters,
        verifiedAt:
          new Date().toISOString(),
        attemptedProviders,
        resolution:
          'verified'
      };

      await setCachedVerificationDecision(
        db,
        group,
        providers,
        finalResult
      );

      return finalResult;
    }
  }

  return {
    valid: true,
    uncertain: true,
    providerId: null,
    model: null,
    attemptedProviders,
    resolution:
      'kept_separate',
    fallbackReason:
      providers.length
        ? 'all_providers_failed_or_uncertain'
        : 'no_provider_configured',

    clusters:
      group.articles.map(
        article => ({
          articleIds: [
            getArticleId(article)
          ]
        })
      )
  };
}

async function reviewAmbiguousEventGroups(
  ambiguousGroups,
  providers,
  keyManager,
  db,
  onProgress = null
) {
  const resolvedGroups = [];

  const statistics = {
    ambiguousGroupsTotal:
      ambiguousGroups.length,
    ambiguousGroupsVerified: 0,
    ambiguousGroupsFromCache: 0,
    ambiguousGroupsKeptSeparate: 0,
    reviewedArticleCount: 0,
    allProvidersFailedCount: 0,
    providerRequests: {},
    groupResults: []
  };

  for (
    let index = 0;
    index < ambiguousGroups.length;
    index++
  ) {
    const group =
      ambiguousGroups[index];

    statistics.reviewedArticleCount +=
      group.articles.length;

    if (onProgress) {
      onProgress({
        stage: 'smart-ai',
        message:
          `Reviewing ambiguous group ${index + 1}/${ambiguousGroups.length}…`,
        current: index + 1,
        total:
          ambiguousGroups.length
      });
    }

    const result =
      await verifyWithProviderChain(
        group,
        providers,
        keyManager,
        db
      );

    for (
      const providerId
      of result.attemptedProviders
    ) {
      statistics.providerRequests[
        providerId
      ] =
        (
          statistics
            .providerRequests[
          providerId
          ] || 0
        ) + 1;
    }

    if (
      result.resolution ===
      'verified'
    ) {
      statistics
        .ambiguousGroupsVerified++;
    } else if (
      result.resolution ===
      'cached'
    ) {
      statistics
        .ambiguousGroupsFromCache++;
    } else {
      statistics
        .ambiguousGroupsKeptSeparate++;

      statistics
        .allProvidersFailedCount++;
    }

    statistics.groupResults.push({
      groupId: group.id,
      articleCount:
        group.articles.length,
      attemptedProviders:
        result.attemptedProviders,
      successfulProvider:
        result.providerId,
      resolution:
        result.resolution
    });

    for (
      const partition
      of result.clusters
    ) {
      const partitionSet =
        new Set(
          partition.articleIds
        );

      const partitionArticles =
        group.articles.filter(
          article =>
            partitionSet.has(
              getArticleId(
                article
              )
            )
        );

      if (!partitionArticles.length) {
        continue;
      }

      const verified =
        result.resolution ===
        'verified' ||
        result.resolution ===
        'cached';

      resolvedGroups.push({
        id:
          createGroupId(
            partitionArticles
          ),

        articles:
          partitionArticles,

        verified,

        providerId:
          result.providerId,

        model:
          result.model,

        verifiedAt:
          result.verifiedAt,

        verification:
          verified
            ? {
              method:
                'ai_fallback',
              providerId:
                result.providerId,
              model:
                result.model,
              verifiedAt:
                result.verifiedAt
            }
            : {
              method:
                'kept_separate',
              reason:
                result.fallbackReason
            }
      });
    }
  }


  return {
    clusters:
      resolvedGroups,
    ...statistics
  };
}

function assertEveryCandidateAppearsExactlyOnce(
  candidates,
  rawGroups
) {
  const expectedIds =
    new Set(
      candidates.map(
        getArticleId
      )
    );

  const seenIds = new Set();

  for (const group of rawGroups) {
    if (
      !group ||
      !Array.isArray(
        group.articles
      ) ||
      !group.articles.length
    ) {
      throw new Error(
        'Invariant failed: empty raw group'
      );
    }

    for (
      const article
      of group.articles
    ) {
      const id =
        getArticleId(article);

      if (!expectedIds.has(id)) {
        throw new Error(
          `Invariant failed: unexpected article ${id}`
        );
      }

      if (seenIds.has(id)) {
        throw new Error(
          `Invariant failed: duplicate article ${id}`
        );
      }

      seenIds.add(id);
    }
  }

  const missing =
    [...expectedIds].filter(
      id => !seenIds.has(id)
    );

  if (missing.length) {
    throw new Error(
      `Invariant failed: missing ${missing.length} article(s): ${missing.slice(0, 5).join(', ')}`
    );
  }
}

function getClusterArticleLinks(cluster) {
  return new Set(
    [
      cluster?.link,
      ...(Array.isArray(
        cluster?.relatedArticles
      )
        ? cluster.relatedArticles.map(
          article =>
            article.link
        )
        : [])
    ].filter(Boolean)
  );
}

function getLatestClusterCoverageTime(cluster) {
  const times = [
    cluster?.pubDate,
    ...(Array.isArray(cluster?.relatedArticles)
      ? cluster.relatedArticles.map(
        article => article.pubDate
      )
      : [])
  ]
    .map(parsePublishedTimestamp)
    .filter(Number.isFinite);

  return times.length
    ? Math.max(...times)
    : NaN;
}

function isActiveCluster(cluster, now = Date.now()) {
  const latestCoverageAt =
    getLatestClusterCoverageTime(cluster);

  if (!Number.isFinite(latestCoverageAt)) {
    return false;
  }

  return (
    now - latestCoverageAt <=
    72 * HOUR_MS
  );
}

function extractActiveClusterArticles(
  cluster
) {
  const latest =
    getLatestClusterCoverageTime(
      cluster
    );

  const clusterId =
    cluster.clusterId ||
    stableId(
      [...getClusterArticleLinks(cluster)]
        .sort()
        .join('|')
    );

  const representative = {
    ...cluster,
    isCluster: false,
    relatedArticles: undefined,
    _activeClusterId:
      clusterId,
    _activeClusterLatestAt:
      latest
  };

  const related =
    Array.isArray(
      cluster.relatedArticles
    )
      ? cluster.relatedArticles.map(
        article => ({
          ...article,
          smartCategory:
            article.smartCategory ||
            cluster.smartCategory,
          feedCategory:
            article.feedCategory ||
            cluster.feedCategory,
          domain:
            article.domain ||
            hostFromUrl(
              article.link
            ),
          sourceWeight:
            article.sourceWeight ||
            cluster.sourceWeight ||
            1,
          language:
            article.language ||
            detectArticleLanguage(
              article
            ),
          content:
            article.content || '',
          _activeClusterId:
            clusterId,
          _activeClusterLatestAt:
            latest
        })
      )
      : [];

  return [
    representative,
    ...related
  ].filter(
    article => article.link
  );
}

async function fetchRssUrl(
  url,
  fastParseRSS,
  headers
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      18_000
    );

  try {
    const response =
      await fetch(url, {
        headers: {
          ...headers,
          Accept:
            'application/rss+xml, application/xml, text/xml, */*'
        },
        redirect: 'follow',
        signal:
          controller.signal
      });

    if (!response.ok) {
      await discardResponseBody(response);
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const xml =
      await response.text();

    if (
      !/<(?:item|entry)\b/i.test(
        xml
      )
    ) {
      throw new Error(
        'Response is not a usable RSS/Atom feed'
      );
    }

    const parsed =
      fastParseRSS(xml);

    const items =
      (parsed.items || [])
        .filter(
          item =>
            item.link &&
            item.title
        )
        .slice(
          0,
          SMART_ITEMS_PER_SOURCE
        );

    if (!items.length) {
      throw new Error(
        'No articles found'
      );
    }

    return items;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSmartSource(
  source,
  fastParseRSS,
  headers
) {
  const urls =
    [
      ...new Set(
        [
          source.url,
          source.fallbackUrl
        ].filter(Boolean)
      )
    ];

  const errors = [];

  for (const url of urls) {
    try {
      const items =
        await fetchRssUrl(
          url,
          fastParseRSS,
          headers
        );

      const articles =
        items.map(item =>
          normalizeArticle(
            item,
            {
              ...source,
              url,
              hiddenSmartSource:
                true
            }
          )
        );

      return {
        source,
        articles,
        ok: true,
        fallbackUsed:
          url !== source.url
      };
    } catch (error) {
      errors.push(
        `${url === source.url ? 'primary' : 'fallback'}: ${error.message}`
      );
    }
  }

  return {
    source,
    articles: [],
    ok: false,
    error:
      errors.join(' | ') ||
      'No feed URL configured'
  };
}

async function fetchInBatches(
  sources,
  size,
  worker,
  onProgress = null
) {
  const results = [];

  for (
    let index = 0;
    index < sources.length;
    index += size
  ) {
    const batch =
      sources.slice(
        index,
        index + size
      );

    results.push(
      ...await Promise.all(
        batch.map(worker)
      )
    );

    if (onProgress) {
      onProgress({
        stage:
          'smart-sources',

        message:
          `Refreshing Smart sources… ${Math.min(index + batch.length, sources.length)}/${sources.length}`,

        current:
          Math.min(
            index +
            batch.length,
            sources.length
          ),

        total:
          sources.length
      });
    }
  }

  return results;
}

async function putManySafe(
  db,
  values,
  options = {}
) {
  if (
    typeof db.putMany ===
    'function'
  ) {
    return db.putMany(
      values,
      options
    );
  }

  for (
    const [key, value]
    of Object.entries(values)
  ) {
    await db.put(key, value);
  }
}

export async function startSmartSyncLoop(
  helpers,
  headers,
  db,
  getSources
) {
  console.log(
    '🚀 [SMART SYNC] Background smart source fetch loop initialized.'
  );

  while (true) {
    const cycleStartedAt =
      Date.now();

    try {
      if (typeof helpers.waitForHttpIdle === 'function') {
        await helpers.waitForHttpIdle();
      }
      const configuredSources =
        await getSources();

      const uniqueSources =
        [
          ...new Map(
            configuredSources.map(
              source => [
                source.url,
                source
              ]
            )
          ).values()
        ];

      const results =
        await fetchInBatches(
          uniqueSources,
          3,
          source =>
            fetchSmartSource(
              source,
              helpers.fastParseRSS,
              headers
            )
        );

      const articles =
        results.flatMap(
          result =>
            result.articles ||
            []
        );

      await db.put(
        'smartRawArticles',
        JSON.stringify(articles)
      );

      console.log(
        `[SMART SYNC] Fetched ${articles.length} articles from ${uniqueSources.length} sources.`
      );
    } catch (error) {
      console.error(
        '[SMART SYNC] Background fetch failed:',
        error.message
      );
    }

    const minimumCycleTime =
      15 * 60 * 1000;

    const elapsed =
      Date.now() -
      cycleStartedAt;

    if (
      elapsed <
      minimumCycleTime
    ) {
      await sleep(
        minimumCycleTime -
        elapsed
      );
    }
  }
}

export async function scheduleMonthlySourceEvaluation(
  db,
  getSources
) {
  const {
    evaluateSourceReputations
  } = await import(
    './summary-engine.js'
  );

  console.log(
    '🚀 [SMART EVAL] Monthly source evaluation scheduler initialized.'
  );

  const checkEvaluation =
    async () => {
      try {
        const lastEvaluation =
          (
            await db.get(
              'lastSourceEvalTime',
              {
                type: 'json'
              }
            )
          ) || 0;

        const existingScores =
          await db.get(
            'smartSourceScores',
            {
              type: 'json'
            }
          );

        const now = Date.now();

        if (
          !existingScores ||
          now -
          Number(
            lastEvaluation
          ) >
          30 * DAY_MS
        ) {
          const sources =
            await getSources();

          const domains =
            [
              ...new Set(
                sources
                  .map(
                    source =>
                      source.domain
                  )
                  .filter(
                    Boolean
                  )
              )
            ];

          const scores =
            await evaluateSourceReputations(
              domains
            );

          if (
            scores &&
            typeof scores ===
            'object' &&
            Object.keys(scores)
              .length
          ) {
            await db.put(
              'smartSourceScores',
              JSON.stringify(
                scores
              )
            );

            await db.put(
              'lastSourceEvalTime',
              JSON.stringify(
                now
              )
            );

            console.log(
              '[SMART EVAL] Source reputation evaluation completed.'
            );
          }
        }
      } catch (error) {
        console.error(
          '[SMART EVAL] Evaluation failed:',
          error.message
        );
      }
    };

  const initialTimer =
    setTimeout(
      checkEvaluation,
      10_000
    );

  const recurringTimer =
    setInterval(
      checkEvaluation,
      HOUR_MS
    );

  if (initialTimer.unref) {
    initialTimer.unref();
  }

  if (recurringTimer.unref) {
    recurringTimer.unref();
  }
}

export function createSmartNewsEngine({
  db,
  helpers,
  headers = {},
  geminiKeyManager = null
}) {
  const staticGeminiKey =
    process.env.GEMINI_API_KEY ||
    '';

  const staticKeyObject =
    staticGeminiKey
      ? {
        key:
          staticGeminiKey,
        index: 0
      }
      : null;

  const keyManager =
    geminiKeyManager || {
      keys:
        staticKeyObject
          ? [staticKeyObject]
          : [],

      getCurrentKeyObj:
        () =>
          staticKeyObject,

      recordUsage:
        () => { },

      reportError:
        () => { }
    };

  const hasGeminiKey =
    () =>
      Boolean(
        keyManager
          ?.getCurrentKeyObj?.()
          ?.key
      );

  const localModel =
    SMART_NEWS_AI_CONFIG
      .providers
      .find(
        provider =>
          provider.id ===
          'local-qwen'
      )?.model ||
    'qwen3.5:2b';

  let running = false;
  let timer = null;

  let currentProgress = {
    active: false,
    stage: 'idle',
    message:
      'Waiting for the next Smart refresh.',
    current: 0,
    total: 0,
    percent: 0,
    updatedAt:
      toVietnamIso(Date.now())
  };

  async function getSettings() {
    return (
      await db.get(
        'smartSettings',
        {
          type: 'json'
        }
      )
    ) || {
      excludedCategories: [],
      excludedFeedCategories: []
    };
  }

  async function updateSettings(
    settings
  ) {
    const current =
      await getSettings();

    const updated = {
      ...current,
      ...settings
    };

    await db.put(
      'smartSettings',
      JSON.stringify(updated)
    );

    return updated;
  }

  async function getSourceSettings() {
    const stored =
      await db.get(
        'smartSources',
        {
          type: 'json'
        }
      );

    const input =
      Array.isArray(stored) &&
        stored.length
        ? stored
        : DEFAULT_SMART_SOURCES;

    const seenUrls =
      new Set();

    const identities =
      new Set();

    const sources = [];

    const identityFor =
      source =>
        [
          source.category,
          source.region,
          source.domain ||
          hostFromUrl(
            source.url
          )
        ]
          .join('|')
          .toLowerCase();

    for (
      const rawSource
      of input
    ) {
      const source =
        normalizeSmartSource(
          rawSource
        );

      const url =
        source &&
        canonicalSourceUrl(
          source.url
        );

      if (
        !source ||
        !url ||
        seenUrls.has(url)
      ) {
        continue;
      }

      seenUrls.add(url);
      identities.add(
        identityFor(source)
      );
      sources.push(source);
    }

    let defaultsAdded = 0;

    if (
      Array.isArray(stored) &&
      stored.length
    ) {
      for (
        const rawDefault
        of DEFAULT_SMART_SOURCES
      ) {
        const source =
          normalizeSmartSource(
            rawDefault
          );

        const url =
          source &&
          canonicalSourceUrl(
            source.url
          );

        const identity =
          source &&
          identityFor(source);

        if (
          !source ||
          !url ||
          seenUrls.has(url) ||
          identities.has(
            identity
          )
        ) {
          continue;
        }

        seenUrls.add(url);
        identities.add(
          identity
        );
        sources.push(source);
        defaultsAdded++;
      }
    }

    if (defaultsAdded) {
      await db.put(
        'smartSources',
        JSON.stringify(sources)
      );
    }

    if (!sources.length) {
      return DEFAULT_SMART_SOURCES
        .map(
          normalizeSmartSource
        )
        .filter(Boolean);
    }

    const scores =
      await db.get(
        'smartSourceScores',
        {
          type: 'json'
        }
      );

    if (
      scores &&
      typeof scores === 'object'
    ) {
      for (const source of sources) {
        if (
          source.domain &&
          Number.isFinite(
            Number(
              scores[
              source
                .domain
              ]
            )
          )
        ) {
          source.weight =
            Number(
              scores[
              source
                .domain
              ]
            );
        }
      }
    }

    return sources;
  }

  async function getSources() {
    const settings =
      await getSettings();

    const excludedCategories =
      Array.isArray(
        settings.excludedCategories
      )
        ? settings
          .excludedCategories
        : [];

    return (
      await getSourceSettings()
    ).filter(
      source =>
        source.enabled !== false &&
        !excludedCategories.includes(
          source.category
        )
    );
  }

  async function addSource(input) {
    const source =
      normalizeSmartSource({
        ...(input || {}),
        enabled: true
      });

    if (!source) {
      throw new Error(
        'Enter a valid RSS/Atom URL.'
      );
    }

    const sources =
      await getSourceSettings();

    const key =
      canonicalSourceUrl(
        source.url
      );

    const existingIndex =
      sources.findIndex(
        current =>
          canonicalSourceUrl(
            current.url
          ) === key
      );

    const updated = [...sources];

    if (
      existingIndex >= 0
    ) {
      updated[
        existingIndex
      ] = {
        ...updated[
        existingIndex
        ],
        ...source,
        enabled: true
      };
    } else {
      updated.push(source);
    }

    await db.put(
      'smartSources',
      JSON.stringify(updated)
    );

    return updated;
  }

  async function setSourceEnabled(
    url,
    enabled
  ) {
    const key =
      canonicalSourceUrl(url);

    if (!key) {
      throw new Error(
        'Invalid Smart source URL.'
      );
    }

    const sources =
      await getSourceSettings();

    const index =
      sources.findIndex(
        source =>
          canonicalSourceUrl(
            source.url
          ) === key
      );

    if (index < 0) {
      throw new Error(
        'Smart source not found.'
      );
    }

    const updated =
      sources.map(
        (source, sourceIndex) =>
          sourceIndex === index
            ? {
              ...source,
              enabled:
                Boolean(
                  enabled
                )
            }
            : source
      );

    if (
      !updated.some(
        source =>
          source.enabled !==
          false
      )
    ) {
      throw new Error(
        'Smart must keep at least one enabled source.'
      );
    }

    await db.put(
      'smartSources',
      JSON.stringify(updated)
    );

    return updated;
  }

  async function removeSource(url) {
    return setSourceEnabled(
      url,
      false
    );
  }

  async function discoverSources(
    input = {}
  ) {
    const category =
      VALID_SMART_CATEGORIES.has(
        input.category
      )
        ? input.category
        : '';

    if (!category) {
      throw new Error(
        'Choose a Smart section before searching.'
      );
    }

    const region =
      category === 'tech'
        ? (
          input.region ===
            'vietnam'
            ? 'vietnam'
            : 'foreign'
        )
        : (
          category.endsWith(
            '_vietnam'
          )
            ? 'vietnam'
            : 'foreign'
        );

    const sources =
      await getSourceSettings();

    const existing =
      new Set(
        sources.map(
          source =>
            canonicalSourceUrl(
              source.url
            )
        )
      );

    const candidates =
      SMART_SOURCE_DISCOVERY_POOL
        .map(source =>
          normalizeSmartSource({
            ...source,
            enabled: false,
            discovered: true
          })
        )
        .filter(
          source =>
            source &&
            source.category ===
            category &&
            source.region ===
            region &&
            !existing.has(
              canonicalSourceUrl(
                source.url
              )
            )
        )
        .sort(
          (left, right) =>
            right.weight -
            left.weight ||
            left.title.localeCompare(
              right.title
            )
        )
        .slice(0, 5);

    if (!candidates.length) {
      return {
        sources,
        candidates: []
      };
    }

    const updated = [
      ...sources,
      ...candidates
    ];

    await db.put(
      'smartSources',
      JSON.stringify(updated)
    );

    return {
      sources: updated,
      candidates
    };
  }

  async function resetSources() {
    const sources =
      DEFAULT_SMART_SOURCES
        .map(source =>
          normalizeSmartSource({
            ...source,
            enabled: true
          })
        )
        .filter(Boolean);

    await db.put(
      'smartSources',
      JSON.stringify(sources)
    );

    return sources;
  }

  async function getStatus() {
    const stored =
      (
        await db.get(
          'smartStatus',
          {
            type: 'json'
          }
        )
      ) || {};

    const sources =
      await getSources();

    const providers =
      getEnabledVerificationProviders(
        hasGeminiKey()
      );

    const storedHealth =
      await getProviderHealth(db);

    const aiProviderHealth = {};

    for (
      const provider
      of SMART_NEWS_AI_CONFIG.providers
    ) {
      aiProviderHealth[
        provider.id
      ] = {
        providerId:
          provider.id,
        type:
          provider.type,
        model:
          provider.model,
        enabled:
          providerEnabled(
            provider,
            hasGeminiKey()
          ),
        status:
          providerEnabled(
            provider,
            hasGeminiKey()
          )
            ? (
              storedHealth[
                provider.id
              ]?.status ||
              'healthy'
            )
            : (
              provider.type ===
                'gemini' &&
                !hasGeminiKey()
                ? 'not_configured'
                : 'disabled'
            ),
        lastAttemptAt:
          storedHealth[
            provider.id
          ]?.lastAttemptAt ||
          null,
        lastSuccessAt:
          storedHealth[
            provider.id
          ]?.lastSuccessAt ||
          null,
        lastErrorAt:
          storedHealth[
            provider.id
          ]?.lastErrorAt ||
          null,
        lastErrorCode:
          storedHealth[
            provider.id
          ]?.lastErrorCode ||
          null,
        lastErrorMessage:
          storedHealth[
            provider.id
          ]?.lastErrorMessage ||
          null,
        consecutiveFailures:
          Number(
            storedHealth[
              provider.id
            ]
              ?.consecutiveFailures ||
            0
          )
      };
    }

    return {
      ...stored,
      running,
      progress:
        currentProgress,
      refreshMinutes:
        SMART_REFRESH_MS /
        60000,
      configuredSourceCount:
        sources.length,
      sourceCounts:
        countSmartSources(
          sources
        ),
      geminiConfigured:
        hasGeminiKey(),
      localConfigured:
        providers.some(
          provider =>
            provider.type ===
            'ollama'
        ),
      localModel,
      providerOrder:
        providers.map(
          provider =>
            provider.id
        ),
      aiProviderHealth,
      model:
        SMART_NEWS_AI_CONFIG
          .providers[0]
          .model
    };
  }

  async function setStatus(value) {
    await db.put(
      'smartStatus',
      JSON.stringify(value)
    );
  }

  async function sync(
    onProgress = null,
    targetCategory = null
  ) {
    if (running) {
      return {
        ok: true,
        skipped: true,
        reason:
          'Smart refresh already running'
      };
    }

    running = true;

    const startedAt =
      toVietnamIso(Date.now());

    const isTargeted =
      targetCategory &&
      VALID_SMART_CATEGORIES.has(
        targetCategory
      );

    const notify =
      (
        stage,
        message,
        extra = {}
      ) => {
        const terminal =
          stage ===
          'smart-ready' ||
          stage ===
          'smart-error';

        currentProgress = {
          ...currentProgress,
          stage,
          message,
          active: !terminal,
          updatedAt:
            toVietnamIso(
              Date.now()
            ),
          ...extra
        };

        if (
          stage ===
          'smart-ready'
        ) {
          currentProgress.percent =
            100;
        }

        if (
          typeof onProgress ===
          'function'
        ) {
          onProgress(
            currentProgress
          );
        }
      };

    let smartSources = [];

    try {
      smartSources =
        await getSources();

      const sourceCounts =
        countSmartSources(
          smartSources
        );

      notify(
        'smart-starting',
        isTargeted
          ? `Loading Smart sources for ${targetCategory}…`
          : 'Loading Smart source configuration…'
      );

      const previousStatus =
        (
          await db.get(
            'smartStatus',
            {
              type: 'json'
            }
          )
        ) || {};

      const providers =
        getEnabledVerificationProviders(
          hasGeminiKey()
        );

      const providerOrder =
        providers.map(
          provider =>
            provider.id
        );

      await setStatus({
        ...previousStatus,
        state: 'refreshing',
        startedAt,
        providerOrder,
        localModel,
        progress:
          currentProgress
      });

      let sourcesToFetch =
        isTargeted
          ? smartSources.filter(
            source =>
              source.category ===
              targetCategory
          )
          : smartSources;

      if (
        isTargeted &&
        targetCategory === 'tech'
      ) {
        sourcesToFetch =
          sourcesToFetch.filter(
            source =>
              !isInvestingComSource(
                source
              )
          );
      }

      const sourceResults =
        await fetchInBatches(
          sourcesToFetch,
          16,
          source =>
            fetchSmartSource(
              source,
              helpers.fastParseRSS,
              headers
            ),
          progress =>
            notify(
              progress.stage,
              progress.message,
              {
                ...progress,
                percent:
                  progress.total
                    ? Math.round(
                      progress.current /
                      progress.total *
                      100
                    )
                    : 0
              }
            )
        );

      const fetchedArticles =
        sourceResults.flatMap(
          result =>
            result.articles ||
            []
        );

      const sourceErrors =
        sourceResults
          .filter(
            result =>
              !result.ok
          )
          .map(result => ({
            title:
              result.source
                .title,
            url:
              result.source
                .url,
            error:
              result.error
          }));

      const previousHidden =
        isTargeted
          ? (
            await db.get(
              'smartRawArticles',
              {
                type: 'json',
                shared: true
              }
            )
          ) || []
          : [];

      const preservedHidden =
        isTargeted
          ? previousHidden.filter(
            article =>
              article.smartCategory !==
              targetCategory
          )
          : [];

      const hiddenArticles =
        isTargeted
          ? [
            ...preservedHidden,
            ...fetchedArticles
          ]
          : fetchedArticles;

      const existingArticles =
        (
          await db.get(
            'articles',
            {
              // Read-only in this path. Cloning the full article database
              // blocks HTTP requests while Smart News starts in background.
              type: 'json',
              shared: true
            }
          )
        ) || [];

      const existingClusters =
        (
          await db.get(
            'smartClusters',
            {
              // Filtering below creates new arrays and normalized objects.
              type: 'json',
              shared: true
            }
          )
        ) || [];

      const feeds =
        (
          await db.get(
            'feeds',
            {
              type: 'json',
              shared: true
            }
          )
        ) || [];

      const settings =
        await getSettings();

      const excludedFeedCategories =
        Array.isArray(
          settings
            .excludedFeedCategories
        )
          ? settings
            .excludedFeedCategories
          : [];

      const dynamicExcludedUrls =
        new Set(
          feeds
            .filter(
              feed =>
                feed.excludeFromSmart ||
                excludedFeedCategories
                  .includes(
                    feed.category
                  )
            )
            .map(feed =>
              canonicalSourceUrl(
                feed.url,
                true
              )
            )
        );

      const comparisonCutoff =
        Date.now() -
        SMART_NEWS_CLUSTER_CONFIG
          .comparisonWindowHours *
        HOUR_MS;

      // These collections are large enough to freeze Express if processed in
      // one uninterrupted array chain. Yield every small batch so cached page
      // and API requests remain responsive while Smart clustering prepares.
      const activeStoredArticles = [];
      for (let index = 0; index < existingClusters.length; index++) {
        const cluster = existingClusters[index];
        if (isActiveCluster(cluster)) {
          activeStoredArticles.push(...extractActiveClusterArticles(cluster));
        }
        if (index > 0 && index % 150 === 0) await new Promise(resolve => setImmediate(resolve));
      }

      const normalArticles = [];
      for (let index = 0; index < existingArticles.length; index++) {
        const article = existingArticles[index];
        if (
          article.link &&
          parsePublishedTimestamp(article.pubDate) >= comparisonCutoff &&
          !isExcludedFromSmart(article, dynamicExcludedUrls)
        ) {
          normalArticles.push(normalizeArticle(article));
        }
        if (index > 0 && index % 150 === 0) await new Promise(resolve => setImmediate(resolve));
      }

      const normalizedHidden = [];
      for (let index = 0; index < hiddenArticles.length; index++) {
        const article = normalizeArticle(hiddenArticles[index]);
        if (
          article.link &&
          parsePublishedTimestamp(article.pubDate) >= comparisonCutoff &&
          !isExcludedFromSmart(article, dynamicExcludedUrls)
        ) {
          normalizedHidden.push(article);
        }
        if (index > 0 && index % 150 === 0) await new Promise(resolve => setImmediate(resolve));
      }

      const articleMap =
        new Map();

      let processedArticleCount = 0;
      for (
        const article
        of activeStoredArticles
      ) {
        if (article.link) {
          articleMap.set(
            article.link,
            article
          );
        }
        processedArticleCount++;
        if (processedArticleCount % 150 === 0) await new Promise(resolve => setImmediate(resolve));
      }

      processedArticleCount = 0;
      for (
        const article
        of [
          ...normalArticles,
          ...normalizedHidden
        ]
      ) {
        if (article.link) {
          articleMap.set(
            article.link,
            article
          );
        }
        processedArticleCount++;
        if (processedArticleCount % 150 === 0) await new Promise(resolve => setImmediate(resolve));
      }

      const rawCandidates =
        dedupeGoogleNewsWrappers(
          [...articleMap.values()]
        );

      const previousRawArticles = (await db.get('smartRawArticles', { type: 'json', shared: true })) || [];
      const previousArticleMap = new Map();
      for (const article of previousRawArticles) {
        if (article.articleKey) {
          previousArticleMap.set(article.articleKey, article);
        }
      }

      const candidates = [];
      const activeCandidates = new Set();

      for (let candidateIndex = 0; candidateIndex < rawCandidates.length; candidateIndex++) {
        const article = rawCandidates[candidateIndex];
        let status = 'NEW';

        // Ensure legacy articles have articleKey and contentHash
        if (!article.articleKey) {
          article.articleKey = article.link || `${article.sourceTitle || 'Unknown'}:${article.guid || article.id || ''}`;
        }
        if (!article.contentHash) {
          const cleanedTitle = (article.title || '').replace(/<[^>]*>?/gm, '');
          const cleanedContent = (article.content || article.summary || article.description || '').replace(/<[^>]*>?/gm, '').slice(0, 500);
          article.contentHash = createHash('sha256')
            .update([
              cleanedTitle,
              cleanedContent,
              article.pubDate || '',
              article.category || ''
            ].join('\n'))
            .digest('hex');
        }

        const prev = previousArticleMap.get(article.articleKey);

        if (prev) {
          if (prev.contentHash === article.contentHash) {
            status = 'UNCHANGED';
          } else {
            status = 'MODIFIED';
          }
        }

        article._status = status;
        candidates.push(article);
        activeCandidates.add(article.articleKey);
        if (candidateIndex > 0 && candidateIndex % 150 === 0) await new Promise(resolve => setImmediate(resolve));
      }

      for (const [key, prev] of previousArticleMap.entries()) {
        if (!activeCandidates.has(key)) {
          // EXPIRED or REMOVED (we just track it logically if needed)
          // we don't necessarily push it to candidates unless we want to process removals.
        }
      }

      const currentSignature =
        stableId(
          candidates
            .map(article =>
              [
                article.link,
                article.title,
                article.pubDate
              ].join('|')
            )
            .sort()
            .join('\n')
        );

      const previousSignature =
        (
          await db.get(
            'smartCandidateSignature'
          )
        ) || '';

      const sourceSignature =
        stableId(
          smartSources
            .map(source =>
              [
                source.url,
                source.category,
                source.region,
                source.weight
              ].join('|')
            )
            .sort()
            .join('\n')
        );

      const aiConfiguration =
        [
          ...SMART_NEWS_AI_CONFIG
            .providers
            .map(provider =>
              [
                provider.id,
                provider.model,
                providerEnabled(
                  provider,
                  hasGeminiKey()
                )
              ].join(':')
            ),
          SMART_CLUSTER_VERSION,
          sourceSignature
        ].join('|');

      const previousAiConfiguration =
        (
          await db.get(
            'smartAiConfig'
          )
        ) || '';

      if (
        !isTargeted &&
        currentSignature ===
        previousSignature &&
        previousAiConfiguration ===
        aiConfiguration &&
        existingClusters.length
      ) {
        notify(
          'smart-ready',
          'No article changes; existing Smart clusters were reused.'
        );

        const completed = {
          state: 'ready',
          startedAt,
          completedAt:
            toVietnamIso(
              Date.now()
            ),
          sourceCounts,
          candidateCount:
            candidates.length,
          clusterCount:
            existingClusters.length,
          newArticleCount: 0,
          providerOrder,
          aiProviders: [],
          verificationStats:
            null,
          progress:
            currentProgress
        };

        await setStatus(
          completed
        );

        return {
          ok: true,
          skipped: true,
          ...completed
        };
      }

      notify(
        'smart-clustering',
        'Preparing multilingual E5 embeddings…',
        {
          current: 0,
          total:
            candidates.length,
          percent: 0
        }
      );

      /*
       * Reuse saved clusters only when they were created by the
       * current clustering implementation.
       */
      const storedClusterVersion =
        (
          await db.get(
            'smartClusteringAlgorithmVersion'
          )
        ) || '';

      const clusterVersionChanged =
        storedClusterVersion !==
        SMART_CLUSTER_VERSION;

      // Reuse one clustering worker for the lifetime of this Node process.
      // This is required because the old ONNX ARM64 native addon cannot
      // safely be unloaded and then loaded by a replacement Worker.
      const worker = getClusterWorker();

      const { autoMergedClusters, ambiguousGroups } = await new Promise((resolve, reject) => {
        let hasResult = false;

        const cleanup = () => {
          worker.off('message', onMessage);
        };

        const onMessage = msg => {
          if (msg.type === 'progress') {
            notify(
              'smart-clustering',
              `Matching candidates… ${msg.progress.current || 0}/${msg.progress.total || 0}`,
              {
                percent: msg.progress.total
                  ? Math.round((msg.progress.current / msg.progress.total) * 100)
                  : 0
              }
            );
          } else if (msg.type === 'result') {
            if (hasResult) return;
            hasResult = true;
            cleanup();
            resolve(msg.result);
          } else if (msg.type === 'error') {
            if (hasResult) return;
            hasResult = true;
            cleanup();
            reject(new Error(msg.error));
          }
        };

        worker.on('message', onMessage);

        const reusableExistingClusters =
          clusterVersionChanged
            ? []
            : existingClusters;

        console.log(
          '[HNSW VERSION CHECK]',
          JSON.stringify({
            storedClusterVersion,
            currentClusterVersion:
              SMART_CLUSTER_VERSION,
            clusterVersionChanged,
            storedClusters:
              existingClusters.length,
            reusableClusters:
              reusableExistingClusters.length,
            cleanRebuild:
              clusterVersionChanged
          })
        );

        worker.postMessage({
          type: 'cluster',
          mode:
            process.env.SMART_CLUSTERING_MODE ||
            'incremental-hnsw',
          articles: candidates,
          existingClusters:
            reusableExistingClusters,
          cachePath:
            EMBEDDING_CACHE_FILE
        });
      });

      /*
       * Two-stage publishing:
       *
       * 1. Publish a complete provisional result immediately after
       *    deterministic HNSW clustering.
       * 2. Continue AI review in the background.
       * 3. Atomically replace this provisional result with the final
       *    reviewed result when verification finishes.
       *
       * The provisional result must contain every candidate exactly
       * once. It must not mark SMART_CLUSTER_VERSION as completed.
       */
      const provisionalAmbiguousArticleIds =
        new Set(
          ambiguousGroups
            .flatMap(group =>
              Array.isArray(group?.articles)
                ? group.articles
                : []
            )
            .map(article =>
              getArticleId(article)
            )
            .filter(Boolean)
        );

      const provisionalClaimedArticleIds =
        new Set();

      const provisionalRawGroups = [];

      /*
       * Keep every deterministic HNSW group, while defensively
       * preventing duplicate article assignments.
       */
      for (
        const group
        of autoMergedClusters
      ) {
        const articles =
          (
            Array.isArray(
              group?.articles
            )
              ? group.articles
              : []
          ).filter(article => {
            const id =
              getArticleId(article);

            if (
              !id ||
              provisionalClaimedArticleIds
                .has(id)
            ) {
              return false;
            }

            provisionalClaimedArticleIds
              .add(id);

            return true;
          });

        if (!articles.length) {
          continue;
        }

        const pendingAiReview =
          articles.some(article =>
            provisionalAmbiguousArticleIds
              .has(
                getArticleId(article)
              )
          );

        provisionalRawGroups.push({
          ...group,

          id:
            createGroupId(
              articles
            ),

          articles,

          verified:
            !pendingAiReview,

          verification: {
            method:
              pendingAiReview
                ? 'pending_ai_review'
                : (
                  articles.length > 1
                    ? 'e5_auto_merge'
                    : 'singleton'
                ),

            provisional:
              pendingAiReview
          }
        });
      }

      /*
       * HNSW implementations may omit ambiguous components from
       * autoMergedClusters. Add every unclaimed candidate as a
       * provisional singleton so the website always receives a
       * complete feed while AI verification is running.
       */
      for (
        const article
        of candidates
      ) {
        const id =
          getArticleId(article);

        if (
          provisionalClaimedArticleIds
            .has(id)
        ) {
          continue;
        }

        provisionalClaimedArticleIds
          .add(id);

        const pendingAiReview =
          provisionalAmbiguousArticleIds
            .has(id);

        provisionalRawGroups.push({
          id:
            createGroupId(
              [article]
            ),

          articles:
            [article],

          verified:
            !pendingAiReview,

          verification: {
            method:
              pendingAiReview
                ? 'pending_ai_review'
                : 'singleton',

            provisional:
              pendingAiReview
          }
        });
      }

      assertEveryCandidateAppearsExactlyOnce(
        candidates,
        provisionalRawGroups
      );

      let provisionalClusters =
        provisionalRawGroups
          .map(group =>
            buildCluster(
              group.articles,
              {
                validated: true,
                verification:
                  group.verification
              }
            )
          )
          .filter(Boolean);

      const provisionalCurrentLinks =
        new Set(
          candidates
            .map(article =>
              article.link
            )
            .filter(Boolean)
        );

      const provisionalSevenDaysAgo =
        Date.now() -
        7 * DAY_MS;

      /*
       * Preserve old clusters that are outside the current candidate
       * set during normal incremental runs. During a clean rebuild,
       * do not reintroduce old-version clusters.
       */
      const provisionalUntouchedOldClusters =
        clusterVersionChanged
          ? []
          : existingClusters.filter(
            cluster => {
              if (
                isTargeted &&
                targetCategory &&
                cluster.smartCategory !==
                  targetCategory
              ) {
                return true;
              }

              const latestCoverageAt =
                getLatestClusterCoverageTime(
                  cluster
                );

              if (
                !Number.isFinite(
                  latestCoverageAt
                ) ||
                latestCoverageAt <
                  provisionalSevenDaysAgo
              ) {
                return false;
              }

              const links =
                getClusterArticleLinks(
                  cluster
                );

              return ![...links].some(
                link =>
                  provisionalCurrentLinks
                    .has(link)
              );
            }
          );

      provisionalClusters = [
        ...provisionalUntouchedOldClusters,
        ...provisionalClusters
      ];

      provisionalClusters.sort(
        (left, right) =>
          Number(
            right.hotness || 0
          ) -
          Number(
            left.hotness || 0
          ) ||
          Number(
            right.sourceWeight || 1
          ) -
          Number(
            left.sourceWeight || 1
          ) ||
          safeDate(
            right.pubDate
          ) -
          safeDate(
            left.pubDate
          )
      );

      provisionalClusters =
        provisionalClusters.map(
          cleanStoredCluster
        );

      /*
       * Do not persist embedding vectors in the provisional result.
       */
      for (
        const cluster
        of provisionalClusters
      ) {
        if (cluster) {
          delete cluster._vec;
        }

        if (
          Array.isArray(
            cluster?.relatedArticles
          )
        ) {
          for (
            const article
            of cluster.relatedArticles
          ) {
            delete article._vec;
          }
        }
      }

      const provisionalClusterVersion =
        `${toVietnamIso(Date.now())}_` +
        `${provisionalClusters.length}_provisional`;

      await putManySafe(
        db,
        {
          smartClusters:
            JSON.stringify(
              provisionalClusters
            ),

          smartClusterVersion:
            provisionalClusterVersion,

          smartClusterState:
            JSON.stringify({
              provisional: true,
              stage:
                'ai_review',
              clusterCount:
                provisionalClusters.length,
              ambiguousGroupsTotal:
                ambiguousGroups.length,
              ambiguousArticles:
                provisionalAmbiguousArticleIds
                  .size,
              publishedAt:
                toVietnamIso(
                  Date.now()
                )
            })
        },
        {
          allowLargeReduction:
            true
        }
      );

      /*
       * Expose provisional state through the existing status endpoint.
       */
      await setStatus({
        ...previousStatus,
        state:
          'refreshing',
        startedAt,
        providerOrder,
        localModel,
        provisional: true,
        clusterCount:
          provisionalClusters.length,
        ambiguousGroupCount:
          ambiguousGroups.length,
        progress:
          currentProgress
      });

      console.log(
        '[SMART PROVISIONAL PUBLISH]',
        JSON.stringify({
          clusters:
            provisionalClusters.length,
          deterministicGroups:
            provisionalRawGroups.length,
          ambiguousGroups:
            ambiguousGroups.length,
          ambiguousArticles:
            provisionalAmbiguousArticleIds
              .size
        })
      );

      let reviewResult = {
        clusters:
          ambiguousGroups.flatMap(
            group =>
              group.articles.map(
                article => ({
                  id:
                    createGroupId(
                      [article]
                    ),
                  articles:
                    [article],
                  verified:
                    false,
                  verification:
                  {
                    method:
                      'kept_separate',
                    reason:
                      providers.length
                        ? 'verification_not_run'
                        : 'no_provider_configured'
                  }
                })
              )
          ),
        ambiguousGroupsTotal:
          ambiguousGroups.length,
        ambiguousGroupsVerified:
          0,
        ambiguousGroupsFromCache:
          0,
        ambiguousGroupsKeptSeparate:
          ambiguousGroups.length,
        reviewedArticleCount:
          0,
        allProvidersFailedCount:
          providers.length
            ? ambiguousGroups.length
            : 0,
        providerRequests: {},
        groupResults: []
      };

      if (
        ambiguousGroups.length &&
        providers.length &&
        SMART_NEWS_CLUSTER_CONFIG
          .heavyAI
          .enabled
      ) {
        reviewResult =
          await reviewAmbiguousEventGroups(
            ambiguousGroups,
            providers,
            keyManager,
            db,
            progress =>
              notify(
                progress.stage ||
                'smart-ai',
                progress.message ||
                'AI verification in progress…',
                progress
              )
          );
      }

      /*
       * HNSW autoMergedClusters contains every candidate article,
       * including articles later sent through ambiguous-group review.
       *
       * AI-reviewed partitions must replace those articles' original
       * HNSW groups, not be appended on top of them.
       */
      const reviewedArticleIds =
        new Set(
          reviewResult.clusters
            .flatMap(
              group =>
                Array.isArray(
                  group?.articles
                )
                  ? group.articles
                  : []
            )
            .map(
              article =>
                getArticleId(article)
            )
            .filter(Boolean)
        );

      /*
       * Remove reviewed articles from their original HNSW groups.
       * Preserve any non-reviewed remainder of an auto group.
       */
      const residualAutoGroups =
        autoMergedClusters
          .map(group => {
            const articles =
              (
                Array.isArray(
                  group?.articles
                )
                  ? group.articles
                  : []
              ).filter(
                article =>
                  !reviewedArticleIds.has(
                    getArticleId(article)
                  )
              );

            if (!articles.length) {
              return null;
            }

            return {
              ...group,
              id:
                createGroupId(
                  articles
                ),
              articles
            };
          })
          .filter(Boolean);

      /*
       * Reviewed groups should also be disjoint from one another.
       * Throw a more precise error if the HNSW review components
       * themselves overlap.
       */
      const reviewedSeenIds =
        new Set();

      for (
        let groupIndex = 0;
        groupIndex <
          reviewResult.clusters.length;
        groupIndex++
      ) {
        const group =
          reviewResult.clusters[
            groupIndex
          ];

        for (
          const article
          of (
            Array.isArray(
              group?.articles
            )
              ? group.articles
              : []
          )
        ) {
          const id =
            getArticleId(article);

          if (
            reviewedSeenIds.has(id)
          ) {
            throw new Error(
              `Invariant failed: duplicate reviewed article ${id} in reviewed group ${groupIndex}`
            );
          }

          reviewedSeenIds.add(id);
        }
      }

      console.log(
        '[SMART REVIEW REPLACEMENT]',
        JSON.stringify({
          autoGroupsBefore:
            autoMergedClusters.length,
          reviewGroups:
            reviewResult.clusters.length,
          reviewedArticles:
            reviewedArticleIds.size,
          residualAutoGroups:
            residualAutoGroups.length
        })
      );

      const rawGroups = [
        ...residualAutoGroups.map(
          group => ({
            ...group,
            verified: true,
            verification: {
              method:
                group.articles
                  .length > 1
                  ? 'e5_auto_merge'
                  : 'singleton'
            }
          })
        ),
        ...reviewResult.clusters
      ];

      assertEveryCandidateAppearsExactlyOnce(
        candidates,
        rawGroups
      );

      let clusters =
        rawGroups
          .map(group =>
            buildCluster(
              group.articles,
              {
                validated: true,
                verification:
                  group.verification
              }
            )
          )
          .filter(Boolean);

      const currentLinks =
        new Set(
          candidates.map(
            article =>
              article.link
          )
        );

      const sevenDaysAgo =
        Date.now() -
        7 * DAY_MS;

      /*
       * During a clean algorithm-version rebuild, no old clusters may
       * be reintroduced after HNSW finishes. Re-adding an old cluster
       * can duplicate an article already assigned to a new cluster.
       */
      const untouchedOldClusters =
        clusterVersionChanged
          ? []
          : existingClusters.filter(
          cluster => {
            if (
              isTargeted &&
              targetCategory &&
              cluster.smartCategory !==
              targetCategory
            ) {
              return true;
            }

            const latestCoverageAt =
              getLatestClusterCoverageTime(
                cluster
              );

            if (
              !Number.isFinite(latestCoverageAt) ||
              latestCoverageAt <
              sevenDaysAgo
            ) {
              return false;
            }

            const links =
              getClusterArticleLinks(
                cluster
              );

            return ![...links].some(
              link =>
                currentLinks.has(
                  link
                )
            );
          }
        );

      clusters = [
        ...untouchedOldClusters,
        ...clusters
      ];

      clusters.sort(
        (left, right) =>
          Number(
            right.hotness || 0
          ) -
          Number(
            left.hotness || 0
          ) ||
          Number(
            right.sourceWeight ||
            1
          ) -
          Number(
            left.sourceWeight ||
            1
          ) ||
          safeDate(
            right.pubDate
          ) -
          safeDate(
            left.pubDate
          )
      );

      clusters =
        clusters.map(
          cleanStoredCluster
        );

      for (const cluster of clusters) {
        if (cluster) {
          delete cluster._vec;
        }

        if (
          Array.isArray(
            cluster
              ?.relatedArticles
          )
        ) {
          for (
            const article
            of cluster
              .relatedArticles
          ) {
            delete article._vec;
          }
        }
      }

      for (
        const article
        of hiddenArticles
      ) {
        delete article._vec;
      }

      const aiProvidersUsed =
        [
          ...new Set(
            reviewResult
              .clusters
              .map(
                group =>
                  group
                    .providerId
              )
              .filter(Boolean)
          )
        ];

      const clusterVersion =
        `${toVietnamIso(Date.now())}_${clusters.length}`;

      await putManySafe(
        db,
        {
          smartRawArticles:
            JSON.stringify(
              hiddenArticles
            ),

          smartClusters:
            JSON.stringify(
              clusters
            ),

          /*
           * Timestamp/snapshot identifier for this saved result.
           */
          smartClusterVersion:
            clusterVersion,

          /*
           * Clustering implementation that produced these clusters.
           * Saved atomically with smartClusters only after success.
           */
          smartClusteringAlgorithmVersion:
            SMART_CLUSTER_VERSION,

          /*
           * The final reviewed result replaces the provisional
           * clusters in the same save operation.
           */
          smartClusterState:
            JSON.stringify({
              provisional: false,
              stage: 'ready',
              clusterCount:
                clusters.length,
              ambiguousGroupsTotal:
                ambiguousGroups.length,
              ambiguousGroupsReviewed:
                reviewResult
                  .ambiguousGroupsTotal,
              completedAt:
                toVietnamIso(
                  Date.now()
                )
            }),

          smartCandidateLinks:
            JSON.stringify(
              [...currentLinks].sort()
            ),

          smartCandidateSignature:
            currentSignature,

          smartAiConfig:
            aiConfiguration
        },
        {
          allowLargeReduction:
            true
        }
      );

      const providerHealth =
        await getProviderHealth(db);

      const completed = {
        state: 'ready',
        provisional: false,
        startedAt,
        completedAt:
          toVietnamIso(
            Date.now()
          ),
        configuredSourceCount:
          smartSources.length,
        sourceCounts,
        successfulSourceCount:
          sourceResults.length -
          sourceErrors.length,
        failedSourceCount:
          sourceErrors.length,
        sourceErrors,
        hiddenArticleCount:
          hiddenArticles.length,
        candidateCount:
          candidates.length,
        clusterCount:
          clusters.length,
        autoMergedClusterCount:
          autoMergedClusters.length,
        ambiguousGroupCount:
          ambiguousGroups.length,
        providerOrder,
        aiProviders:
          aiProvidersUsed,
        geminiConfigured:
          hasGeminiKey(),
        geminiUsed:
          aiProvidersUsed.some(
            providerId =>
              providerId.startsWith(
                'gemini-'
              )
          ),
        localConfigured:
          providers.some(
            provider =>
              provider.type ===
              'ollama'
          ),
        localUsed:
          aiProvidersUsed.includes(
            'local-qwen'
          ),
        localModel,
        verificationStats: {
          ambiguousGroupsTotal:
            reviewResult
              .ambiguousGroupsTotal,
          ambiguousGroupsVerified:
            reviewResult
              .ambiguousGroupsVerified,
          ambiguousGroupsFromCache:
            reviewResult
              .ambiguousGroupsFromCache,
          ambiguousGroupsKeptSeparate:
            reviewResult
              .ambiguousGroupsKeptSeparate,
          reviewedArticleCount:
            reviewResult
              .reviewedArticleCount,
          allProvidersFailedCount:
            reviewResult
              .allProvidersFailedCount,
          providerRequests:
            reviewResult
              .providerRequests,
          groupResults:
            reviewResult
              .groupResults
        },
        aiProviderHealth:
          providerHealth,
        comparisonWindowHours:
          SMART_NEWS_CLUSTER_CONFIG
            .comparisonWindowHours,
        timezone:
          'Asia/Ho_Chi_Minh (UTC+7)',
        progress:
          currentProgress
      };

      await setStatus(
        completed
      );

      notify(
        'smart-ready',
        `Smart feed ready: ${clusters.length} clusters.`
      );

      console.log(
        '[SMART] Ready:',
        clusters.length,
        'clusters from',
        candidates.length,
        'candidates; providers:',
        aiProvidersUsed.join(', ') ||
        'none'
      );

      return {
        ok: true,
        ...completed
      };
    } catch (error) {
      notify(
        'smart-error',
        'Smart refresh failed.',
        {
          failed: true,
          error:
            error.message
        }
      );

      const failed = {
        state: 'error',
        startedAt,
        completedAt:
          toVietnamIso(
            Date.now()
          ),
        error:
          error.message,
        configuredSourceCount:
          smartSources.length,
        providerOrder:
          getEnabledVerificationProviders(
            hasGeminiKey()
          ).map(
            provider =>
              provider.id
          ),
        localModel,
        progress:
          currentProgress
      };

      await setStatus(failed);

      console.error(
        '[SMART] Refresh failed:',
        error.message
      );

      return {
        ok: false,
        ...failed
      };
    } finally {
      running = false;

      if (
        embeddingCache.size >
        5000
      ) {
        embeddingCache.clear();
      }

      const idleMs = Number(process.env.SMART_EMBEDDING_WORKER_IDLE_MS) || 0;
      if (idleMs > 0) {
        setTimeout(() => {
          if (!running) {
            disposeEmbeddingModel();
          }
        }, idleMs);
      }

      if (global.gc) {
        global.gc();
      }
    }
  }

  function scheduleNext() {
    clearTimeout(timer);

    timer = setTimeout(
      async () => {
        if (typeof helpers.waitForHttpIdle === 'function') {
          await helpers.waitForHttpIdle();
        }
        await sync();
        scheduleNext();
      },
      SMART_REFRESH_MS
    );

    if (timer.unref) {
      timer.unref();
    }
  }

  function start() {
    const initial =
      setTimeout(
        async () => {
          if (typeof helpers.waitForHttpIdle === 'function') {
            await helpers.waitForHttpIdle();
          }
          await sync();
        },
        2500
      );

    if (initial.unref) {
      initial.unref();
    }

    scheduleNext();

    getSources()
      .then(sources =>
        console.log(
          '[SMART] Engine initialized with',
          sources.length,
          'sources; providers:',
          getEnabledVerificationProviders(
            hasGeminiKey()
          )
            .map(
              provider =>
                provider.id
            )
            .join(', ') ||
          'none'
        )
      )
      .catch(error =>
        console.error(
          '[SMART] Could not load source settings:',
          error.message
        )
      );
  }

  return {
    getStatus,
    getSources,
    getSourceSettings,
    addSource,
    removeSource,
    setSourceEnabled,
    discoverSources,
    resetSources,
    sync,
    start,
    getSettings,
    updateSettings
  };
}
