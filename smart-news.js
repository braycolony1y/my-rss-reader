import {
  SMART_EDITORIAL_POLICY_VERSION,
  SMART_EDITORIAL_RESPONSE_SCHEMA,
  applySmartEditorialAssessment,
  buildSmartEditorialPrompt,
  parseSmartEditorialResponse,
  prepareSmartEditorialPlan
} from './src/ai/smart-editorial.js';
import { parseClusteringJson, requestClusteringDecision } from './src/ai/clustering-json.js';
import { generateWithAntigravity, antigravityAvailable, ANTIGRAVITY_MODEL } from './src/ai/antigravity.js';
import { rankStory, retainStoryIds } from './src/articles/story-ranking.js';
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
import { getHeapStatistics } from 'node:v8';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const SMART_REFRESH_MS = 30 * 60 * 1000;
const VIETNAM_OFFSET_MS = 7 * HOUR_MS;

const SMART_ITEMS_PER_SOURCE = 10;
const SMART_CLUSTER_VERSION =
  'v2.15_component_relationship_review_20260914-generic-recovery-v2';

const EMBEDDING_MODEL = process.env.SMART_EMBEDDING_MODEL || 'Xenova/multilingual-e5-small';
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
    maxComponentsPerOnlineReview: 20,
    maxComponentsPerLocalReview: 12,
    keepSeparateOnFailure: true
  }
};

const SMART_NEWS_AI_CONFIG = {
  providers: [
    {
      id: 'antigravity-low',
      type: 'antigravity',
      model: ANTIGRAVITY_MODEL,
      priority: 0,
      timeoutMs: 60_000,
      maxRetries: 0
    },
    {
      id: 'antigravity-medium',
      type: 'antigravity',
      model:
        process.env.ANTIGRAVITY_MEDIUM_MODEL ||
        'gemini-3.8-flash-medium',
      priority: 1,
      timeoutMs: 120_000,
      maxRetries: 0
    },
    {
      id: 'antigravity-high',
      type: 'antigravity',
      model:
        process.env.ANTIGRAVITY_HIGH_MODEL ||
        'gemini-3.8-flash-high',
      priority: 2,
      timeoutMs: 180_000,
      maxRetries: 0
    },
    {
      // Retained as an explicitly disabled compatibility entry so older
      // diagnostics/tests can still recognize the provider identifier. It is
      // not part of the production clustering fallback chain.
      id: 'gemini-flash-lite',
      type: 'gemini',
      model:
        process.env.GEMINI_FLASH_LITE_MODEL ||
        'gemini-3.5-flash-lite',
      priority: 90,
      enabled: false,
      timeoutMs: 15_000,
      maxRetries: 1,
      maxOutputTokens: 768,
      thinkingLevel: 'minimal'
    },
    {
      id: 'gemini-flash',
      type: 'gemini',
      model:
        process.env.GEMINI_MODEL ||
        'gemini-3.8-flash',
      priority: 3,
      timeoutMs: 25_000,
      maxRetries: 1,
      maxOutputTokens: 1024,
      thinkingLevel: 'low'
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


const COMPONENT_REVIEW_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    exactEventGroups: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          componentIds: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { type: 'string' }
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1
          }
        },
        required: ['componentIds', 'confidence'],
        additionalProperties: false
      }
    },
    relatedDevelopments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          componentIds: {
            type: 'array',
            minItems: 2,
            maxItems: 2,
            uniqueItems: true,
            items: { type: 'string' }
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1
          }
        },
        required: ['componentIds', 'confidence'],
        additionalProperties: false
      }
    },
    uncertain: { type: 'boolean' }
  },
  required: ['exactEventGroups', 'relatedDevelopments', 'uncertain'],
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
const localModelAvailabilityCache = new Map();
const LOCAL_MODEL_AVAILABILITY_TTL_MS = 5 * 60 * 1000;

// Coordinates the Smart engine with the separate background source fetch loop.
// Only one large Smart article snapshot should exist while clustering/review runs.
let activeSmartEngineRefreshes = 0;

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

export function getArticleId(article) {
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

function normalizedSourceHostname(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    return new URL(
      raw.includes('://')
        ? raw
        : `https://${raw}`
    )
      .hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\.$/, '');
  } catch {
    return '';
  }
}

function googleNewsPublisherHostname(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.hostname.toLowerCase().replace(/^www\./, '') !== 'news.google.com') return '';
    const query = url.searchParams.get('q') || '';
    const match = query.match(/(?:^|\s)site:([^\s]+)/i);
    return normalizedSourceHostname(match?.[1] || '');
  } catch {
    return '';
  }
}

function rootSourceHostname(value) {
  const hostname = normalizedSourceHostname(value);
  if (!hostname) return '';
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) return hostname;
  const secondToLast = parts[parts.length - 2];
  const knownSecondLevel = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac']);
  return knownSecondLevel.has(secondToLast)
    ? parts.slice(-3).join('.')
    : parts.slice(-2).join('.');
}

// Fetch-method choices are publisher settings, not individual feed settings.
// Prefer Smart's publisher domain because many Smart feeds are Google News
// wrappers whose URL host is unrelated to the publisher being configured.
export function sourceFetchPolicyIdentity(source) {
  const sourceObject = source && typeof source === 'object' ? source : null;
  const sourceUrl = sourceObject?.url || sourceObject?.feedUrl || String(source || '');
  let hostname = normalizedSourceHostname(sourceObject?.domain || '');

  if (!hostname || hostname === 'news.google.com') {
    hostname = googleNewsPublisherHostname(sourceUrl) || normalizedSourceHostname(sourceUrl);
  }

  return rootSourceHostname(hostname);
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

const SMART_SOURCE_FETCH_METHODS = new Set(['jina', 'cloudflare', 'vietserver', 'opencli', 'opencli-fetch', 'direct', 'allorigins']);

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

    fetchMethods: Array.isArray(source.fetchMethods)
      ? [...new Set(source.fetchMethods.filter(method => SMART_SOURCE_FETCH_METHODS.has(method)))]
      : [],

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
  return createHash('sha256')
    .update([
      EMBEDDING_MODEL,
      EMBEDDING_CACHE_VERSION,
      buildEmbeddingText(article)
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
  onProgress = null,
  checkpoint = null
) {
  const perfMonitor = monitorEventLoopDelay({ resolution: 10 });
  perfMonitor.enable();
  const startTime = Date.now();
  const entries = [];
  const seenKeys = new Set();
  let prepCounter = 0;

  for (const article of articles) {
    // If the article already has a valid vector attached, we don't need to re-embed.
    // Cache identity, rather than an attached vector, determines reuse.

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

  let lastCheckpoint = Date.now();
  for (let start = 0; start < missing.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = missing.slice(start, start + EMBEDDING_BATCH_SIZE);

    const texts = batch.map(e => e.text);
    const vectors = await getEmbeddingVector(texts);

    if (vectors && vectors.length === batch.length) {
      for (let i = 0; i < batch.length; i++) {
        embeddingCache.set(batch[i].key, vectors[i]);
      }
    }

    if (checkpoint && (Date.now() - lastCheckpoint > 30000 || start + batch.length >= missing.length)) {
      await checkpoint();
      lastCheckpoint = Date.now();
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

  perfMonitor.disable();
  const maxDelay = Math.round(perfMonitor.max / 1e6); // nanoseconds to ms
  console.log(`[SMART PERFORMANCE] stage=embeddings durationMs=${Date.now() - startTime} maxEventLoopDelayMs=${maxDelay}`);
  onProgress?.({ phase: 'embeddings', embeddingsReused: articles.length - missing.length, embeddingsGenerated: missing.length });
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

export function clearEmbeddingCache() {
  embeddingCache.clear();
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

export function getSmartDestinationPartition(article) {
  const category =
    String(
      article?.smartCategory ||
      article?.feedCategory ||
      ''
    ).toLowerCase();

  if (category === 'news_vietnam') {
    return 'news_vietnam';
  }

  if (category === 'news_world') {
    return 'news_world';
  }

  if (category === 'finance_vietnam') {
    return 'finance_vietnam';
  }

  if (
    category === 'finance_global' ||
    category === 'finance_world'
  ) {
    return 'finance_world';
  }

  if (
    category === 'tech_vietnam' ||
    category === 'tech_world'
  ) {
    return category;
  }

  if (category === 'tech') {
    const region =
      String(article?.region || '')
        .toLowerCase();

    if (region === 'vietnam') {
      return 'tech_vietnam';
    }

    if (
      region === 'foreign' ||
      region === 'world' ||
      region === 'global'
    ) {
      return 'tech_world';
    }

    const language =
      article?.language ||
      detectArticleLanguage(article);

    if (language === 'vi') {
      return 'tech_vietnam';
    }

    if (language === 'en') {
      return 'tech_world';
    }
  }

  return null;
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

  if (crossLanguage) {
    return {
      decision:
        MatchDecision.REJECT,
      conflicts: null,
      evidence: {
        reason:
          'cross_language_partition_barrier'
      }
    };
  }

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


/*
 * Generic exact-event recovery path.
 *
 * The deterministic matcher intentionally prefers false negatives over
 * false positives. That is correct for AUTO_MERGE, but it can prevent the
 * exact-event verifier from ever seeing differently-framed reports of the
 * same occurrence.
 *
 * Recovery candidates are AI-REVIEW ONLY. They never auto-merge here.
 */
export function isAiRecoveryReviewCandidate(
  articleA,
  articleB,
  similarity
) {
  if (
    !articleA ||
    !articleB ||
    !Number.isFinite(similarity)
  ) {
    return false;
  }

  const conflicts =
    detectEventConflicts(
      articleA,
      articleB
    );

  if (conflicts.hasHardConflict) {
    return false;
  }

  /*
   * Recovery is deliberately limited to a tight publication window.
   * Distinct later developments should become separate exact events or
   * RELATED_DEVELOPMENT rather than being pulled back into the first event.
   */
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
    Number.isFinite(timestampB) &&
    Math.abs(timestampA - timestampB) >
      24 * HOUR_MS
  ) {
    return false;
  }

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

  /*
   * Slightly wider than ordinary REVIEW, but still strongly semantic.
   * The AI verifier, not this function, makes the final merge decision.
   */
  const evidence =
    getEventEvidence(
      articleA,
      articleB
    );

  /*
   * The ordinary matcher remains strict.
   *
   * Recovery is only a request for AI review, so concrete event evidence
   * may compensate for weaker embedding similarity. This is intentionally
   * generic: it works for launches, rulings, recalls, shutdowns, earnings,
   * disasters, matches, policy decisions, acquisitions, etc.
   */
  let recoveryFloor;

  if (evidence.score >= 4) {
    recoveryFloor =
      Math.max(
        0.58,
        thresholds.review - 0.14
      );
  } else if (evidence.score >= 3) {
    recoveryFloor =
      Math.max(
        0.61,
        thresholds.review - 0.11
      );
  } else if (evidence.score >= 2) {
    recoveryFloor =
      Math.max(
        0.64,
        thresholds.review - 0.09
      );
  } else if (evidence.score >= 1) {
    recoveryFloor =
      Math.max(
        0.68,
        thresholds.review - 0.07
      );
  } else {
    recoveryFloor =
      Math.max(
        0.72,
        thresholds.review - 0.04
      );
  }

  if (
    similarity <
    recoveryFloor
  ) {
    return false;
  }

  /*
   * With concrete event evidence, let the exact-event verifier decide.
   * Without such evidence, require an unusually strong semantic match.
   */
  return (
    evidence.score >= 1 ||
    similarity >=
      thresholds.review + 0.03
  );

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
  const destinationA =
    getSmartDestinationPartition(
      articleA
    );
  const destinationB =
    getSmartDestinationPartition(
      articleB
    );

  /*
   * Smart destinations are editorially independent. A pair from different
   * destinations must never reach the deterministic classifier or AI review.
   * Unknown destination membership is isolated rather than guessed.
   */
  if (
    !destinationA ||
    !destinationB ||
    destinationA !== destinationB
  ) {
    return false;
  }

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
      (
        right.reviewScore ??
        right.similarity
      ) -
      (
        left.reviewScore ??
        left.similarity
      ) ||
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
      similarity,
      reviewScore = similarity
    ) => {
      const list =
        reviewCandidatesByNode[
        sourceIndex
        ];

      const candidate = {
        target: targetIndex,
        similarity,
        reviewScore
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
      } else if (
        isAiRecoveryReviewCandidate(
          nodes[left].article,
          nodes[right].article,
          similarity
        )
      ) {
        /*
         * Conservative deterministic matching rejected this pair, but it is
         * still plausible enough to deserve exact-event AI verification.
         * Do not union it here.
         */
        const recoveryEvidence =
          getEventEvidence(
            nodes[left].article,
            nodes[right].article
          );

        /*
         * Concrete event anchors help a recovery candidate survive the
         * bounded top-K queue. The original cosine similarity remains stored
         * separately and AI still makes the exact-event decision.
         */
        const recoveryReviewScore =
          similarity +
          Math.min(
            0.15,
            recoveryEvidence.score *
              0.03
          );

        addReviewCandidate(
          left,
          right,
          similarity,
          recoveryReviewScore
        );

        addReviewCandidate(
          right,
          left,
          similarity,
          recoveryReviewScore
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
        groupArticles,

      // Preserve the already-safe deterministic HNSW components. If the
      // review neighborhood is too large for AI, these components are the
      // conservative publication fallback; they must not be flattened into
      // singletons or arbitrarily chunked for separate AI decisions.
      deterministicComponents:
        componentClusters.map(
          current =>
            finalAutoComponents[current]
              .map(nodeIndex =>
                getArticleId(
                  nodes[nodeIndex].article
                )
              )
              .sort()
        )
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
  return rankStory(articles).score;
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
  const validated =
    metadata?.validated === true;

  const clusterInput =
    validated
      ? (
        Array.isArray(articles)
          ? articles
          : []
      )
      : dedupeGoogleNewsWrappers(
        articles
      );

  const uniqueArticles = [];
  const links = new Set();

  for (
    const article
    of clusterInput
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
      new Set(finalArticles.map(canonicalSourceIdentity)).size,

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

export function attachBroaderStoryMetadata(clusters, relationships = []) {
  if (!Array.isArray(clusters) || !clusters.length || !Array.isArray(relationships) || !relationships.length) {
    return clusters;
  }

  const copies = clusters.map(cluster => ({ ...cluster }));
  const clusterById = new Map(copies.map(cluster => [cluster.clusterId, cluster]));
  const clusterIdByArticleId = new Map();

  for (const cluster of copies) {
    for (const article of [cluster, ...(cluster.relatedArticles || [])]) {
      const articleId = getArticleId(article);
      if (articleId) clusterIdByArticleId.set(articleId, cluster.clusterId);
    }
  }

  const adjacency = new Map(copies.map(cluster => [cluster.clusterId, new Set()]));
  const edges = [];
  const edgeKeys = new Set();

  for (const relationship of relationships) {
    if (relationship?.type !== 'related_development') continue;
    const leftClusterId = (relationship.leftArticleIds || [])
      .map(articleId => clusterIdByArticleId.get(articleId))
      .find(Boolean);
    const rightClusterId = (relationship.rightArticleIds || [])
      .map(articleId => clusterIdByArticleId.get(articleId))
      .find(Boolean);
    if (!leftClusterId || !rightClusterId || leftClusterId === rightClusterId) continue;

    const leftCluster = clusterById.get(leftClusterId);
    const rightCluster = clusterById.get(rightClusterId);
    if (!leftCluster || !rightCluster) continue;
    if (
      leftCluster.smartCategory &&
      rightCluster.smartCategory &&
      leftCluster.smartCategory !== rightCluster.smartCategory
    ) {
      continue;
    }

    const key = [leftClusterId, rightClusterId].sort().join('|');
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    adjacency.get(leftClusterId)?.add(rightClusterId);
    adjacency.get(rightClusterId)?.add(leftClusterId);
    edges.push({
      leftClusterId,
      rightClusterId,
      confidence: Number(relationship.confidence) || null,
      providerId: relationship.providerId || null,
      model: relationship.model || null,
      reviewGroupId: relationship.reviewGroupId || null,
      verifiedAt: relationship.verifiedAt || null
    });
  }

  const visited = new Set();
  for (const cluster of copies) {
    if (visited.has(cluster.clusterId) || !adjacency.get(cluster.clusterId)?.size) continue;
    const queue = [cluster.clusterId];
    const storyClusterIds = [];
    visited.add(cluster.clusterId);

    while (queue.length) {
      const current = queue.shift();
      storyClusterIds.push(current);
      for (const neighbor of adjacency.get(current) || []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    if (storyClusterIds.length < 2) continue;
    const storyId = `story_${stableId([...storyClusterIds].sort().join('|'))}`;
    const storyEdges = edges.filter(edge =>
      storyClusterIds.includes(edge.leftClusterId) &&
      storyClusterIds.includes(edge.rightClusterId)
    );
    const events = storyClusterIds
      .map(clusterId => clusterById.get(clusterId))
      .filter(Boolean)
      .map(eventCluster => ({
        clusterId: eventCluster.clusterId,
        title: eventCluster.title,
        date: eventCluster.pubDate,
        sourceCount: eventCluster.sourceCount,
        sources: [eventCluster, ...(eventCluster.relatedArticles || [])]
          .filter(article => article?.link)
          .map(article => ({ link: article.link, name: article.feedTitle }))
          .filter((source, index, array) =>
            array.findIndex(other => other.link === source.link) === index
          )
          .slice(0, 8)
      }))
      .sort((left, right) => safeDate(left.date) - safeDate(right.date));

    for (const clusterId of storyClusterIds) {
      const eventCluster = clusterById.get(clusterId);
      if (!eventCluster) continue;
      eventCluster.broaderStory = {
        id: storyId,
        relationship: 'related_development',
        events,
        edges: storyEdges
      };
    }
  }

  return copies;
}

// Publish strict lexical matches before the heavier multilingual pass. Reuse
// accepted memberships and apply the same event-conflict checks to new joins.
export function buildEarlySmartClusters(candidates, previous = []) {
  const byLink = new Map(candidates.map(a => [a.link, a]));
  const claimed = new Set();
  const groups = [];
  for (const old of previous) {
    const members = [old, ...(old.relatedArticles || [])].map(a => byLink.get(a.link)).filter(a => a && !claimed.has(a.link));
    if (members.length < 2) continue;
    const accepted = members.filter(a => a === members[0] || !detectEventConflicts(a, members[0]).hasHardConflict);
    groups.push(accepted);
    accepted.forEach(a => claimed.add(a.link));
  }
  const index = new Map();
  const keys = a => [...titleTokens(a.title)].sort((a,b) => b.length-a.length).slice(0, 5).map(t => `${a.smartCategory}:${t}`);
  const add = (a, id) => { for (const key of keys(a)) { if (!index.has(key)) index.set(key, new Set()); if (index.get(key).size < 80) index.get(key).add(id); } };
  groups.forEach((group,id) => group.forEach(a => add(a,id)));
  for (const article of candidates) {
    if (claimed.has(article.link)) continue;
    const possible = new Set(keys(article).flatMap(key => [...(index.get(key) || [])]));
    const match = [...possible].find(id => groups[id].length < 50 && groups[id].every(member =>
      Math.abs(safeDate(member.pubDate)-safeDate(article.pubDate)) <= 72 * HOUR_MS &&
      tokenSimilarity(member.title,article.title) >= 0.78 && tokenOverlapCount(member.title,article.title) >= 5 &&
      isGenuinelyRelated(article, member)));
    const id = match ?? groups.length;
    if (match === undefined) groups.push([]);
    groups[id].push(article); claimed.add(article.link); add(article,id);
  }
  return retainStoryIds(groups.map(group => buildCluster(group, {validated:true, verification:{method:'lexical_pending_embeddings',provisional:true}})).filter(Boolean), previous);
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
    'EDITORIAL ANGLE IS NOT AN EVENT STAGE.',
    'If two articles report the same concrete occurrence, differences in headline framing, historical context, consequences, takeaways, vote details, user impact, or explanatory emphasis do not by themselves make them separate events.',
    'A distinct follow-up action or reaction remains a separate event when that response itself is the primary news occurrence rather than merely framing of the original event.',
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

export function buildComponentReviewUnits(group) {
  const reviewArticles =
    group?.fullRepartition && Array.isArray(group?.reviewUniverse) && group.reviewUniverse.length
      ? group.reviewUniverse
      : (group?.articles || []);

  const articleById = new Map(
    reviewArticles.map(article => [getArticleId(article), article])
  );

  const sourceComponents =
    Array.isArray(group?.deferredComponents) && group.deferredComponents.length
      ? group.deferredComponents
      : reviewArticles.map(article => [article]);

  const assigned = new Set();
  const cleanComponents = [];

  for (const component of sourceComponents) {
    const clean = [];
    for (const item of component || []) {
      const article =
        typeof item === 'string'
          ? articleById.get(item)
          : articleById.get(getArticleId(item)) || item;
      if (!article) continue;
      const articleId = getArticleId(article);
      if (!articleId || assigned.has(articleId)) continue;
      assigned.add(articleId);
      clean.push(article);
    }
    if (clean.length) cleanComponents.push(clean);
  }

  for (const article of reviewArticles) {
    const articleId = getArticleId(article);
    if (!articleId || assigned.has(articleId)) continue;
    assigned.add(articleId);
    cleanComponents.push([article]);
  }

  return cleanComponents.map(component => {
    const articleIds = component.map(getArticleId).sort();
    const representative = chooseRepresentative(component) || component[0];
    const ordered = [...component].sort(
      (left, right) => safeDate(right.pubDate) - safeDate(left.pubDate)
    );
    const timestamps = component.map(article => safeDate(article.pubDate)).filter(Boolean);

    return {
      id: `component_${stableId(articleIds.join('|'))}`,
      articleIds,
      articleCount: articleIds.length,
      representativeTitle: representative?.title || '',
      representativeExcerpt: String(
        representative?.content || representative?.description || representative?.summary || ''
      ).slice(0, 700),
      publishedFrom: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
      publishedTo: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
      sources: [...new Set(component.map(article => article.feedTitle).filter(Boolean))].slice(0, 10),
      headlines: ordered.slice(0, 8).map(article => ({
        title: article.title,
        source: article.feedTitle,
        publishedAt: article.pubDate
      })),
      destination: representative?.smartCategory || representative?.feedCategory || null
    };
  });
}

function buildComponentReviewPrompt(units) {
  const input = units.map(unit => ({
    id: unit.id,
    articleCount: unit.articleCount,
    representativeTitle: unit.representativeTitle,
    representativeExcerpt: unit.representativeExcerpt,
    publishedFrom: unit.publishedFrom,
    publishedTo: unit.publishedTo,
    sources: unit.sources,
    headlines: unit.headlines,
    destination: unit.destination
  }));

  return [
    'You are reviewing deterministic exact-event components from a news clustering system.',
    '',
    'Answer TWO separate questions:',
    '1. Which components describe the SAME exact real-world occurrence and may be merged?',
    '2. Which remaining exact events are distinct developments in the SAME broader story or timeline?',
    '',
    'SAME_EVENT is strict. Merge components only when the central action, subjects, object, place, and event stage are compatible.',
    'Different stages such as announcement, investigation, approval, arrest, charge, trial, ruling, appeal, launch, recall, earnings release, policy response, and deal closing are normally separate exact events.',
    '',
    'EDITORIAL ANGLE IS NOT AN EVENT STAGE.',
    'If components describe the same concrete real-world action or status change, keep them in the SAME_EVENT group even when different publishers emphasize different consequences, audiences, operators, devices, historical context, user advice, or reactions.',
    'A genuinely distinct response, follow-up action, enforcement step, market move, or later consequence is separate when it becomes the primary news occurrence rather than merely another framing of the original event.',
    '',
    'For shutdowns, retirements, activations, deadlines, migrations, bans, launches, and other effective-date transitions, strongly prefer SAME_EVENT when these anchors match:',
    '- the same system, service, policy, product, network, program, or other affected object;',
    '- the same concrete action or resulting status change;',
    '- the same geographic or organizational scope;',
    '- the same effective date or materially identical effective window.',
    '',
    'Examples of framing differences that should NOT split an otherwise identical event:',
    '- "officially shut down", "stopped from today", and "ended at midnight";',
    '- a carrier-specific or company-specific headline describing its participation in the same nationwide transition;',
    '- "what users need to do", device compatibility, subscriber impact, or migration advice caused directly by that same transition;',
    '- historical or nostalgic framing about a product or technology whose retirement is the same current event.',
    '',
    'Keep components separate when they actually report a different occurrence, such as an earlier announcement, a postponement or extension, an exception, a later enforcement action, a separate company decision outside the shared transition, or a materially different effective date.',
    '',
    'RELATED_DEVELOPMENT means separate exact events that belong to one concrete evolving story or causal/chronological sequence.',
    'Do not mark components related merely because they share a broad topic, company, person, country, industry, product family, tournament, or recurring issue.',
    '',
    'Every input component ID must appear exactly once in exactEventGroups.',
    'A one-component exactEventGroup means keep that component as its own event.',
    'relatedDevelopments must contain only pairs of component IDs that belong to DIFFERENT exactEventGroups.',
    'Pairs omitted from relatedDevelopments are treated as UNRELATED.',
    'Do not invent facts, rewrite headlines, omit IDs, duplicate IDs, or create new IDs.',
    'When evidence is insufficient for a safe decision, set uncertain to true.',
    '',
    'Return valid JSON matching the supplied schema only.',
    '',
    JSON.stringify({ components: input })
  ].join('\n');
}

export function validateComponentReviewResult(result, units) {
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    !Array.isArray(result.exactEventGroups) ||
    !Array.isArray(result.relatedDevelopments) ||
    typeof result.uncertain !== 'boolean' ||
    Object.keys(result).some(key => !['exactEventGroups', 'relatedDevelopments', 'uncertain'].includes(key))
  ) {
    return { valid: false, reason: 'invalid_component_schema' };
  }

  const requestedIds = units.map(unit => unit.id);
  const requestedSet = new Set(requestedIds);
  const returnedIds = [];
  const groupByComponent = new Map();

  for (let index = 0; index < result.exactEventGroups.length; index++) {
    const group = result.exactEventGroups[index];
    if (
      !group ||
      typeof group !== 'object' ||
      Array.isArray(group) ||
      Object.keys(group).some(key => !['componentIds', 'confidence'].includes(key)) ||
      !Array.isArray(group.componentIds) ||
      !group.componentIds.length ||
      typeof group.confidence !== 'number' ||
      !Number.isFinite(group.confidence) ||
      group.confidence < 0 ||
      group.confidence > 1
    ) {
      return { valid: false, reason: 'invalid_exact_event_group' };
    }

    for (const componentId of group.componentIds) {
      if (!requestedSet.has(componentId)) {
        return { valid: false, reason: 'unknown_component_id' };
      }
      if (groupByComponent.has(componentId)) {
        return { valid: false, reason: 'duplicate_component_id' };
      }
      groupByComponent.set(componentId, index);
      returnedIds.push(componentId);
    }
  }

  if (
    returnedIds.length !== requestedIds.length ||
    requestedIds.some(componentId => !groupByComponent.has(componentId))
  ) {
    return { valid: false, reason: 'missing_component_id' };
  }

  const relationKeys = new Set();
  for (const relation of result.relatedDevelopments) {
    if (
      !relation ||
      typeof relation !== 'object' ||
      Array.isArray(relation) ||
      Object.keys(relation).some(key => !['componentIds', 'confidence'].includes(key)) ||
      !Array.isArray(relation.componentIds) ||
      relation.componentIds.length !== 2 ||
      relation.componentIds[0] === relation.componentIds[1] ||
      relation.componentIds.some(componentId => !requestedSet.has(componentId)) ||
      typeof relation.confidence !== 'number' ||
      !Number.isFinite(relation.confidence) ||
      relation.confidence < 0 ||
      relation.confidence > 1
    ) {
      return { valid: false, reason: 'invalid_related_development' };
    }

    const [left, right] = relation.componentIds;
    if (groupByComponent.get(left) === groupByComponent.get(right)) {
      return { valid: false, reason: 'relationship_inside_same_event' };
    }
    const key = [left, right].sort().join('|');
    if (relationKeys.has(key)) {
      return { valid: false, reason: 'duplicate_related_development' };
    }
    relationKeys.add(key);
  }

  return { valid: true, reason: null };
}

export function expandComponentReviewDecision(result, units) {
  const unitById = new Map(units.map(unit => [unit.id, unit]));
  const exactGroups = result.exactEventGroups.map(group => ({
    componentIds: group.componentIds,
    confidence: group.confidence,
    articleIds: [...new Set(group.componentIds.flatMap(componentId => unitById.get(componentId)?.articleIds || []))].sort()
  }));
  const exactGroupByComponent = new Map();
  exactGroups.forEach((group, index) => group.componentIds.forEach(componentId => exactGroupByComponent.set(componentId, index)));

  const relationships = [];
  const seen = new Set();
  for (const relation of result.relatedDevelopments) {
    if (relation.confidence < 0.9) continue;
    const leftIndex = exactGroupByComponent.get(relation.componentIds[0]);
    const rightIndex = exactGroupByComponent.get(relation.componentIds[1]);
    if (leftIndex === undefined || rightIndex === undefined || leftIndex === rightIndex) continue;
    const pair = [leftIndex, rightIndex].sort((a, b) => a - b);
    const key = pair.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    relationships.push({
      type: 'related_development',
      confidence: relation.confidence,
      leftArticleIds: exactGroups[pair[0]].articleIds,
      rightArticleIds: exactGroups[pair[1]].articleIds
    });
  }

  return {
    clusters: exactGroups.map(group => ({ articleIds: group.articleIds, confidence: group.confidence })),
    storyRelationships: relationships,
    uncertain: result.uncertain === true
  };
}

function parsePartitionResponse(
  raw,
  providerName
) {
  return parseClusteringJson(raw);
}

export function validatePartitionResult(
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

  if (Array.isArray(result) || Object.keys(result).some(key => !['clusters', 'uncertain'].includes(key))) {
    return { valid: false, reason: 'wrong_root_type' };
  }
  for (const cluster of result.clusters) {
    if (!cluster || typeof cluster !== 'object' || Array.isArray(cluster) ||
        Object.keys(cluster).some(key => !['articleIds', 'confidence'].includes(key)) ||
        (cluster.confidence !== undefined && (typeof cluster.confidence !== 'number' || !Number.isFinite(cluster.confidence) || cluster.confidence < 0 || cluster.confidence > 1))) {
      return { valid: false, reason: 'invalid_enum' };
    }
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

    if (
      classification.decision !==
      MatchDecision.REJECT
    ) {
      return true;
    }

    /*
     * This pair reached a verified cluster through the generic recovery
     * review path. Hard conflicts were checked above; allow the high-level
     * exact-event verifier to recover a deterministic false negative.
     */
    return isAiRecoveryReviewCandidate(
      left,
      right,
      similarity
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

const RAW_PROVIDER_DIAGNOSTIC_LIMIT = Math.max(
  2_000,
  Math.min(
    100_000,
    Number(process.env.SMART_AI_RAW_LOG_MAX_CHARS) || 24_000
  )
);

function sanitizeProviderDiagnosticText(
  value,
  maximum = RAW_PROVIDER_DIAGNOSTIC_LIMIT
) {
  const original = String(value ?? '');
  const sanitized = original
    .replace(/([?&](?:key|api_key|apiKey)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/(?:Authorization\s*[:=]\s*)([^\r\n,}]+)/gi, 'Authorization: [REDACTED]')
    .replace(/x-goog-api-key\s*[:=]\s*[^\s,}]+/gi, 'x-goog-api-key: [REDACTED]')
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/((?:\"|')?(?:api[_-]?key|cookie)(?:\"|')?\s*[:=]\s*(?:\"|'))[^\"'\r\n]+/gi, '$1[REDACTED]');

  const limit = Math.max(256, Number(maximum) || RAW_PROVIDER_DIAGNOSTIC_LIMIT);
  return {
    text: sanitized.slice(0, limit),
    originalLength: original.length,
    sanitizedLength: sanitized.length,
    truncated: sanitized.length > limit
  };
}

function providerJsonDiagnosticFields(diagnostics) {
  if (!diagnostics) return {};

  const originalRaw =
    diagnostics.originalRawResponse ??
    diagnostics.rawResponse ??
    '';
  const repairRaw =
    diagnostics.repairRawResponse ??
    '';
  const original = sanitizeProviderDiagnosticText(originalRaw);
  const repair = sanitizeProviderDiagnosticText(repairRaw);
  const repairSucceeded =
    diagnostics.repairSucceeded === true
      ? true
      : diagnostics.repairSucceeded === false
        ? false
        : null;

  return {
    parserReason:
      String(
        diagnostics.originalReason ??
        diagnostics.reason ??
        ''
      ).slice(0, 160) || null,
    rawResponse: original.text || null,
    rawResponseLength: original.originalLength || 0,
    rawResponseShownLength: original.text.length,
    rawResponseTruncated: original.truncated,
    repairAttempted: Boolean(diagnostics.repairAttempted),
    repairSucceeded,
    repairReason:
      String(diagnostics.repairReason ?? '').slice(0, 160) || null,
    repairRawResponse: repair.text || null,
    repairRawResponseLength: repair.originalLength || 0,
    repairRawResponseShownLength: repair.text.length,
    repairRawResponseTruncated: repair.truncated
  };
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
  if (provider?.enabled === false) {
    return false;
  }

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

  if (provider.type === 'antigravity') return !onlyLocal && antigravityAvailable();

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
      p.type === 'gemini' &&
      (p.model === preferredClusteringModel || p.id === preferredClusteringModel)
    );
    if (preferredIdx >= 0) {
      const preferred = providers.splice(preferredIdx, 1)[0];
      const firstApiIndex = providers.findIndex(p => p.type !== 'antigravity');
      providers.splice(firstApiIndex >= 0 ? firstApiIndex : providers.length, 0, preferred);
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
  timeoutMs,
  keyIndex,
  generationOptions = {}
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

    generationOptions.onRequest?.();
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
                    generationOptions.repairPrompt ||
                    generationOptions.prompt ||
                    buildVerificationPrompt(articles)
                }
              ]
            }
          ],

          generationConfig: {
            maxOutputTokens:
              Math.max(
                256,
                Math.min(
                  4096,
                  Number(
                    generationOptions
                      .maxOutputTokens
                  ) || 1024
                )
              ),
            thinkingConfig: {
              thinkingLevel:
                generationOptions
                  .thinkingLevel ||
                'low'
            },
            responseMimeType:
              'application/json',
            responseJsonSchema:
              generationOptions.schema ||
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
      error.keyIndex =
        Number(keyIndex) || null;

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

    if (!text && !generationOptions.rawOutput) {
      throw new Error(
        'Gemini returned an empty response'
      );
    }

    if (generationOptions.rawOutput) return { text, onlineAiUsage: {
      keyIndex: Number(keyIndex) || null, httpStatus: response.status,
      promptTokens: Number(payload?.usageMetadata?.promptTokenCount) || 0,
      outputTokens: Number(payload?.usageMetadata?.candidatesTokenCount) || 0,
      totalTokens: Number(payload?.usageMetadata?.totalTokenCount) || 0
    } };
    const parsed = parsePartitionResponse(
      text,
      model
    );

    parsed.onlineAiUsage = {
      keyIndex:
        Number(keyIndex) || null,
      httpStatus:
        response.status,
      promptTokens:
        Number(
          payload?.usageMetadata
            ?.promptTokenCount
        ) || 0,
      outputTokens:
        Number(
          payload?.usageMetadata
            ?.candidatesTokenCount
        ) || 0,
      totalTokens:
        Number(
          payload?.usageMetadata
            ?.totalTokenCount
        ) || 0
    };

    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

async function assertLocalModelAvailable(
  baseUrl,
  model
) {
  const normalizedBaseUrl =
    String(baseUrl).replace(/\/$/, '');
  const cacheKey =
    `${normalizedBaseUrl}|${model}`;
  const cached =
    localModelAvailabilityCache.get(cacheKey);

  if (
    cached &&
    Date.now() - cached.checkedAt < LOCAL_MODEL_AVAILABILITY_TTL_MS
  ) {
    if (!cached.available) {
      const error = new Error(`Local AI model '${model}' is not installed`);
      error.code = 'LOCAL_MODEL_UNAVAILABLE';
      error.nonProviderFault = true;
      throw error;
    }
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${normalizedBaseUrl}/api/tags`, {
      signal: controller.signal
    });
    if (!response.ok) return;

    const payload = await response.json();
    if (!Array.isArray(payload?.models)) return;

    const available = payload.models.some(entry =>
      String(entry?.name || entry?.model || '') === String(model)
    );
    localModelAvailabilityCache.set(cacheKey, {
      available,
      checkedAt: Date.now()
    });

    if (!available) {
      const error = new Error(`Local AI model '${model}' is not installed`);
      error.code = 'LOCAL_MODEL_UNAVAILABLE';
      error.nonProviderFault = true;
      throw error;
    }
  } catch (error) {
    if (error?.code === 'LOCAL_MODEL_UNAVAILABLE') throw error;
    // Availability probing is advisory. If Ollama does not expose /api/tags
    // cleanly, let the normal /api/chat request decide provider availability.
  } finally {
    clearTimeout(timeout);
  }
}

async function requestLocalPartition(
  articles,
  baseUrl,
  model,
  timeoutMs,
  repairPrompt = null,
  rawOutput = false,
  onRequest = null,
  generationOptions = {}
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    await assertLocalModelAvailable(
      baseUrl,
      model
    );

    const endpoint =
      `${String(baseUrl).replace(/\/$/, '')}/api/chat`;

    onRequest?.();
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
                repairPrompt ||
                generationOptions.prompt ||
                buildVerificationPrompt(articles)
            }
          ],

          stream: false,
          think: false,
          format:
            generationOptions.schema ||
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

    if (!text && !rawOutput) {
      throw new Error(
        'Local AI returned an empty response'
      );
    }

    if (rawOutput) return text;
    return parsePartitionResponse(
      text,
      model
    );
  } finally {
    clearTimeout(timeout);
  }
}

function providerReviewArticleLimit(provider) {
  if (provider?.type === 'ollama') {
    return SMART_NEWS_CLUSTER_CONFIG
      .heavyAI
      .maxArticlesPerLocalReview;
  }

  if (
    provider?.type === 'antigravity' ||
    provider?.type === 'gemini'
  ) {
    return SMART_NEWS_CLUSTER_CONFIG
      .heavyAI
      .maxArticlesPerOnlineReview;
  }

  return Infinity;
}


function providerReviewComponentLimit(provider) {
  if (provider?.type === 'ollama') {
    return SMART_NEWS_CLUSTER_CONFIG
      .heavyAI
      .maxComponentsPerLocalReview;
  }

  if (
    provider?.type === 'antigravity' ||
    provider?.type === 'gemini'
  ) {
    return SMART_NEWS_CLUSTER_CONFIG
      .heavyAI
      .maxComponentsPerOnlineReview;
  }

  return Infinity;
}

function extractCompleteJsonRoots(text) {
  const roots = [];
  let start = -1;
  let stack = [];
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];

    if (start < 0) {
      if (character === '{' || character === '[') {
        start = index;
        stack = [character];
      }
      continue;
    }

    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }

    if (character === '"') {
      quoted = true;
      continue;
    }

    if (character === '{' || character === '[') {
      stack.push(character);
      continue;
    }

    if (character !== '}' && character !== ']') continue;

    const expected = character === '}' ? '{' : '[';
    if (stack.pop() !== expected) return [];

    if (!stack.length) {
      roots.push(text.slice(start, index + 1));
      start = -1;
    }
  }

  return start < 0 ? roots : [];
}

function normalizeAntigravityDecision(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Array.isArray(value.clusters)
  ) {
    return null;
  }

  const allowedRootKeys = new Set([
    'clusters',
    'uncertain',
    'toolAction',
    'toolSummary'
  ]);

  if (
    Object.keys(value).some(
      key => !allowedRootKeys.has(key)
    )
  ) {
    return null;
  }

  const canonicalClusters = [];

  for (const cluster of value.clusters) {
    if (
      !cluster ||
      typeof cluster !== 'object' ||
      Array.isArray(cluster) ||
      !Array.isArray(cluster.articleIds)
    ) {
      return null;
    }

    const allowedClusterKeys =
      new Set(['articleIds', 'confidence']);

    if (
      Object.keys(cluster).some(
        key => !allowedClusterKeys.has(key)
      )
    ) {
      return null;
    }

    // Confidence is advisory metadata. Two Antigravity roots that express the
    // same exact partition are semantically equivalent even when one root
    // includes confidence and the other omits it. Canonical identity therefore
    // depends only on membership plus the root-level uncertainty flag.
    canonicalClusters.push({
      articleIds:
        cluster.articleIds
          .map(String)
          .sort()
    });
  }

  canonicalClusters.sort(
    (left, right) =>
      JSON.stringify(left)
        .localeCompare(
          JSON.stringify(right)
        )
  );

  const decision = {
    clusters: value.clusters,
    uncertain: value.uncertain
  };

  return {
    decision,
    canonical:
      JSON.stringify({
        clusters: canonicalClusters,
        uncertain: value.uncertain
      }),
    metadataScore:
      value.clusters.filter(cluster =>
        typeof cluster?.confidence === 'number' &&
        Number.isFinite(cluster.confidence)
      ).length,
    strippedToolMetadata:
      Object.prototype.hasOwnProperty.call(
        value,
        'toolAction'
      ) ||
      Object.prototype.hasOwnProperty.call(
        value,
        'toolSummary'
      )
  };
}

export function normalizeAntigravityClusteringOutput(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return text;

  const roots =
    extractCompleteJsonRoots(text);

  const normalized = [];

  for (const root of roots) {
    try {
      const candidate =
        normalizeAntigravityDecision(
          JSON.parse(root)
        );
      if (candidate) normalized.push(candidate);
    } catch {
      // Leave malformed roots to the existing generic JSON recovery path.
    }
  }

  if (!normalized.length) return text;

  const canonical =
    new Set(
      normalized.map(
        candidate => candidate.canonical
      )
    );

  if (canonical.size > 1) {
    const error = new Error(
      'Antigravity returned multiple conflicting JSON roots'
    );
    error.code = 'INVALID_JSON';
    error.reason =
      'multiple_conflicting_roots';
    error.rawResponse = text;
    throw error;
  }

  const strippedToolMetadata =
    normalized.some(
      candidate =>
        candidate.strippedToolMetadata
    );

  if (
    normalized.length > 1 ||
    strippedToolMetadata
  ) {
    console.info(
      '[SMART ANTIGRAVITY NORMALIZE]',
      JSON.stringify({
        roots: roots.length,
        usableRoots: normalized.length,
        deduplicated:
          normalized.length > 1,
        strippedToolMetadata
      })
    );
  }

  const preferred = normalized.reduce(
    (best, candidate) =>
      (candidate.metadataScore || 0) > (best.metadataScore || 0)
        ? candidate
        : best,
    normalized[0]
  );

  return JSON.stringify(
    preferred.decision
  );
}

function normalizeAntigravityComponentDecision(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Array.isArray(value.exactEventGroups) ||
    !Array.isArray(value.relatedDevelopments)
  ) {
    return null;
  }

  const allowedRootKeys = new Set([
    'exactEventGroups',
    'relatedDevelopments',
    'uncertain',
    'toolAction',
    'toolSummary'
  ]);
  if (Object.keys(value).some(key => !allowedRootKeys.has(key))) return null;

  const canonicalGroups = value.exactEventGroups.map(group => ({
    componentIds: Array.isArray(group?.componentIds) ? [...group.componentIds].map(String).sort() : []
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

  const canonicalRelations = value.relatedDevelopments.map(relation => ({
    componentIds: Array.isArray(relation?.componentIds) ? [...relation.componentIds].map(String).sort() : []
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

  return {
    decision: {
      exactEventGroups: value.exactEventGroups,
      relatedDevelopments: value.relatedDevelopments,
      uncertain: value.uncertain
    },
    canonical: JSON.stringify({
      exactEventGroups: canonicalGroups,
      relatedDevelopments: canonicalRelations,
      uncertain: value.uncertain
    }),
    metadataScore:
      value.exactEventGroups.filter(group =>
        typeof group?.confidence === 'number' && Number.isFinite(group.confidence)
      ).length +
      value.relatedDevelopments.filter(relation =>
        typeof relation?.confidence === 'number' && Number.isFinite(relation.confidence)
      ).length,
    strippedToolMetadata:
      Object.prototype.hasOwnProperty.call(value, 'toolAction') ||
      Object.prototype.hasOwnProperty.call(value, 'toolSummary')
  };
}

function normalizeAntigravityComponentOutput(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return text;

  const roots = extractCompleteJsonRoots(text);
  const normalized = [];
  for (const root of roots) {
    try {
      const candidate = normalizeAntigravityComponentDecision(JSON.parse(root));
      if (candidate) normalized.push(candidate);
    } catch {
      // Generic JSON recovery/repair handles malformed content.
    }
  }
  if (!normalized.length) return text;

  const canonical = new Set(normalized.map(candidate => candidate.canonical));
  if (canonical.size > 1) {
    const error = new Error('Antigravity returned multiple conflicting component-review JSON roots');
    error.code = 'INVALID_JSON';
    error.reason = 'multiple_conflicting_roots';
    error.rawResponse = text;
    throw error;
  }

  console.log(
    '[SMART ANTIGRAVITY NORMALIZE]',
    JSON.stringify({
      operation: 'component-review',
      roots: roots.length,
      usableRoots: normalized.length,
      deduplicated: normalized.length > 1,
      strippedToolMetadata: normalized.some(candidate => candidate.strippedToolMetadata)
    })
  );

  const preferred = normalized.reduce(
    (best, candidate) =>
      (candidate.metadataScore || 0) > (best.metadataScore || 0)
        ? candidate
        : best,
    normalized[0]
  );

  return JSON.stringify(preferred.decision);
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
    code === 'LITE_ESCALATION_REQUIRED' ||
    code === 'ANTIGRAVITY_ESCALATION_REQUIRED' ||
    code === 'COMPONENT_REVIEW_UNCERTAIN' ||
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
  keyManager,
  repairPrompt = null,
  reviewSpec = null
) {
  const prompt =
    reviewSpec?.prompt ||
    buildVerificationPrompt(group.articles);
  const schema =
    reviewSpec?.schema ||
    PARTITION_RESPONSE_SCHEMA;
  const operation =
    reviewSpec?.operation ||
    'cluster-verification';

  const onRequest = () => {
    if (group.metrics) {
      group.metrics[repairPrompt ? 'jsonRepairCalls' : 'firstPassAiCalls']++;
      if (group.isFallback) group.metrics.fallbackProviderCalls++;
    }

    // Custom consumers such as editorial assessment keep separate metrics.
    reviewSpec?.onRequest?.();
  };

  if (provider.type === 'antigravity') {
    const result = await generateWithAntigravity(repairPrompt || prompt, {
      model: provider.model,
      timeoutMs: provider.timeoutMs,
      json: false,
      schema,
      operation,
      onRequest
    });
    return {
      text:
        reviewSpec?.componentReview
          ? normalizeAntigravityComponentOutput(result.text)
          : reviewSpec?.editorialReview
            ? result.text
            : normalizeAntigravityClusteringOutput(result.text),
      rawProviderText: result.text,
      onlineAiUsage: result.onlineAiUsage || null
    };
  }

  if (provider.type === 'gemini') {
    if (keyManager?.waitForRateSlot) {
      await keyManager.waitForRateSlot(1000);
    }

    const keyObject =
      keyManager?.getCurrentKeyObj
        ? keyManager.getCurrentKeyObj()
        : null;

    if (keyManager?.recordUsage) {
      keyManager.recordUsage();
    }

    return requestGeminiPartition(
      group.articles,
      keyObject?.key,
      provider.model,
      provider.timeoutMs,
      Number(keyObject?.index) + 1,
      {
        repairPrompt,
        prompt,
        schema,
        onRequest,
        rawOutput: true,
        maxOutputTokens:
          reviewSpec?.maxOutputTokens ||
          provider.maxOutputTokens,
        thinkingLevel:
          provider.thinkingLevel
      }
    );
  }

  if (provider.type === 'ollama') {
    const limit =
      reviewSpec?.componentReview
        ? providerReviewComponentLimit(provider)
        : providerReviewArticleLimit(provider);
    const size =
      reviewSpec?.componentReview
        ? (reviewSpec.units?.length || 0)
        : group.articles.length;

    if (Number.isFinite(limit) && size > limit) {
      const error = new Error(
        `Local review group is too large: ${size} > ${limit}`
      );
      error.code = 'GROUP_TOO_LARGE';
      error.nonProviderFault = true;
      throw error;
    }

    return requestLocalPartition(
      group.articles,
      provider.baseUrl,
      provider.model,
      provider.timeoutMs,
      repairPrompt,
      true,
      onRequest,
      {
        prompt,
        schema
      }
    );
  }

  throw new Error(
    `Unsupported provider type: ${provider.type}`
  );
}


async function assessSmartEditorialClusters({
  clusters,
  sources,
  providers,
  keyManager,
  db,
  notify,
  metrics
}) {
  let cache;

  try {
    cache =
      (
        await db.get(
          'smartEditorialAssessmentCache',
          {
            type: 'json'
          }
        )
      ) || {};
  } catch {
    cache = {};
  }

  const perDestination =
    Math.max(
      5,
      Math.min(
        100,
        Number(
          process.env
            .SMART_EDITORIAL_PER_DESTINATION
        ) || 30
      )
    );

  const batchSize =
    Math.max(
      1,
      Math.min(
        12,
        Number(
          process.env
            .SMART_EDITORIAL_BATCH_SIZE
        ) || 12
      )
    );

  const plan =
    prepareSmartEditorialPlan({
      clusters,
      sources,
      cache,
      perDestination
    });

  const stats = {
    cacheHits:
      plan.cacheHits,
    selected:
      plan.selected.length,
    assessed: 0,
    failed: 0,
    
    aiCalls: 0,
pending:
      plan.pendingCount,
    providerIds: []
  };

  if (
    !plan.selected.length ||
    !providers.length
  ) {
    return stats;
  }

  let cacheChanged =
    false;

  const providerIds =
    new Set();

  for (
    let offset = 0;
    offset <
      plan.selected.length;
    offset += batchSize
  ) {
    const batch =
      plan.selected.slice(
        offset,
        offset +
          batchSize
      );

    notify?.(
      'smart-editorial',
      `AI editorial assessment ${Math.min(offset + batch.length, plan.selected.length)}/${plan.selected.length}…`,
      {
        current:
          Math.min(
            offset +
              batch.length,
            plan.selected.length
          ),
        total:
          plan.selected.length
      }
    );

    const prompt =
      buildSmartEditorialPrompt(
        batch
      );

    const group = {
      id:
        `editorial_${offset}`,
      articles:
        batch.map(
          item =>
            item.cluster
        ),
      // Editorial AI must not mutate clustering metrics.
      metrics: null,
      isFallback:
        false
    };

    let accepted =
      null;
    let lastError =
      null;

    for (
      let providerIndex = 0;
      providerIndex <
        providers.length &&
      !accepted;
      providerIndex++
    ) {
      const provider =
        providers[
          providerIndex
        ];

      group.isFallback =
        providerIndex > 0;

      const attempts =
        Math.max(
          1,
          Number(
            provider.maxRetries ||
            0
          ) + 1
        );

      for (
        let attempt = 1;
        attempt <=
          attempts;
        attempt++
      ) {
        await recordProviderAttempt(
          db,
          provider
        );

        try {
          const raw =
            await callVerificationProvider(
              provider,
              group,
              keyManager,
              null,
              {
                prompt,
                schema:
                  SMART_EDITORIAL_RESPONSE_SCHEMA,
                operation:
                  'smart-editorial-assessment',
                editorialReview:
                  true,
            onRequest: () => {
              stats.aiCalls++;
            },
                maxOutputTokens:
                  2048
              }
            );

          const rows =
            parseSmartEditorialResponse(
              raw,
              batch
            );

          await recordProviderSuccess(
            db,
            provider
          );

          accepted = {
            rows,
            provider
          };

          providerIds.add(
            provider.id
          );

          break;
        } catch (error) {
          lastError =
            error;

          await recordProviderError(
            db,
            provider,
            error
          );

          console.warn(
            `[SMART EDITORIAL] ${provider.id} model=${provider.model} attempt=${attempt}/${attempts}: ${error?.message || error}`
          );

          if (
            provider.type ===
              'gemini' &&
            keyManager
              ?.reportError &&
            !isModelOutputError(
              error
            )
          ) {
            keyManager.reportError(
              error
            );
          }
        }
      }
    }

    if (!accepted) {
      stats.failed +=
        batch.length;

      for (
        const item
        of batch
      ) {
        cache[item.key] = {
          policyVersion:
            SMART_EDITORIAL_POLICY_VERSION,
          failedAt:
            new Date()
              .toISOString(),
          error:
            String(
              lastError?.message ||
              'all_providers_failed'
            ).slice(
              0,
              300
            )
        };
      }

      cacheChanged =
        true;

      continue;
    }

    for (
      const item
      of batch
    ) {
      const row =
        accepted.rows.get(
          item.id
        );

      const assessment = {
        policyVersion:
          SMART_EDITORIAL_POLICY_VERSION,

        revision:
          item.key,

        eligibleDestinations:
          item.eligibleDestinations,

        destination:
          row.destination,

        relevance:
          row.relevance,

        impact:
          row.impact,

        novelty:
          row.novelty,

        confidence:
          row.confidence,

        exclude:
          row.exclude,

        reason:
          row.reason,

        providerId:
          accepted
            .provider
            .id,

        model:
          accepted
            .provider
            .model,

        assessedAt:
          new Date()
            .toISOString()
      };

      applySmartEditorialAssessment(
        item.cluster,
        assessment
      );

      cache[item.key] = {
        createdAt:
          Date.now(),
        assessment
      };

      stats.assessed++;
      cacheChanged =
        true;
    }
  }

  stats.providerIds =
    [
      ...providerIds
    ];

  if (cacheChanged) {
    await db.put(
      'smartEditorialAssessmentCache',
      JSON.stringify(
        cache
      )
    );
  }

  return stats;
}

async function attemptProviderVerification(
  provider,
  group,
  keyManager,
  db
) {
  const reviewLimit =
    providerReviewArticleLimit(provider);

  if (
    Number.isFinite(reviewLimit) &&
    group.articles.length > reviewLimit
  ) {
    const error = new Error(
      `${provider.type === 'ollama' ? 'Local' : 'Online'} review group is too large: ${group.articles.length} > ${reviewLimit}`
    );
    error.code = 'GROUP_TOO_LARGE';
    error.nonProviderFault = true;

    return {
      valid: false,
      uncertain: true,
      skipped: true,
      error
    };
  }

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

    let parsed;
    try {
      parsed = await requestClusteringDecision({
        request: repairPrompt => callVerificationProvider(provider, group, keyManager, repairPrompt),
        validate: value => validatePartitionResult(value, group.articles),
        schema: PARTITION_RESPONSE_SCHEMA,
        onEvent: (event, error) => {
          group.diagnostics ||= {};
          group.diagnostics[event] = (group.diagnostics[event] || 0) + 1;
          if (group.metrics && event !== 'firstPassAiCalls') group.metrics[event] = (group.metrics[event] || 0) + 1;
          if (event === 'firstPassAiCalls' || event === 'repairAttempts') {
            group.onStage?.(
              event === 'repairAttempts' ? 'smart-ai-repair' : 'smart-ai',
              {
                providerId: provider.id,
                model: provider.model
              }
            );
          }
          console.log('[SMART JSON]', JSON.stringify({ provider: provider.id, model: provider.model,
            operation: 'cluster-verification', event, reason: error?.reason,
            ...(process.env.SMART_LOG_AI_DEBUG === 'true' && error?.rawResponse ? { raw: sanitizeProviderDiagnosticText(error.rawResponse, 2000).text } : {}) }));
        }
      });

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

      if (
        provider.type === 'antigravity' &&
        [
          'antigravity-low',
          'antigravity-medium',
          'antigravity-high'
        ].includes(provider.id) &&
        (
          modelWasUncertain ||
          splitClusters.length > 0
        )
      ) {
        const effort =
          provider.id === 'antigravity-low'
            ? 'Low'
            : provider.id === 'antigravity-medium'
              ? 'Medium'
              : 'High';
        const error =
          new Error(
            `${effort}-effort Antigravity decision requires next-provider review`
          );
        error.code =
          'ANTIGRAVITY_ESCALATION_REQUIRED';
        error.expectedEscalation = true;
        error.onlineAiUsage =
          parsed?.onlineAiUsage || null;
        throw error;
      }

      const lowConfidenceLiteMerges =
        provider.id ===
          'gemini-flash-lite'
          ? parsed.clusters.filter(
            cluster => {
              const articleIds =
                Array.isArray(
                  cluster?.articleIds
                )
                  ? cluster.articleIds
                  : [];
              const confidence =
                Number(
                  cluster?.confidence
                );

              return (
                articleIds.length > 1 &&
                (
                  !Number.isFinite(
                    confidence
                  ) ||
                  confidence < 0.9
                )
              );
            }
          )
          : [];

      if (
        provider.id ===
          'gemini-flash-lite' &&
        (
          modelWasUncertain ||
          splitClusters.length > 0 ||
          lowConfidenceLiteMerges
            .length > 0
        )
      ) {
        const error =
          new Error(
            'Flash-Lite decision requires stronger-model review'
          );

        error.code =
          'LITE_ESCALATION_REQUIRED';
        error.expectedEscalation =
          true;
        error.httpStatus =
          Number(
            parsed?.onlineAiUsage
              ?.httpStatus
          ) || 200;
        error.keyIndex =
          Number(
            parsed?.onlineAiUsage
              ?.keyIndex
          ) || null;
        error.onlineAiUsage =
          parsed?.onlineAiUsage ||
          null;

        throw error;
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
        provider.type === 'gemini' ||
        provider.type === 'antigravity'
      ) {
        console.log(
          '[ONLINE AI]',
          JSON.stringify({
            at:
              new Date()
                .toISOString(),
            provider:
              provider.type === 'antigravity'
                ? 'antigravity'
                : 'gemini',
            operation:
              'smart-clustering',
            providerId:
              provider.id,
            model:
              provider.model,
            status:
              'success',
            httpStatus:
              Number(
                parsed?.onlineAiUsage
                  ?.httpStatus
              ) || 200,
            keyIndex:
              Number(
                parsed?.onlineAiUsage
                  ?.keyIndex
              ) || null,
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
                : 0,
            promptTokens:
              Number(
                parsed?.onlineAiUsage
                  ?.promptTokens
              ) || 0,
            outputTokens:
              Number(
                parsed?.onlineAiUsage
                  ?.outputTokens
              ) || 0,
            totalTokens:
              Number(
                parsed?.onlineAiUsage
                  ?.totalTokens
              ) || 0,
            ...providerJsonDiagnosticFields(
              parsed?.jsonRepairDiagnostics
            )
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
        provider.type === 'gemini' ||
        provider.type === 'antigravity'
      ) {
        console.log(
          '[ONLINE AI]',
          JSON.stringify({
            at:
              new Date()
                .toISOString(),
            provider:
              provider.type === 'antigravity'
                ? 'antigravity'
                : 'gemini',
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
            error:
              String(
                error?.message ||
                error ||
                'Unknown Gemini error'
              )
                .replace(/\s+/g, ' ')
                .slice(0, 800),
            keyIndex:
              Number(
                error?.keyIndex
              ) || null,
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
                : 0,
            promptTokens:
              Number(
                error?.onlineAiUsage
                  ?.promptTokens
              ) || 0,
            outputTokens:
              Number(
                error?.onlineAiUsage
                  ?.outputTokens
              ) || 0,
            totalTokens:
              Number(
                error?.onlineAiUsage
                  ?.totalTokens
              ) || 0,
            ...providerJsonDiagnosticFields(
              (error?.originalRawResponse || error?.rawResponse || error?.repairAttempted)
                ? error
                : (parsed?.jsonRepairDiagnostics || error)
            )
          })
        );
      }

      if (error?.expectedEscalation) {
        console.info(
          `[SMART VERIFY FALLBACK] ${provider.id} ` +
          `model=${provider.model}: ` +
          `${error?.message || error}`
        );

        await recordProviderSuccess(
          db,
          provider
        );
      } else if (
        error?.code === 'GROUP_TOO_LARGE' ||
        error?.nonProviderFault === true
      ) {
        console.info(
          `[SMART VERIFY SKIP] ${provider.id} ` +
          `model=${provider.model}: ` +
          `${error?.message || error}`
        );
      } else {
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
      }

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
        error.repairAttempted || attempt >=
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

function componentVerificationCacheKey(group, units) {
  const payload = {
    kind: 'component-relationship-review-v1',
    components: units.map(unit => ({
      id: unit.id,
      articleIds: unit.articleIds,
      representativeTitle: unit.representativeTitle,
      representativeExcerpt: unit.representativeExcerpt,
      publishedFrom: unit.publishedFrom,
      publishedTo: unit.publishedTo,
      headlines: unit.headlines
    })),
    promptVersion: 'component-relationship-v3-generic-recovery',
    schemaVersion: 'component-relationship-v1',
    clusterVersion: SMART_CLUSTER_VERSION
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function getCachedComponentVerificationDecision(db, group, units) {
  if (!SMART_NEWS_AI_CONFIG.cache.enabled) return null;
  const cache = await getVerificationCache(db);
  const key = componentVerificationCacheKey(group, units);
  const entry = cache && typeof cache === 'object' ? cache[key] : null;
  if (!entry || group.forceRebuild) return null;

  const validation = validateComponentReviewResult(entry.result, units);
  if (!validation.valid || entry.result.uncertain) return null;
  const expanded = expandComponentReviewDecision(entry.result, units);
  const reviewArticles =
    group.fullRepartition && Array.isArray(group.reviewUniverse) && group.reviewUniverse.length
      ? group.reviewUniverse
      : group.articles;
  if (
    !validatePartitionResult({ clusters: expanded.clusters, uncertain: false }, reviewArticles).valid ||
    !postValidatePartition(expanded, reviewArticles)
  ) {
    return null;
  }

  return {
    providerId: entry.providerId,
    model: entry.model,
    verifiedAt: entry.verifiedAt,
    clusters: expanded.clusters,
    storyRelationships: expanded.storyRelationships
  };
}

async function setCachedComponentVerificationDecision(db, group, units, result, provider) {
  if (!SMART_NEWS_AI_CONFIG.cache.enabled) return;
  const validation = validateComponentReviewResult(result, units);
  if (!validation.valid || result.uncertain) return;

  verificationCacheWriteChain = verificationCacheWriteChain.catch(() => {}).then(async () => {
    const cache = await getVerificationCache(db);
    const key = componentVerificationCacheKey(group, units);
    cache[key] = {
      kind: 'component-relationship-review-v1',
      providerId: provider.id,
      model: provider.model,
      verifiedAt: new Date().toISOString(),
      createdAt: Date.now(),
      result: {
        exactEventGroups: result.exactEventGroups,
        relatedDevelopments: result.relatedDevelopments,
        uncertain: false
      }
    };
    await db.put('smartEventVerificationCache', JSON.stringify(cache));
  });

  try {
    await verificationCacheWriteChain;
  } catch (error) {
    console.error('[SMART] Failed to save component verification cache:', error.message);
  }
}

async function attemptComponentProviderVerification(
  provider,
  group,
  units,
  keyManager,
  db
) {
  const reviewLimit = providerReviewComponentLimit(provider);
  if (Number.isFinite(reviewLimit) && units.length > reviewLimit) {
    const error = new Error(
      `${provider.type === 'ollama' ? 'Local' : 'Online'} component review is too large: ${units.length} > ${reviewLimit}`
    );
    error.code = 'GROUP_TOO_LARGE';
    error.nonProviderFault = true;
    return { valid: false, uncertain: true, skipped: true, error };
  }

  const reviewArticles =
    group.fullRepartition && Array.isArray(group.reviewUniverse) && group.reviewUniverse.length
      ? group.reviewUniverse
      : group.articles;
  const reviewSpec = {
    componentReview: true,
    units,
    prompt: buildComponentReviewPrompt(units),
    schema: COMPONENT_REVIEW_RESPONSE_SCHEMA,
    operation: 'cluster-verification-components',
    maxOutputTokens: 4096
  };
  const maximumAttempts = Number(provider.maxRetries || 0) + 1;

  for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
    const attemptStartedAt = Date.now();
    await recordProviderAttempt(db, provider);
    let parsed;

    try {
      parsed = await requestClusteringDecision({
        request: repairPrompt =>
          callVerificationProvider(
            provider,
            group,
            keyManager,
            repairPrompt,
            reviewSpec
          ),
        validate: value => validateComponentReviewResult(value, units),
        schema: COMPONENT_REVIEW_RESPONSE_SCHEMA,
        onEvent: (event, error) => {
          group.diagnostics ||= {};
          group.diagnostics[event] = (group.diagnostics[event] || 0) + 1;
          if (group.metrics && event !== 'firstPassAiCalls') {
            group.metrics[event] = (group.metrics[event] || 0) + 1;
          }
          if (event === 'firstPassAiCalls' || event === 'repairAttempts') {
            group.onStage?.(
              event === 'repairAttempts' ? 'smart-ai-repair' : 'smart-ai',
              {
                providerId: provider.id,
                model: provider.model,
                reviewMode: 'components',
                reviewUnitCount: units.length,
                rawArticleCount: reviewArticles.length
              }
            );
          }
          console.log(
            '[SMART JSON]',
            JSON.stringify({
              provider: provider.id,
              model: provider.model,
              operation: 'cluster-verification-components',
              event,
              reason: error?.reason,
              reviewUnitCount: units.length
            })
          );
        }
      });

      const validation = validateComponentReviewResult(parsed, units);
      if (!validation.valid) {
        const error = new Error(`Invalid component review: ${validation.reason}`);
        error.code = 'INVALID_PARTITION';
        throw error;
      }

      const confidenceFloor =
        provider.id === 'antigravity-low'
          ? 0.95
          : provider.id === 'antigravity-medium'
            ? 0.925
            : 0.9;
      const weakSameEvent = parsed.exactEventGroups.some(
        exactGroup => exactGroup.componentIds.length > 1 && exactGroup.confidence < confidenceFloor
      );
      const weakRelationship = parsed.relatedDevelopments.some(
        relation => relation.confidence < confidenceFloor
      );

      if (parsed.uncertain || weakSameEvent || weakRelationship) {
        const isAntigravity = provider.type === 'antigravity';
        const effort =
          provider.id === 'antigravity-low'
            ? 'Low'
            : provider.id === 'antigravity-medium'
              ? 'Medium'
              : provider.id === 'antigravity-high'
                ? 'High'
                : null;
        const error = new Error(
          isAntigravity
            ? `${effort}-effort Antigravity component review requires next-provider review`
            : 'Component review is uncertain or below the safe confidence threshold'
        );
        error.code =
          isAntigravity
            ? 'ANTIGRAVITY_ESCALATION_REQUIRED'
            : 'COMPONENT_REVIEW_UNCERTAIN';
        error.expectedEscalation = true;
        error.onlineAiUsage = parsed?.onlineAiUsage || null;
        throw error;
      }

      const expanded = expandComponentReviewDecision(parsed, units);
      if (
        !validatePartitionResult(
          { clusters: expanded.clusters, uncertain: false },
          reviewArticles
        ).valid ||
        !postValidatePartition(expanded, reviewArticles)
      ) {
        const error = new Error('Component-level exact-event merge failed deterministic post-validation');
        error.code = 'POST_VALIDATION_FAILED';
        throw error;
      }

      await recordProviderSuccess(db, provider);

      if (provider.type === 'gemini' || provider.type === 'antigravity') {
        console.log(
          '[ONLINE AI]',
          JSON.stringify({
            at: new Date().toISOString(),
            provider: provider.type === 'antigravity' ? 'antigravity' : 'gemini',
            operation: 'smart-component-review',
            providerId: provider.id,
            model: provider.model,
            status: 'success',
            durationMs: Date.now() - attemptStartedAt,
            groupId: group?.id || null,
            articleCount: reviewArticles.length,
            componentCount: units.length,
            exactEventGroupCount: expanded.clusters.length,
            relatedDevelopmentCount: expanded.storyRelationships.length,
            promptTokens: Number(parsed?.onlineAiUsage?.promptTokens) || 0,
            outputTokens: Number(parsed?.onlineAiUsage?.outputTokens) || 0,
            totalTokens: Number(parsed?.onlineAiUsage?.totalTokens) || 0
          })
        );
      }

      return {
        valid: true,
        uncertain: false,
        clusters: expanded.clusters,
        storyRelationships: expanded.storyRelationships,
        componentDecision: {
          exactEventGroups: parsed.exactEventGroups,
          relatedDevelopments: parsed.relatedDevelopments,
          uncertain: false
        },
        reviewMode: 'components'
      };
    } catch (error) {
      if (provider.type === 'gemini' || provider.type === 'antigravity') {
        console.log(
          '[ONLINE AI]',
          JSON.stringify({
            at: new Date().toISOString(),
            provider: provider.type === 'antigravity' ? 'antigravity' : 'gemini',
            operation: 'smart-component-review',
            providerId: provider.id,
            model: provider.model,
            status: 'failed',
            errorCode: String(error?.code || error?.name || 'UNKNOWN').slice(0, 80),
            error: String(error?.message || error || 'Unknown component review error').replace(/\s+/g, ' ').slice(0, 800),
            durationMs: Date.now() - attemptStartedAt,
            groupId: group?.id || null,
            articleCount: reviewArticles.length,
            componentCount: units.length,
            promptTokens: Number(error?.onlineAiUsage?.promptTokens) || 0,
            outputTokens: Number(error?.onlineAiUsage?.outputTokens) || 0,
            totalTokens: Number(error?.onlineAiUsage?.totalTokens) || 0
          })
        );
      }

      if (error?.expectedEscalation) {
        console.info(
          `[SMART VERIFY FALLBACK] ${provider.id} model=${provider.model}: ${error?.message || error}`
        );
        await recordProviderSuccess(db, provider);
      } else if (error?.code === 'GROUP_TOO_LARGE' || error?.nonProviderFault === true) {
        console.info(
          `[SMART VERIFY SKIP] ${provider.id} model=${provider.model}: ${error?.message || error}`
        );
      } else {
        console.warn(
          `[SMART VERIFY] ${provider.id} model=${provider.model} component review failed: ${error?.message || error}`
        );
        await recordProviderError(db, provider, error);
      }

      if (
        provider.type === 'gemini' &&
        keyManager?.reportError &&
        !isModelOutputError(error)
      ) {
        keyManager.reportError(error);
      }

      if (
        error.repairAttempted ||
        attempt >= maximumAttempts ||
        !isTransientProviderError(error)
      ) {
        return { valid: false, uncertain: true, error };
      }

      await sleep(1000 * attempt);
    }
  }

  return {
    valid: false,
    uncertain: true,
    error: new Error('Component provider attempts exhausted')
  };
}

async function verifyComponentReviewWithProviderChain(
  group,
  units,
  providers,
  keyManager,
  db
) {
  const cached = await getCachedComponentVerificationDecision(db, group, units);
  if (cached) {
    if (group.metrics) {
      group.metrics.verificationCacheHits++;
      group.metrics.cachedDecisionsReused++;
    }
    console.log(
      '[SMART VERIFY COMPONENT CACHE HIT]',
      JSON.stringify({
        groupId: group?.id || null,
        articleCount: group.articles.length,
        componentCount: units.length,
        providerId: cached.providerId || null,
        model: cached.model || null
      })
    );
    return {
      valid: true,
      uncertain: false,
      providerId: cached.providerId,
      model: cached.model,
      clusters: cached.clusters,
      storyRelationships: cached.storyRelationships || [],
      verifiedAt: cached.verifiedAt,
      attemptedProviders: [],
      resolution: 'cached',
      reviewMode: 'components',
      reviewUnitCount: units.length
    };
  }

  if (group.metrics) group.metrics.verificationCacheMisses++;

  const eligibleProviders = providers.filter(provider => {
    const limit = providerReviewComponentLimit(provider);
    return !Number.isFinite(limit) || units.length <= limit;
  });
  const skippedProviders = providers.filter(provider => !eligibleProviders.includes(provider));

  if (skippedProviders.length) {
    console.info(
      '[SMART VERIFY COMPONENT SIZE GUARD]',
      JSON.stringify({
        groupId: group?.id || null,
        articleCount: group.articles.length,
        componentCount: units.length,
        skippedProviders: skippedProviders.map(provider => ({
          providerId: provider.id,
          model: provider.model,
          limit: providerReviewComponentLimit(provider)
        }))
      })
    );
  }

  if (!eligibleProviders.length) {
    if (group.metrics) {
      group.metrics.groupsSkippedTooLarge = (group.metrics.groupsSkippedTooLarge || 0) + 1;
    }
    return {
      valid: true,
      uncertain: true,
      providerId: null,
      model: null,
      attemptedProviders: [],
      skippedProviders: skippedProviders.map(provider => ({
        providerId: provider.id,
        model: provider.model,
        limit: providerReviewComponentLimit(provider)
      })),
      resolution: 'deferred',
      reviewMode: 'components',
      reviewUnitCount: units.length,
      fallbackReason: 'component_group_too_large',
      clusters: [],
      storyRelationships: []
    };
  }

  const attemptedProviders = [];
  let allowAntigravityEscalation = false;

  for (const provider of eligibleProviders) {
    if (
      provider.type === 'antigravity' &&
      provider.id !== 'antigravity-low' &&
      !allowAntigravityEscalation
    ) {
      /*
       * Medium/high effort is reserved for explicit model uncertainty.
       * Ordinary Antigravity failure goes directly to the API backup.
       */
      continue;
    }

    if (attemptedProviders.length && group.metrics) {
      group.metrics.fallbackProviderAttempts++;
    }
    group.isFallback = attemptedProviders.length > 0;
    group.onStage?.(
      group.isFallback ? 'smart-ai-fallback' : 'smart-ai',
      {
        providerId: provider.id,
        model: provider.model,
        providerAttempt: attemptedProviders.length + 1,
        providerTotal: eligibleProviders.length,
        reviewMode: 'components',
        reviewUnitCount: units.length,
        rawArticleCount: group.articles.length
      }
    );
    attemptedProviders.push(provider.id);

    const result = await attemptComponentProviderVerification(
      provider,
      group,
      units,
      keyManager,
      db
    );

    if (
      provider.type === 'antigravity'
    ) {
      /*
       * Only explicit uncertainty is allowed to unlock the next
       * Antigravity effort level. Any ordinary failure resets escalation,
       * so the next provider considered is the API backup.
       */
      allowAntigravityEscalation =
        result?.error?.code ===
        'ANTIGRAVITY_ESCALATION_REQUIRED';
    }



    if (result.valid && !result.uncertain) {
      if (group.metrics) {
        group.metrics.successfulVerificationDecisions++;
        if (attemptedProviders.length > 1) group.metrics.fallbackProviderSuccesses++;
      }
      if (result.componentDecision) {
        await setCachedComponentVerificationDecision(
          db,
          group,
          units,
          result.componentDecision,
          provider
        );
      }
      return {
        valid: true,
        uncertain: false,
        providerId: provider.id,
        model: provider.model,
        clusters: result.clusters,
        storyRelationships: result.storyRelationships || [],
        verifiedAt: new Date().toISOString(),
        attemptedProviders,
        resolution: 'verified',
        reviewMode: 'components',
        reviewUnitCount: units.length
      };
    }
  }

  if (group.metrics) group.metrics.allProviderFailures++;
  return {
    valid: true,
    uncertain: true,
    providerId: null,
    model: null,
    attemptedProviders,
    resolution: 'deferred',
    reviewMode: 'components',
    reviewUnitCount: units.length,
    fallbackReason: 'component_review_failed_or_uncertain',
    clusters: [],
    storyRelationships: []
  };
}

function normalizedVerificationArticles(articles) {
  return articles.map(article => ({ id: getArticleId(article), title: article.title,
    description: String(article.content || '').slice(0, 600), source: article.feedTitle,
    domain: article.domain, language: article.language || detectArticleLanguage(article),
    category: article.smartCategory, publishedAt: article.pubDate
  })).sort((a, b) => a.id.localeCompare(b.id));
}

export function verificationCacheKey(
  group,
  providers
) {
  const payload = {
    articles:
      normalizedVerificationArticles(
        group.articles
      ),

    /*
     * Do not include the current enabled provider stack.
     * Gemini key availability and provider order can change between
     * refreshes without changing the correctness of cached results.
     */
    verificationCacheKeyVersion:
      'effective-input-v2',

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

export async function getCachedVerificationDecision(
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

  const entry = cache && typeof cache === 'object' ? cache[key] : null;

  if (group.forceRebuild && entry) {
    if (group.metrics) { group.metrics.cachedDecisionsInvalidated++; group.metrics.invalidationReason = 'explicit_force_rebuild'; }
    return null;
  }
  if (!entry) return null;

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
    if (group.metrics) { group.metrics.cachedDecisionsInvalidated++; group.metrics.invalidationReason = 'cached_decision_failed_validation'; }
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

export async function setCachedVerificationDecision(
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

  if (!validatePartitionResult({ clusters: result.clusters, uncertain: result.uncertain }, group.articles).valid || result.uncertain || !postValidatePartition(result, group.articles)) return;

  verificationCacheWriteChain =
    verificationCacheWriteChain.catch(() => {}).then(
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
          result: {
            clusters:
              result.clusters,
            uncertain: false
          }
        };

        await db.put(
          'smartEventVerificationCache',
          JSON.stringify(
            cache
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

export async function verifyWithProviderChain(
  group,
  providers,
  keyManager,
  db
) {
  const articleEligibleProviders = providers.filter(provider => {
    const limit = providerReviewArticleLimit(provider);
    return !Number.isFinite(limit) || group.articles.length <= limit;
  });

  if (providers.length && !articleEligibleProviders.length) {
    const componentUnits = buildComponentReviewUnits(group);
    if (componentUnits.length) {
      console.info(
        '[SMART VERIFY COMPONENT REVIEW]',
        JSON.stringify({
          groupId: group?.id || null,
          articleCount: group.articles.length,
          componentCount: componentUnits.length
        })
      );
      return verifyComponentReviewWithProviderChain(
        group,
        componentUnits,
        providers,
        keyManager,
        db
      );
    }
  }

  const cached =
    await getCachedVerificationDecision(
      db,
      group,
      providers
    );

  if (cached) {
    if (group.metrics) { group.metrics.verificationCacheHits++; group.metrics.cachedDecisionsReused++; }
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

  if (group.metrics) group.metrics.verificationCacheMisses++;
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

  const failureKey = verificationCacheKey(group, providers) + ':' + providers.map(p => `${p.id}:${p.model}`).join('|');
  const failures = (await db.get('smartVerificationFailures', { type: 'json' })) || {};
  const failureRetryMs = Math.max(
    5 * 60 * 1000,
    Math.min(
      24 * 60 * 60 * 1000,
      Number(process.env.SMART_VERIFY_FAILURE_RETRY_MS) || 30 * 60 * 1000
    )
  );
  const previousFailureRecord = failures[failureKey];
  const previousFailureAt = Date.parse(previousFailureRecord?.at || '');
  const previousFailure =
    !group.forceRebuild &&
    previousFailureRecord &&
    Number.isFinite(previousFailureAt) &&
    Date.now() - previousFailureAt < failureRetryMs;
  const attemptedProviders = [];
  const eligibleProviders =
    providers.filter(
      provider => {
        const limit =
          providerReviewArticleLimit(provider);
        return (
          !Number.isFinite(limit) ||
          group.articles.length <= limit
        );
      }
    );

  const skippedProviders =
    providers.filter(
      provider =>
        !eligibleProviders.includes(provider)
    );

  if (skippedProviders.length) {
    console.info(
      '[SMART VERIFY SIZE GUARD]',
      JSON.stringify({
        groupId: group?.id || null,
        articleCount:
          group.articles.length,
        skippedProviders:
          skippedProviders.map(
            provider => ({
              providerId: provider.id,
              model: provider.model,
              limit:
                providerReviewArticleLimit(
                  provider
                )
            })
          )
      })
    );
  }

  if (
    !previousFailure &&
    providers.length &&
    !eligibleProviders.length
  ) {
    if (group.metrics) {
      group.metrics.groupsSkippedTooLarge =
        (group.metrics.groupsSkippedTooLarge || 0) + 1;
    }

    return {
      valid: true,
      uncertain: true,
      providerId: null,
      model: null,
      attemptedProviders,
      skippedProviders:
        skippedProviders.map(
          provider => ({
            providerId: provider.id,
            model: provider.model,
            limit:
              providerReviewArticleLimit(
                provider
              )
          })
        ),
      resolution: 'deferred',
      fallbackReason: 'group_too_large',
      clusters: []
    };
  }

  let allowAntigravityEscalation = false;

  for (const provider of previousFailure ? [] : eligibleProviders) {
    if (
      provider.type === 'antigravity' &&
      provider.id !== 'antigravity-low' &&
      !allowAntigravityEscalation
    ) {
      /*
       * Medium/high effort is reserved for explicit model uncertainty.
       * Ordinary Antigravity failure goes directly to the API backup.
       */
      continue;
    }

    const providerAttempt = attemptedProviders.length + 1;
    if (attemptedProviders.length) {
      if (group.metrics) group.metrics.fallbackProviderAttempts++;
    }
    group.isFallback = attemptedProviders.length > 0;
    group.onStage?.(
      group.isFallback ? 'smart-ai-fallback' : 'smart-ai',
      {
        providerId: provider.id,
        model: provider.model,
        providerAttempt,
        providerTotal: eligibleProviders.length
      }
    );
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
      provider.type === 'antigravity'
    ) {
      /*
       * Only explicit uncertainty is allowed to unlock the next
       * Antigravity effort level. Any ordinary failure resets escalation,
       * so the next provider considered is the API backup.
       */
      allowAntigravityEscalation =
        result?.error?.code ===
        'ANTIGRAVITY_ESCALATION_REQUIRED';
    }



    if (
      result.valid &&
      !result.uncertain &&
      result.postValidationPassed
    ) {
      if (group.metrics) { group.metrics.successfulVerificationDecisions++; if (attemptedProviders.length > 1) group.metrics.fallbackProviderSuccesses++; }
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

      if (failures[failureKey]) { delete failures[failureKey]; await db.put('smartVerificationFailures', JSON.stringify(failures)); }
      await setCachedVerificationDecision(
        db,
        group,
        providers,
        finalResult
      );

      return finalResult;
    }
  }

  if (!previousFailure) { failures[failureKey] = { at: new Date().toISOString(), reason: 'all_providers_failed_or_uncertain' }; await db.put('smartVerificationFailures', JSON.stringify(failures)); }
  if (group.metrics) group.metrics.allProviderFailures++;
  return {
    valid: true,
    uncertain: true,
    providerId: null,
    model: null,
    attemptedProviders,
    skippedProviders:
      skippedProviders.map(provider => ({
        providerId: provider.id,
        model: provider.model,
        limit: providerReviewArticleLimit(provider)
      })),
    // Provider unavailability or model uncertainty is not a clustering
    // decision. Preserve deterministic components, persist the review request
    // for a later attempt, and continue with the rest of the refresh.
    resolution: 'deferred',
    reviewMode: 'articles',
    reviewUnitCount: group.articles.length,
    fallbackReason:
      providers.length
        ? (
          eligibleProviders.length
            ? 'all_providers_failed_or_uncertain'
            : 'group_too_large'
        )
        : 'no_provider_configured',
    clusters: []
  };
}

// Compare a new article with a stable event anchor; expand only structural ambiguity.
export function prepareIncrementalReviewGroups(groups, automatic) {
  const owner = new Map();
  const articleById = new Map();

  automatic.forEach((group, index) => {
    group.articles.forEach(article => {
      const articleId = getArticleId(article);
      owner.set(articleId, index);
      articleById.set(articleId, article);
    });
  });

  for (const group of groups) {
    for (const article of group.articles || []) {
      articleById.set(getArticleId(article), article);
    }
  }

  const uniqueArticles = articles =>
    [...new Map(
      (articles || []).map(article => [getArticleId(article), article])
    ).values()];

  const dedupeComponents = components => {
    const result = [];
    const seen = new Set();
    for (const component of components || []) {
      const articles = uniqueArticles(component).sort((left, right) =>
        getArticleId(left).localeCompare(getArticleId(right))
      );
      if (!articles.length) continue;
      const key = articles.map(getArticleId).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(articles);
    }
    return result;
  };

  const result = groups.map(group => {
    const originalArticles = uniqueArticles(group.articles || []);
    const storedComponents = Array.isArray(group.deterministicComponents)
      ? group.deterministicComponents.map(componentIds =>
        (componentIds || [])
          .map(articleId => articleById.get(articleId))
          .filter(Boolean)
      )
      : [];
    const affected = [...new Set(originalArticles.map(article => owner.get(getArticleId(article))))]
      .filter(index => index !== undefined);
    const affectedComponents = affected.map(index => automatic[index].articles);
    const established = affected.filter(index => automatic[index].established || automatic[index].articles.length > 1);
    const conflict = established.some(index => automatic[index].articles.some(member =>
      originalArticles.some(article => owner.get(getArticleId(article)) !== index && detectEventConflicts(member, article).hasHardConflict)));
    const fullRepartition = established.length > 1 || conflict;
    const articles = fullRepartition ? affected.flatMap(index => automatic[index].articles) : affected.flatMap(index => {
      const component = automatic[index];
      if (!established.includes(index)) return component.articles;
      return [component.articles.slice().sort((a, b) => getArticleId(a).localeCompare(getArticleId(b)))[0]];
    });
    const deferredComponents = dedupeComponents([
      ...storedComponents,
      ...affectedComponents
    ]);
    const reviewUniverse = uniqueArticles([
      ...originalArticles,
      ...deferredComponents.flat()
    ]);

    return {
      ...group,
      articles: articles.length ? uniqueArticles(articles) : originalArticles,
      fullRepartition,
      deferredComponents:
        deferredComponents.length
          ? deferredComponents
          : originalArticles.map(article => [article]),
      reviewUniverse
    };
  });

  // Structural groups sharing a component must be partitioned together.
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length;) {
      const ids = new Set(result[i].articles.map(getArticleId));
      if ((result[i].fullRepartition || result[j].fullRepartition) && result[j].articles.some(a => ids.has(getArticleId(a)))) {
        const merged = new Map([...result[i].articles, ...result[j].articles].map(a => [getArticleId(a), a]));
        const touched = new Set(
          [...merged.keys()]
            .map(id => owner.get(id))
            .filter(index => index !== undefined)
        );
        const touchedArticles = [...touched].flatMap(index => automatic[index].articles);
        const deferredComponents = dedupeComponents([
          ...(result[i].deferredComponents || []),
          ...(result[j].deferredComponents || []),
          ...[...touched].map(index => automatic[index].articles)
        ]);
        const reviewUniverse = uniqueArticles([
          ...(result[i].reviewUniverse || []),
          ...(result[j].reviewUniverse || []),
          ...touchedArticles,
          ...deferredComponents.flat()
        ]);
        result[i] = {
          ...result[i],
          fullRepartition: true,
          articles: touchedArticles.length ? uniqueArticles(touchedArticles) : uniqueArticles([...merged.values()]),
          deferredComponents,
          reviewUniverse
        };
        result.splice(j, 1);
        i = -1;
        break;
      } else {
        j++;
      }
    }
  }

  return result.map(group => ({
    ...group,
    id: createGroupId(group.articles)
  }));
}

export function integrateIncrementalReviews(automatic, reviewed, requests) {
  const broadIds = new Set(
    requests
      .filter(group => group.fullRepartition)
      .flatMap(group => (group.reviewUniverse || group.articles).map(getArticleId))
  );
  let groups = automatic.map(group => ({ ...group, articles: group.articles.filter(a => !broadIds.has(getArticleId(a))) })).filter(g => g.articles.length);
  for (const partition of reviewed) {
    if (partition.verification?.method === 'deferred') {
      const deferredIds = new Set(partition.articles.map(getArticleId));
      groups = groups.filter(group =>
        !group.articles.some(article => deferredIds.has(getArticleId(article)))
      );
      groups.push(partition);
      continue;
    }
    if (partition.articles.some(a => broadIds.has(getArticleId(a)))) { groups.push(partition); continue; }
    // A negative pair decision leaves both automatic components intact.
    if (partition.articles.length < 2) continue;
    const ids = new Set(partition.articles.map(getArticleId));
    const touched = groups.filter(g => g.articles.some(a => ids.has(getArticleId(a))));
    const members = [...new Map(touched.flatMap(g => g.articles).map(a => [getArticleId(a), a])).values()];
    const proposed = { clusters: [{ articleIds: members.map(getArticleId) }], uncertain: false };
    if (!postValidatePartition(proposed, members)) {
      const error = new Error('Incremental match conflicts with established event; retaining previous clusters.');
      error.code = 'CLUSTER_VERIFICATION_UNRESOLVED'; throw error;
    }
    groups = groups.filter(g => !touched.includes(g));
    groups.push({ ...partition, articles: members });
  }
  // Do not turn an explicit AI separation into a merge through a different pair.
  for (const request of requests) {
    const partitions = reviewed.filter(partition => partition.reviewRequestId === request.id);
    if (
      partitions.length &&
      partitions.every(partition => partition.verification?.method === 'deferred')
    ) {
      continue;
    }
    const partitionById = new Map();
    partitions.forEach((partition, index) => partition.articles.forEach(article => partitionById.set(getArticleId(article), index)));
    if (groups.some(group => new Set(group.articles.map(article => partitionById.get(getArticleId(article))).filter(index => index !== undefined)).size > 1)) {
      const error = new Error('Affected comparisons disagree; retaining the last valid event state.');
      error.code = 'CLUSTER_VERIFICATION_UNRESOLVED'; throw error;
    }
  }
  return groups;
}

async function reviewAmbiguousEventGroups(
  ambiguousGroups,
  providers,
  keyManager,
  db,
  onProgress = null,
  onGroupResolved = null
) {
  const resolvedGroups = [];

  const statistics = {
    ambiguousGroupsTotal:
      ambiguousGroups.length,
    ambiguousGroupsVerified: 0,
    ambiguousGroupsFromCache: 0,
    ambiguousGroupsKeptSeparate: 0,
    ambiguousGroupsDeferred: 0,
    memoryPressureDeferredGroups: 0,
    reviewedArticleCount: 0,
    allProvidersFailedCount: 0,
    providerRequests: {},
    deferredGroups: [],
    storyRelationships: [],
    groupResults: []
  };

  const configuredHeapDeferMb = Number(
    process.env.SMART_AI_REVIEW_HEAP_DEFER_MB
  );
  const heapLimitBytes = Number(getHeapStatistics().heap_size_limit) || (4 * 1024 * 1024 * 1024);
  const heapDeferBytes =
    Number.isFinite(configuredHeapDeferMb) && configuredHeapDeferMb > 0
      ? configuredHeapDeferMb * 1024 * 1024
      : Math.floor(heapLimitBytes * 0.65);
  let deferRemainingForMemoryPressure = false;

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
      const current = index + 1;
      const remaining = Math.max(
        0,
        ambiguousGroups.length - current
      );
      onProgress({
        stage: 'smart-ai',
        message:
          `Smart Verify · Group ${current}/${ambiguousGroups.length} · ${remaining} remaining · checking cache`,
        current,
        total: ambiguousGroups.length,
        remaining,
        reviewGroupId: group.id,
        reviewArticleCount: group.articles.length
      });
    }

    const resolvedStartIndex = resolvedGroups.length;

    if (!deferRemainingForMemoryPressure) {
      let memory = process.memoryUsage();
      if (
        memory.heapUsed >= heapDeferBytes &&
        typeof global.gc === 'function'
      ) {
        global.gc();
        memory = process.memoryUsage();
      }

      if (memory.heapUsed >= heapDeferBytes) {
        deferRemainingForMemoryPressure = true;
        console.warn(
          '[SMART MEMORY] ai-review-pressure',
          JSON.stringify({
            completedGroups: index,
            totalGroups: ambiguousGroups.length,
            remainingGroups: ambiguousGroups.length - index,
            rssMB: Math.round(memory.rss / 1024 / 1024),
            heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
            heapLimitMB: Math.round(heapLimitBytes / 1024 / 1024),
            deferThresholdMB: Math.round(heapDeferBytes / 1024 / 1024)
          })
        );
      }
    }

    const result = deferRemainingForMemoryPressure
      ? {
        valid: true,
        uncertain: true,
        providerId: null,
        model: null,
        attemptedProviders: [],
        skippedProviders: [],
        resolution: 'deferred',
        reviewMode:
          Array.isArray(group.deferredComponents) && group.deferredComponents.length
            ? 'components'
            : 'articles',
        reviewUnitCount:
          Array.isArray(group.deferredComponents) && group.deferredComponents.length
            ? group.deferredComponents.length
            : group.articles.length,
        fallbackReason: 'memory_pressure',
        clusters: []
      }
      : await verifyWithProviderChain(
        group,
        providers,
        keyManager,
        db
      );

    if (result.fallbackReason === 'memory_pressure') {
      statistics.memoryPressureDeferredGroups++;
    }

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
    } else if (
      result.resolution ===
      'deferred'
    ) {
      statistics
        .ambiguousGroupsDeferred++;
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
      successfulModel:
        result.model,
      resolution:
        result.resolution,
      fallbackReason:
        result.fallbackReason || null,
      reviewMode:
        result.reviewMode || 'articles',
      reviewUnitCount:
        result.reviewUnitCount || group.articles.length,
      relatedDevelopmentCount:
        Array.isArray(result.storyRelationships)
          ? result.storyRelationships.length
          : 0
    });

    if (Array.isArray(result.storyRelationships) && result.storyRelationships.length) {
      statistics.storyRelationships.push(
        ...result.storyRelationships.map(relationship => ({
          ...relationship,
          reviewGroupId: group.id,
          providerId: result.providerId,
          model: result.model,
          verifiedAt: result.verifiedAt
        }))
      );
    }

    if (result.resolution === 'deferred') {
      const deferredPartitions = deferredReviewPartitions(
        group,
        result.fallbackReason || 'group_too_large'
      );
      resolvedGroups.push(...deferredPartitions);

      console.warn(
        '[SMART VERIFY DEFERRED]',
        JSON.stringify({
          groupId: group.id,
          articleCount: (group.reviewUniverse || group.articles).length,
          componentCount: deferredPartitions.length,
          reason: result.fallbackReason || 'group_too_large'
        })
      );

      statistics.deferredGroups.push({
        groupId: group.id,
        reason: result.fallbackReason || 'group_too_large',
        articleIds: (group.reviewUniverse || group.articles).map(getArticleId).sort(),
        components: deferredPartitions.map(partition => partition.articles.map(getArticleId).sort()),
        fullRepartition: group.fullRepartition === true,
        deferredAt: new Date().toISOString(),
        skippedProviders: result.skippedProviders || []
      });

      if (onProgress) {
        onProgress({
          stage: 'smart-ai',
          message:
            `Smart Verify ${index + 1}/${ambiguousGroups.length} · ${Math.max(0, ambiguousGroups.length - index - 1)} remaining · deferred; deterministic components retained`,
          current: index + 1,
          total: ambiguousGroups.length,
          reviewGroupId: group.id,
          reviewArticleCount: group.articles.length,
          reviewResolution: 'deferred'
        });
      }
    }

    for (
      const partition
      of result.clusters
    ) {
      const partitionSet =
        new Set(
          partition.articleIds
        );

      const partitionArticles =
        (result.reviewMode === 'components'
          ? (group.reviewUniverse || group.articles)
          : group.articles
        ).filter(
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
        reviewRequestId: group.id,
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

    const resolvedForGroup = resolvedGroups.slice(
      resolvedStartIndex
    );

    if (onProgress) {
      const remaining = Math.max(
        0,
        ambiguousGroups.length - index - 1
      );
      onProgress({
        stage: 'smart-ai',
        message:
          `Smart Verify ${index + 1}/${ambiguousGroups.length} complete · ${remaining} remaining · result: ${result.resolution}`,
        current: index + 1,
        total: ambiguousGroups.length,
        remaining,
        reviewGroupId: group.id,
        reviewArticleCount: group.articles.length,
        reviewResolution: result.resolution,
        providerId: result.providerId || null,
        model: result.model || null
      });
    }

    if (typeof onGroupResolved === 'function') {
      await onGroupResolved({
        index,
        group,
        result,
        resolvedForGroup,
        resolvedGroups,
        statistics
      });
    }

    if (
      result.resolution !== 'verified' &&
      result.resolution !== 'cached' &&
      result.resolution !== 'deferred'
    ) {
      console.warn(
        '[SMART VERIFY] Stopping remaining ambiguous reviews after unresolved group',
        JSON.stringify({
          groupId: group.id,
          articleCount: group.articles.length,
          reason:
            result.fallbackReason ||
            'all_providers_failed_or_uncertain',
          remainingGroups:
            Math.max(
              0,
              ambiguousGroups.length - index - 1
            )
        })
      );

      if (typeof global.gc === 'function') {
        global.gc();
      }

      break;
    }

    if ((index + 1) % 10 === 0 && typeof global.gc === 'function') {
      global.gc();
      const memory = process.memoryUsage();
      console.log(
        '[SMART MEMORY] ai-review-progress',
        JSON.stringify({
          completedGroups: index + 1,
          totalGroups: ambiguousGroups.length,
          rssMB: Math.round(memory.rss / 1024 / 1024),
          heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024)
        })
      );
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

function mergeRelatedDevelopmentRelationships(
  storedRelationships = [],
  reviewRelationships = []
) {
  const relationshipKey = relationship => {
    const left = [...(relationship.leftArticleIds || [])]
      .sort()
      .join('|');
    const right = [...(relationship.rightArticleIds || [])]
      .sort()
      .join('|');
    return [left, right].sort().join('::');
  };

  const relationships = new Map();
  for (const relationship of [
    ...storedRelationships,
    ...reviewRelationships
  ]) {
    if (relationship?.type === 'related_development') {
      relationships.set(
        relationshipKey(relationship),
        relationship
      );
    }
  }

  return [...relationships.values()];
}

function deferredReviewPartitions(
  group,
  reason = 'verification_pending'
) {
  const deferredComponents =
    Array.isArray(group?.deferredComponents) &&
    group.deferredComponents.length
      ? group.deferredComponents
      : (group?.reviewUniverse || group?.articles || [])
        .map(article => [article]);

  return deferredComponents
    .filter(component => component?.length)
    .map(component => ({
      reviewRequestId: group.id,
      id: createGroupId(component),
      articles: component,
      verified: false,
      providerId: null,
      model: null,
      verifiedAt: null,
      verification: {
        method: 'deferred',
        reason
      }
    }));
}

export function buildPublicationClusterSnapshot({
  candidates,
  autoMergedClusters,
  reviewedClusters,
  reviewGroups,
  clusterVersionChanged,
  existingClusters,
  isTargeted,
  targetCategory,
  storyIdRetentionClusters,
  storyRelationships = []
}) {
  const rawGroups = integrateIncrementalReviews(
    autoMergedClusters,
    reviewedClusters,
    reviewGroups
  );

  assertEveryCandidateAppearsExactlyOnce(
    candidates,
    rawGroups
  );

  const newClusters = rawGroups
    .map(group =>
      buildCluster(
        group.articles,
        {
          validated: true,
          verification: group.verification
        }
      )
    )
    .filter(Boolean);

  const currentLinks = new Set(
    candidates.map(article => article.link)
  );
  const sevenDaysAgo = Date.now() - 7 * DAY_MS;

  const untouchedOldClusters = clusterVersionChanged
    ? []
    : existingClusters
      .filter(cluster => {
        const links = getClusterArticleLinks(cluster);

        // Candidate identity wins before targeted-category preservation.
        if ([...links].some(link => currentLinks.has(link))) {
          return false;
        }

        if (
          isTargeted &&
          targetCategory &&
          cluster.smartCategory !== targetCategory
        ) {
          return true;
        }

        const latestCoverageAt =
          getLatestClusterCoverageTime(cluster);
        return (
          Number.isFinite(latestCoverageAt) &&
          latestCoverageAt >= sevenDaysAgo
        );
      })
      // This repair pass is for retained historical clusters. Newly built
      // groups have already passed the current membership invariant.
      .map(cleanStoredCluster)
      .filter(Boolean);

  let clusters = [
    ...untouchedOldClusters,
    ...newClusters
  ];

  clusters.sort(
    (left, right) =>
      Number(right.hotness || 0) -
        Number(left.hotness || 0) ||
      Number(right.sourceWeight || 1) -
        Number(left.sourceWeight || 1) ||
      safeDate(right.pubDate) -
        safeDate(left.pubDate)
  );

  clusters = retainStoryIds(
    clusters,
    storyIdRetentionClusters
  );

  const activeRelationshipArticleIds = new Set(
    clusters.flatMap(cluster =>
      [cluster, ...(cluster.relatedArticles || [])]
        .map(getArticleId)
    )
  );

  const activeRelationships = storyRelationships.filter(
    relationship =>
      (relationship.leftArticleIds || []).some(
        articleId => activeRelationshipArticleIds.has(articleId)
      ) &&
      (relationship.rightArticleIds || []).some(
        articleId => activeRelationshipArticleIds.has(articleId)
      )
  );

  clusters = attachBroaderStoryMetadata(
    clusters,
    activeRelationships
  );

  for (const cluster of clusters) {
    if (cluster) delete cluster._vec;
    if (Array.isArray(cluster?.relatedArticles)) {
      for (const article of cluster.relatedArticles) {
        delete article._vec;
      }
    }
  }

  const publishedCounts = new Map();
  for (const cluster of clusters) {
    for (const article of [
      cluster,
      ...(cluster.relatedArticles || [])
    ]) {
      const id = getArticleId(article);
      publishedCounts.set(
        id,
        (publishedCounts.get(id) || 0) + 1
      );
    }
  }

  if (
    candidates.some(
      article =>
        publishedCounts.get(getArticleId(article)) !== 1
    ) ||
    [...publishedCounts.values()].some(count => count !== 1)
  ) {
    throw new Error(
      'Final clustering snapshot failed membership validation; previous state retained.'
    );
  }

  return {
    clusters,
    currentLinks,
    storyRelationships: activeRelationships
  };
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

  if ('smartClusters' in values) throw new Error('Atomic clustering persistence is unavailable; previous state retained.');
  for (
    const [key, value]
    of Object.entries(values)
  ) {
    await db.put(key, value);
  }
}

function hasOnlyOpenCliFetchMethod(methods) {
  if (!Array.isArray(methods)) return false;
  const normalized = [
    ...new Set(
      methods
        .map(method => String(method || '').trim().toLowerCase())
        .filter(Boolean)
    )
  ];
  return normalized.length === 1 && normalized[0] === 'opencli';
}

function smartArticleIdentity(article) {
  const value = String(article?.link || article?.url || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href;
  } catch (error) {
    return value;
  }
}

async function prefetchOpenCliOnlySmartArticles(results, helpers) {
  if (typeof helpers?.prefetchOpenCliOnlyArticles !== 'function') return;
  const jobs = [];
  for (const result of results || []) {
    if (!hasOnlyOpenCliFetchMethod(result?.source?.fetchMethods)) continue;
    const articlesToPrefetch = (result.articles || []).filter(smartArticleIdentity);
    if (articlesToPrefetch.length) {
      jobs.push(helpers.prefetchOpenCliOnlyArticles(articlesToPrefetch, result.source.url));
    }
  }
  await Promise.all(jobs);
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

  // The engine schedules its first clustering refresh shortly after startup.
  // Give that refresh first claim on memory instead of racing it with another
  // full source snapshot.
  await sleep(10_000);

  while (true) {
    if (activeSmartEngineRefreshes > 0) {
      console.log(
        '[SMART SYNC] Foreground Smart refresh active; background source fetch deferred.'
      );
      await sleep(30_000);
      continue;
    }
    const cycleStartedAt =
      Date.now();

    try {
      if (typeof helpers.waitForHttpIdle === 'function') {
        await helpers.waitForHttpIdle();
      }
      if (activeSmartEngineRefreshes > 0) {
        await sleep(15_000);
        continue;
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

      if (activeSmartEngineRefreshes > 0) {
        console.log(
          '[SMART SYNC] Foreground Smart refresh started during background fetch; dropping duplicate batch.'
        );
        continue;
      }

      if (
        typeof helpers
          .resolveSmartArticleDestinations ===
        'function'
      ) {
        await helpers
          .resolveSmartArticleDestinations(
            results
          );
      }

      const articles =
        results.flatMap(
          result =>
            result.articles ||
            []
        );

      await helpers.observeCacheArticles?.(articles);
      void prefetchOpenCliOnlySmartArticles(
        results,
        helpers
      ).catch(error => console.warn('[SMART PREFETCH]', error.message));

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
  geminiKeyManager = null,
  clusterWorkerFactory = getClusterWorker
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

    // Older data may contain the same publisher in several Smart sections
    // with different fetch policies. A strict (non-empty) policy is the only
    // unambiguous legacy user choice, so use it for every Smart copy.
    const strictPolicyByPublisher = new Map();
    for (const source of sources) {
      const publisherIdentity = sourceFetchPolicyIdentity(source);
      if (
        publisherIdentity &&
        source.fetchMethods.length &&
        !strictPolicyByPublisher.has(publisherIdentity)
      ) {
        strictPolicyByPublisher.set(publisherIdentity, [...source.fetchMethods]);
      }
    }

    let policiesSynchronized = false;
    for (const source of sources) {
      const sharedMethods = strictPolicyByPublisher.get(sourceFetchPolicyIdentity(source));
      if (
        sharedMethods &&
        JSON.stringify(source.fetchMethods) !== JSON.stringify(sharedMethods)
      ) {
        source.fetchMethods = [...sharedMethods];
        policiesSynchronized = true;
      }
    }

    if (defaultsAdded || policiesSynchronized) {
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

    const publisherIdentity = sourceFetchPolicyIdentity(source);
    const sharedPolicySource = publisherIdentity
      ? sources.find(current =>
        sourceFetchPolicyIdentity(current) === publisherIdentity &&
        Array.isArray(current.fetchMethods) &&
        current.fetchMethods.length
      )
      : null;
    if (sharedPolicySource) {
      source.fetchMethods = [...sharedPolicySource.fetchMethods];
    }

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

  async function updateSourceFetchMethodsByIdentity(sources, identity, fetchMethods = []) {
    const publisherIdentity = sourceFetchPolicyIdentity(identity);
    if (!publisherIdentity) throw new Error('Invalid source identity.');
    const normalizedMethods = Array.isArray(fetchMethods)
      ? [...new Set(fetchMethods.filter(method => SMART_SOURCE_FETCH_METHODS.has(method)))]
      : [];
    const updated = sources.map(source =>
      sourceFetchPolicyIdentity(source) === publisherIdentity
        ? { ...source, fetchMethods: [...normalizedMethods] }
        : source
    );
    await db.put('smartSources', JSON.stringify(updated));
    return updated;
  }

  async function setSourceFetchMethodsByIdentity(identity, fetchMethods = []) {
    const sources = await getSourceSettings();
    return updateSourceFetchMethodsByIdentity(sources, identity, fetchMethods);
  }

  async function setSourceFetchMethods(url, fetchMethods = []) {
    const key = canonicalSourceUrl(url);
    if (!key) throw new Error('Invalid Smart source URL.');
    const sources = await getSourceSettings();
    const source = sources.find(current => canonicalSourceUrl(current.url) === key);
    if (!source) throw new Error('Smart source not found.');
    return updateSourceFetchMethodsByIdentity(sources, source, fetchMethods);
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
    const existingSources = await getSourceSettings();
    const strictPolicyByPublisher = new Map();
    for (const source of existingSources) {
      const identity = sourceFetchPolicyIdentity(source);
      if (identity && source.fetchMethods.length && !strictPolicyByPublisher.has(identity)) {
        strictPolicyByPublisher.set(identity, [...source.fetchMethods]);
      }
    }

    const sources =
      DEFAULT_SMART_SOURCES
        .map(source =>
          normalizeSmartSource({
            ...source,
            enabled: true
          })
        )
        .filter(Boolean)
        .map(source => ({
          ...source,
          fetchMethods: [
            ...(strictPolicyByPublisher.get(sourceFetchPolicyIdentity(source)) || source.fetchMethods)
          ]
        }));

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
      cumulativeClusteringCounters: (await db.get('smartClusteringCounters', { type: 'json' })) || {},
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
    targetCategory = null,
    options = {}
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
    activeSmartEngineRefreshes++;
    let refreshLeaseActive = true;

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

        const progressExtra = {
          ...extra
        };
        if (currentProgress.stage !== stage) {
          for (const key of [
            'current', 'total', 'remaining', 'percent',
            'providerId', 'providerIndex', 'providerAttempt',
            'providerTotal', 'model', 'reviewGroupId',
            'reviewArticleCount', 'reviewResolution'
          ]) {
            if (!(key in progressExtra)) progressExtra[key] = undefined;
          }
        }
        const current = Number(progressExtra.current);
        const total = Number(progressExtra.total);
        if (
          Number.isFinite(current) &&
          Number.isFinite(total) &&
          total >= 0
        ) {
          progressExtra.remaining = Math.max(
            0,
            total - current
          );
          if (!Number.isFinite(Number(progressExtra.percent))) {
            progressExtra.percent = total > 0
              ? Math.round(current / total * 100)
              : 100;
          }
        }

        currentProgress = {
          ...currentProgress,
          stage,
          message,
          active: !terminal,
          updatedAt:
            toVietnamIso(
              Date.now()
            ),
          ...progressExtra
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
    const metrics = { articlesChecked: 0, newArticles: 0, modifiedArticles: 0, unchangedArticles: 0,
      removedArticles: 0, embeddingsReused: 0, embeddingsGenerated: 0, existingMembershipsReused: 0,
      affectedClustersReconsidered: 0, deterministicMatches: 0, deterministicNonMatches: 0,
      ambiguousGroups: 0, verificationCacheHits: 0, verificationCacheMisses: 0,
      cachedDecisionsReused: 0, cachedDecisionsInvalidated: 0, invalidationReason: null,
      firstPassAiCalls: 0, firstPassValidJson: 0, firstPassInvalidJson: 0, markdownFenceRecoveries: 0,
      safeExtractionRecoveries: 0, repairAttempts: 0, repairSuccesses: 0, repairFailures: 0,
      jsonRepairCalls: 0, fallbackProviderCalls: 0,
      fallbackProviderAttempts: 0, fallbackProviderSuccesses: 0, allProviderFailures: 0,
      successfulVerificationDecisions: 0, unresolvedAmbiguousGroups: 0, deferredAmbiguousGroups: 0,
      groupsSkippedTooLarge: 0, fullGroupRepartitions: 0,
      rebuildReason: null };
    let attemptedState = null;

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

      let previousSmartArticlesForPrefetch =
        (
          await db.get(
            'smartRawArticles',
            { type: 'json', shared: true }
          )
        ) || [];

      let sourceResults =
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

      if (
        typeof helpers
          .resolveSmartArticleDestinations ===
        'function'
      ) {
        notify(
          'smart-resolving',
          'Resolving publisher links and thumbnails…'
        );
        await helpers
          .resolveSmartArticleDestinations(
            sourceResults
          );
      }

      let fetchedArticles =
        sourceResults.flatMap(
          result =>
            result.articles ||
            []
        );

      await helpers.observeCacheArticles?.(fetchedArticles);
      // Do not start a second asynchronous OpenCLI article prefetch from the
      // clustering refresh. The dedicated background source loop performs that
      // work when no Smart refresh is active, so these source arrays can be
      // released before HNSW/AI review.

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

      const successfulSourceCount = sourceResults.length - sourceErrors.length;

      let previousHidden =
        isTargeted
          ? previousSmartArticlesForPrefetch
          : [];

      let preservedHidden =
        isTargeted
          ? previousHidden.filter(
            article =>
              article.smartCategory !==
              targetCategory
          )
          : [];

      let hiddenArticles =
        isTargeted
          ? [
            ...preservedHidden,
            ...fetchedArticles
          ]
          : fetchedArticles;

      const hiddenArticleCount = hiddenArticles.length;
      let smartRawArticlesJson = hiddenArticleCount
        ? JSON.stringify(hiddenArticles)
        : '[]';
      if (hiddenArticleCount) {
        await db.put('smartRawArticles', smartRawArticlesJson);
      }
      // The raw snapshot is already durable before clustering starts. Holding
      // this second large JSON string through HNSW + sequential AI review
      // needlessly raises the old-space floor.
      smartRawArticlesJson = null;

      let existingArticles =
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

      let existingClusters =
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

      const previousReviewState =
        (
          await db.get(
            'smartDeferredReviewGroups',
            { type: 'json' }
          )
        ) || {};
      const storedStoryRelationships =
        previousReviewState.algorithmVersion === SMART_CLUSTER_VERSION &&
        Array.isArray(previousReviewState.relationships)
          ? previousReviewState.relationships
          : [];

      let feeds =
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
      let activeStoredArticles = [];
      for (let index = 0; index < existingClusters.length; index++) {
        const cluster = existingClusters[index];
        if (isActiveCluster(cluster)) {
          activeStoredArticles.push(...extractActiveClusterArticles(cluster).filter(article =>
            !isExcludedFromSmart(article, dynamicExcludedUrls) &&
            (!article.hiddenSmartSource || smartSources.some(source => source.url === article.feedUrl))));
        }
        if (index > 0 && index % 150 === 0) await new Promise(resolve => setImmediate(resolve));
      }

      let normalArticles = [];
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

      let normalizedHidden = [];
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

      let articleMap =
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

      let rawCandidates =
        dedupeGoogleNewsWrappers(
          [...articleMap.values()]
        );

      let previousRawArticles = (await db.get('smartClusteringInputs', { type: 'json', shared: true })) || (await db.get('smartRawArticles', { type: 'json', shared: true })) || [];
      let previousArticleMap = new Map();
      for (const article of previousRawArticles) {
        if (article.articleKey) {
          previousArticleMap.set(article.articleKey, article);
        }
      }

      let candidates = [];
      let activeCandidates = new Set();

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

        article.contentHash = createHash('sha256').update(JSON.stringify({
          embedding: buildEmbeddingText(article), verification: normalizedVerificationArticles([article]),
          category: article.smartCategory, region: article.region
        })).digest('hex');

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

      metrics.articlesChecked = candidates.length;
      for (const article of candidates) metrics[article._status === 'NEW' ? 'newArticles' : article._status === 'MODIFIED' ? 'modifiedArticles' : 'unchangedArticles']++;
      metrics.removedArticles = [...previousArticleMap.keys()].filter(key => !activeCandidates.has(key)).length;
      notify('smart-checking', 'Checking for changes…');
      const currentSignature =
        stableId(
          candidates
            .map(article =>
              [
                article.link,
                article.title,
                article.pubDate,
                article.contentHash, article.smartCategory, article.language, article.region
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
                source.weight, source.enabled, JSON.stringify(source.fetchMethods || [])
              ].join('|')
            )
            .sort()
            .join('\n')
        );

      const aiConfiguration =
        [
          EMBEDDING_MODEL, EMBEDDING_CACHE_VERSION,
          SMART_NEWS_AI_CONFIG.cache.promptVersion,
          SMART_NEWS_AI_CONFIG.cache.rulesVersion,
          SMART_NEWS_AI_CONFIG.cache.schemaVersion,
          SMART_CLUSTER_VERSION,
          sourceSignature, JSON.stringify(settings), [...dynamicExcludedUrls].sort().join(',')
        ].join('|');

      const previousAiConfiguration =
        (
          await db.get(
            'smartAiConfig'
          )
        ) || '';

      attemptedState = { signature: currentSignature, configuration: aiConfiguration,
        providers: providers.map(p => `${p.id}:${p.model}`).join('|') };
      const failedAttempt = await db.get('smartClusteringFailedAttempt', { type: 'json' });
      if (!options.forceRebuild && failedAttempt && Object.keys(attemptedState).every(key => attemptedState[key] === failedAttempt[key])) {
        metrics.unresolvedAmbiguousGroups = failedAttempt.unresolvedAmbiguousGroups || 1;
        notify('smart-error', 'Unresolved matches unchanged; previous clusters retained. Use Force Rebuild to retry.', { failed: true });
        return { ok: false, skipped: true, reason: 'unchanged_failed_verification', metrics };
      }

      if (
        !options.forceRebuild &&
        currentSignature ===
        previousSignature &&
        previousAiConfiguration ===
        aiConfiguration &&
        (await db.get('smartClusteringAlgorithmVersion')) === SMART_CLUSTER_VERSION &&
        (await db.get('smartEmbeddingIdentity')) === `${EMBEDDING_MODEL}:${EMBEDDING_CACHE_VERSION}` &&
        previousSignature
      ) {
        metrics.cachedDecisionsReused = existingClusters.filter(cluster => cluster.verification?.method === 'ai_fallback').length;
        metrics.embeddingsReused = candidates.length;
        metrics.existingMembershipsReused = candidates.length;
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
          verificationStats: metrics,
          metrics,
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
        'smart-embeddings',
        'Generating embeddings…',
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

      const embeddingIdentity = `${EMBEDDING_MODEL}:${EMBEDDING_CACHE_VERSION}`;
      const previousEmbeddingIdentity = await db.get('smartEmbeddingIdentity');
      const embeddingPolicyChanged = previousEmbeddingIdentity !== embeddingIdentity;
      const clusterVersionChanged = options.forceRebuild || storedClusterVersion !== SMART_CLUSTER_VERSION || embeddingPolicyChanged;
      metrics.rebuildReason = options.forceRebuild ? 'explicit_force_rebuild' : storedClusterVersion !== SMART_CLUSTER_VERSION ? 'clustering_policy_version_changed' : embeddingPolicyChanged ? 'embedding_policy_changed' : null;
      console.log('[SMART REBUILD]', JSON.stringify({ rebuild_reason: metrics.rebuildReason }));

      const existingClusterCountBeforeRebuild = existingClusters.length;
      let storyIdRetentionClusters = existingClusters;
      if (clusterVersionChanged) {
        // retainStoryIds needs only the previous cluster id and member links.
        // Keeping the full old 8k+ cluster snapshot alive through a clean
        // rebuild and minutes of AI review caused avoidable multi-GB heap use.
        storyIdRetentionClusters = existingClusters
          .filter(cluster => cluster?.clusterId)
          .map(cluster => ({
            clusterId: cluster.clusterId,
            link: cluster.link,
            relatedArticles: Array.isArray(cluster.relatedArticles)
              ? cluster.relatedArticles.map(article => ({ link: article.link }))
              : []
          }));
        existingClusters = [];
      }

      // Candidate preparation creates several overlapping article arrays/maps.
      // The compact `candidates` list is now authoritative, while raw Smart
      // articles are already serialized for publication. Release everything
      // else before HNSW and the long sequential AI phase.
      previousSmartArticlesForPrefetch = null;
      sourceResults = null;
      fetchedArticles = null;
      previousHidden = null;
      preservedHidden = null;
      hiddenArticles = null;
      existingArticles = null;
      feeds = null;
      activeStoredArticles.length = 0;
      activeStoredArticles = null;
      normalArticles.length = 0;
      normalArticles = null;
      normalizedHidden.length = 0;
      normalizedHidden = null;
      articleMap.clear();
      articleMap = null;
      rawCandidates.length = 0;
      rawCandidates = null;
      previousRawArticles = null;
      previousArticleMap.clear();
      previousArticleMap = null;
      activeCandidates.clear();
      activeCandidates = null;

      if (typeof global.gc === 'function') {
        global.gc();
        const memory = process.memoryUsage();
        console.log(
          '[SMART MEMORY] pre-clustering-release',
          JSON.stringify({
            rssMB: Math.round(memory.rss / 1024 / 1024),
            heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
            cleanRebuild: clusterVersionChanged
          })
        );
      }

      // Reuse one clustering worker for the lifetime of this Node process.
      // This is required because the old ONNX ARM64 native addon cannot
      // safely be unloaded and then loaded by a replacement Worker.
      const worker = clusterWorkerFactory();

      let clusteringResult = await new Promise((resolve, reject) => {
        let hasResult = false;

        const cleanup = () => {
          worker.off('message', onMessage);
        };

        const onMessage = msg => {
          if (msg.type === 'progress') {
            if (msg.progress.embeddingsReused !== undefined) Object.assign(metrics, { embeddingsReused: msg.progress.embeddingsReused, embeddingsGenerated: msg.progress.embeddingsGenerated });
            notify(
              msg.progress.phase === 'embeddings' ? 'smart-embeddings' : 'smart-matching',
              msg.progress.phase === 'embeddings' ? 'Generating embeddings…' : 'Matching stories…',
              {
                ...msg.progress,
                ...(Number.isFinite(Number(msg.progress.current))
                  ? { current: Number(msg.progress.current) }
                  : {}),
                ...(Number.isFinite(Number(msg.progress.total))
                  ? { total: Number(msg.progress.total) }
                  : {})
              }
            );
          } else if (msg.type === 'result') {
            if (hasResult) return;
            hasResult = true;
            cleanup();
            Object.assign(metrics, msg.result.metrics || {});
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
            : existingClusters.filter(cluster => isActiveCluster(cluster));

        console.log(
          '[HNSW VERSION CHECK]',
          JSON.stringify({
            storedClusterVersion,
            currentClusterVersion:
              SMART_CLUSTER_VERSION,
            clusterVersionChanged,
            storedClusters:
              existingClusterCountBeforeRebuild,
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

      let autoMergedClusters;
      let ambiguousGroups;
      {
        const canonicalArticleById =
          new Map(
            candidates.map(
              article => [
                getArticleId(article),
                article
              ]
            )
          );

        const rebindWorkerGroups = groups =>
          (Array.isArray(groups) ? groups : [])
            .map(group => ({
              ...group,
              articles:
                (Array.isArray(group?.articles)
                  ? group.articles
                  : []
                ).map(article => {
                  const articleId =
                    getArticleId(article);
                  const canonicalArticle =
                    canonicalArticleById.get(
                      articleId
                    );

                  if (!canonicalArticle) {
                    throw new Error(
                      `Clustering worker returned unknown article ${articleId}`
                    );
                  }

                  return canonicalArticle;
                })
            }));

        autoMergedClusters =
          rebindWorkerGroups(
            clusteringResult
              .autoMergedClusters
          );
        ambiguousGroups =
          rebindWorkerGroups(
            clusteringResult
              .ambiguousGroups
          );
      }

      clusteringResult = null;

      if (typeof global.gc === 'function') {
        global.gc();
        const memory =
          process.memoryUsage();
        console.log(
          '[SMART MEMORY] post-clustering-gc',
          JSON.stringify({
            rssMB:
              Math.round(memory.rss / 1024 / 1024),
            heapUsedMB:
              Math.round(memory.heapUsed / 1024 / 1024),
            heapTotalMB:
              Math.round(memory.heapTotal / 1024 / 1024)
          })
        );
      }

      const ambiguousGroupCount = ambiguousGroups.length;
      let reviewGroups = prepareIncrementalReviewGroups(ambiguousGroups, autoMergedClusters);
      ambiguousGroups = null;
      metrics.ambiguousGroups = reviewGroups.length;
      metrics.fullGroupRepartitions = reviewGroups.filter(group => group.fullRepartition).length;
      for (let reviewIndex = 0; reviewIndex < reviewGroups.length; reviewIndex++) {
        const group = reviewGroups[reviewIndex];
        group.forceRebuild = options.forceRebuild === true;
        group.metrics = metrics;
        group.reviewIndex = reviewIndex;
        group.onStage = (stage, details = {}) => {
          const current = reviewIndex + 1;
          const remaining = Math.max(
            0,
            reviewGroups.length - current
          );
          const providerIndex = Number(
            details.providerAttempt
          ) || null;
          const providerTotal = Number(
            details.providerTotal
          ) || null;
          const providerLabel =
            details.model ||
            details.providerId ||
            'provider';
          const providerProgress =
            providerIndex && providerTotal
              ? ` · provider ${providerIndex}/${providerTotal}`
              : '';
          const action = stage === 'smart-ai-repair'
            ? `repairing ${providerLabel} response`
            : stage === 'smart-ai-fallback'
              ? `${providerLabel}${providerProgress}`
              : `${providerLabel}${providerProgress}`;

          notify(
            stage,
            `Smart Verify · Group ${current}/${reviewGroups.length} · ${remaining} remaining · ${action}`,
            {
              current,
              total: reviewGroups.length,
              remaining,
              providerIndex,
              providerTotal,
              reviewGroupId: group.id,
              reviewArticleCount: group.articles.length,
              ...details
            }
          );
        };
      }

      const progressiveRunId = stableId(
        [
          SMART_CLUSTER_VERSION,
          startedAt,
          currentSignature,
          targetCategory || 'all'
        ].join('|')
      );
      let progressiveRevision = 0;
      let progressiveVersion = '';
      let progressiveClusterCount = 0;

      const configuredProgressiveMaxCandidates =
        Number(
          process.env
            .SMART_PROGRESSIVE_MAX_CANDIDATES
        );

      const progressiveMaxCandidates =
        Number.isFinite(
          configuredProgressiveMaxCandidates
        ) &&
        configuredProgressiveMaxCandidates > 0
          ? Math.floor(
              configuredProgressiveMaxCandidates
            )
          : 6000;

      // A progressive publication duplicates almost the complete Smart
      // cluster graph while the clustering/review graph is still live.
      // For a large corpus this can consume more than a gigabyte of
      // additional old-space. Skip that optional intermediate view and
      // publish the normal final snapshot instead.
      const progressivePublicationAllowed =
        candidates.length <=
        progressiveMaxCandidates;

      let progressivePublicationDisabled =
        false;

      const progressiveResolvedByGroup =
        new Map();

      const progressiveBaselineByGroup =
        progressivePublicationAllowed
          ? new Map(
              reviewGroups.map(
                group => [
                  group.id,
                  deferredReviewPartitions(
                    group,
                    'verification_pending'
                  )
                ]
              )
            )
          : new Map();

      const progressiveHeapLimitBytes =
        Number(getHeapStatistics().heap_size_limit) ||
        (4 * 1024 * 1024 * 1024);
      const configuredProgressiveHeapMb = Number(
        process.env.SMART_PROGRESSIVE_PUBLISH_HEAP_MAX_MB
      );
      const progressiveHeapMaxBytes =
        Number.isFinite(configuredProgressiveHeapMb) &&
        configuredProgressiveHeapMb > 0
          ? configuredProgressiveHeapMb * 1024 * 1024
          : Math.floor(progressiveHeapLimitBytes * 0.55);

      const publishProgressiveSnapshot = async ({
        completedGroups = 0,
        reviewRelationships = [],
        resolution = 'deterministic_base'
      } = {}) => {
        if (!reviewGroups.length) return false;

        if (!progressivePublicationAllowed) {
          if (!progressivePublicationDisabled) {
            progressivePublicationDisabled =
              true;

            console.warn(
              '[SMART PROGRESSIVE] Disabled for large corpus',
              JSON.stringify({
                candidates:
                  candidates.length,
                maxCandidates:
                  progressiveMaxCandidates,
                reviewGroups:
                  reviewGroups.length
              })
            );

            // Retire a potentially huge progressive payload retained by
            // the in-memory DB from a previous run.
            await db.put(
              'smartProgressivePublication',
              'null'
            );

            await db.put(
              'smartProgressiveClusterState',
              JSON.stringify({
                active: false,
                provisional: true,
                stage:
                  'disabled-large-corpus',
                version: '',
                runId:
                  progressiveRunId,
                revision:
                  progressiveRevision,
                algorithmVersion:
                  SMART_CLUSTER_VERSION,
                candidateCount:
                  candidates.length,
                totalReviewGroups:
                  reviewGroups.length,
                reason:
                  'large_corpus_memory_guard',
                updatedAt:
                  toVietnamIso(
                    Date.now()
                  )
              })
            );

            progressiveResolvedByGroup.clear();
            progressiveBaselineByGroup.clear();

            if (
              typeof global.gc ===
              'function'
            ) {
              global.gc();

              const memory =
                process.memoryUsage();

              console.log(
                '[SMART MEMORY] progressive-disabled-gc',
                JSON.stringify({
                  rssMB:
                    Math.round(
                      memory.rss /
                      1024 /
                      1024
                    ),
                  heapUsedMB:
                    Math.round(
                      memory.heapUsed /
                      1024 /
                      1024
                    ),
                  heapTotalMB:
                    Math.round(
                      memory.heapTotal /
                      1024 /
                      1024
                    )
                })
              );
            }
          }

          return false;
        }

        let memory = process.memoryUsage();
        if (
          memory.heapUsed >= progressiveHeapMaxBytes &&
          typeof global.gc === 'function'
        ) {
          global.gc();
          memory = process.memoryUsage();
        }
        if (memory.heapUsed >= progressiveHeapMaxBytes) {
          console.warn(
            '[SMART PROGRESSIVE] Publication deferred under memory pressure',
            JSON.stringify({
              completedGroups,
              totalGroups: reviewGroups.length,
              heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
              heapLimitMB: Math.round(progressiveHeapLimitBytes / 1024 / 1024),
              publishThresholdMB: Math.round(progressiveHeapMaxBytes / 1024 / 1024)
            })
          );
          return false;
        }

        try {
          const reviewedClusters = reviewGroups.flatMap(
            group =>
              progressiveResolvedByGroup.has(group.id)
                ? progressiveResolvedByGroup.get(group.id)
                : (progressiveBaselineByGroup.get(group.id) || [])
          );
          const relationships =
            mergeRelatedDevelopmentRelationships(
              storedStoryRelationships,
              reviewRelationships
            );
          let snapshot = buildPublicationClusterSnapshot({
            candidates,
            autoMergedClusters,
            reviewedClusters,
            reviewGroups,
            clusterVersionChanged,
            existingClusters,
            isTargeted,
            targetCategory,
            storyIdRetentionClusters,
            storyRelationships: relationships
          });

          progressiveRevision++;
          progressiveVersion =
            `${progressiveRunId}_progressive_${progressiveRevision}_${snapshot.clusters.length}`;
          progressiveClusterCount = snapshot.clusters.length;
          const remainingGroups = Math.max(
            0,
            reviewGroups.length - completedGroups
          );

          notify(
            'smart-publishing',
            completedGroups > 0
              ? `Publishing verified Smart updates · ${completedGroups}/${reviewGroups.length} complete · ${remainingGroups} remaining`
              : `Publishing deterministic Smart snapshot · ${reviewGroups.length} review groups pending`,
            {
              current: completedGroups > 0 ? 2 : 1,
              total: 3,
              publicationPhase:
                completedGroups > 0
                  ? 'progressive_review_update'
                  : 'deterministic_base',
              reviewCurrent: completedGroups,
              reviewTotal: reviewGroups.length,
              reviewRemaining: remainingGroups,
              reviewResolution: resolution,
              progressive: true,
              progressiveRevision,
              progressiveVersion
            }
          );

          // Publish the large cluster payload first and the tiny activation
          // state second. Readers require matching versions, so they either see
          // the previous complete publication, this complete publication, or
          // safely fall back to the last final snapshot -- never a mixed pair.
          let progressivePublicationJson = JSON.stringify({
            version: progressiveVersion,
            revision: progressiveRevision,
            runId: progressiveRunId,
            clusters: snapshot.clusters
          });
          await db.put(
            'smartProgressivePublication',
            progressivePublicationJson
          );
          await db.put(
            'smartProgressiveClusterState',
            JSON.stringify({
              active: true,
              provisional: true,
              stage: 'reviewing',
              version: progressiveVersion,
              runId: progressiveRunId,
              revision: progressiveRevision,
              algorithmVersion: SMART_CLUSTER_VERSION,
              clusterCount: snapshot.clusters.length,
              completedReviewGroups: completedGroups,
              totalReviewGroups: reviewGroups.length,
              remainingReviewGroups: remainingGroups,
              lastResolution: resolution,
              updatedAt: toVietnamIso(Date.now())
            })
          );

          console.log(
            '[SMART PROGRESSIVE] Published',
            JSON.stringify({
              version: progressiveVersion,
              revision: progressiveRevision,
              clusters: snapshot.clusters.length,
              completedGroups,
              totalGroups: reviewGroups.length,
              remainingGroups,
              resolution
            })
          );

          progressivePublicationJson = null;
          snapshot.clusters.length = 0;
          snapshot.currentLinks.clear();
          snapshot = null;
          if (typeof global.gc === 'function') global.gc();
          return true;
        } catch (error) {
          console.warn(
            '[SMART PROGRESSIVE] Publication skipped:',
            error.message
          );
          return false;
        }
      };

      // As soon as HNSW has produced a membership-valid deterministic state,
      // make that state available without replacing the last final snapshot.
      // AI-verified changes are layered into this separate progressive key.
      await publishProgressiveSnapshot({
        completedGroups: 0,
        reviewRelationships: [],
        resolution: 'deterministic_base'
      });

      let reviewResult = {
        clusters:
          reviewGroups.flatMap(
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
          reviewGroups.length,
        ambiguousGroupsVerified:
          0,
        ambiguousGroupsFromCache:
          0,
        ambiguousGroupsKeptSeparate:
          reviewGroups.length,
        ambiguousGroupsDeferred:
          0,
        memoryPressureDeferredGroups:
          0,
        reviewedArticleCount:
          0,
        allProvidersFailedCount:
          providers.length
            ? reviewGroups.length
            : 0,
        providerRequests: {},
        deferredGroups: [],
        storyRelationships: [],
        groupResults: []
      };

      if (
        reviewGroups.length &&
        SMART_NEWS_CLUSTER_CONFIG
          .heavyAI
          .enabled
      ) {
        reviewResult =
          await reviewAmbiguousEventGroups(
            reviewGroups,
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
              ),
            async ({
              index,
              group,
              result,
              resolvedForGroup,
              statistics
            }) => {
              if (
                result.resolution !== 'verified' &&
                result.resolution !== 'cached'
              ) {
                return;
              }

              progressiveResolvedByGroup.set(
                group.id,
                resolvedForGroup
              );
              await publishProgressiveSnapshot({
                completedGroups: index + 1,
                reviewRelationships:
                  statistics.storyRelationships || [],
                resolution: result.resolution
              });
            }
          );
      }

      metrics.deferredAmbiguousGroups =
        Number(reviewResult.ambiguousGroupsDeferred) || 0;
      metrics.memoryPressureDeferredGroups =
        Number(reviewResult.memoryPressureDeferredGroups) || 0;

      if (reviewResult.ambiguousGroupsKeptSeparate > 0) {
        metrics.unresolvedAmbiguousGroups = reviewResult.ambiguousGroupsKeptSeparate;
        console.warn(
          '[SMART VERIFY DEFERRED]',
          JSON.stringify({
            reason: 'conservative_kept_separate_fallback',
            groups: reviewResult.ambiguousGroupsKeptSeparate
          })
        );
      }

      const mergedStoryRelationships =
        mergeRelatedDevelopmentRelationships(
          storedStoryRelationships,
          reviewResult.storyRelationships || []
        );

      let finalSnapshot =
        buildPublicationClusterSnapshot({
          candidates,
          autoMergedClusters,
          reviewedClusters: reviewResult.clusters,
          reviewGroups,
          clusterVersionChanged,
          existingClusters,
          isTargeted,
          targetCategory,
          storyIdRetentionClusters,
          storyRelationships: mergedStoryRelationships
        });

      let clusters = finalSnapshot.clusters;
      let currentLinks = finalSnapshot.currentLinks;
      let storyRelationshipsForSnapshot =
        finalSnapshot.storyRelationships;

      // Everything below editorial assessment needs the final cluster graph,
      // but it does not need the several overlapping input graphs that were
      // required to build it. Keeping all of them alive through minutes of
      // AI editorial work caused the main process to approach the V8 heap
      // limit before Top Stories could run.
      const candidateCountForCompleted =
        candidates.length;

      const autoMergedClusterCountForCompleted =
        autoMergedClusters.length;

      const smartClusteringInputsJson =
        JSON.stringify(
          candidates.map(
            article => ({
              articleKey:
                article.articleKey,
              contentHash:
                article.contentHash
            })
          )
        );

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

      // Progressive reconciliation is finished once the final publication
      // snapshot has been assembled.
      progressiveResolvedByGroup.clear();
      progressiveBaselineByGroup.clear();

      if (
        Array.isArray(
          reviewResult?.clusters
        )
      ) {
        reviewResult.clusters.length = 0;
      }

      if (
        Array.isArray(
          autoMergedClusters
        )
      ) {
        autoMergedClusters.length = 0;
      }
      autoMergedClusters = null;

      if (
        Array.isArray(
          reviewGroups
        )
      ) {
        reviewGroups.length = 0;
      }
      reviewGroups = null;

      if (
        Array.isArray(
          candidates
        )
      ) {
        candidates.length = 0;
      }
      candidates = null;

      storyIdRetentionClusters = null;
      existingClusters = null;

      // Keep the extracted final graph, links and relationships, but release
      // the wrapper object itself.
      finalSnapshot = null;

      if (
        typeof global.gc ===
        'function'
      ) {
        global.gc();

        const memory =
          process.memoryUsage();

        console.log(
          '[SMART MEMORY] pre-editorial-gc',
          JSON.stringify({
            rssMB:
              Math.round(
                memory.rss /
                1024 /
                1024
              ),
            heapUsedMB:
              Math.round(
                memory.heapUsed /
                1024 /
                1024
              ),
            heapTotalMB:
              Math.round(
                memory.heapTotal /
                1024 /
                1024
              )
          })
        );
      }

      const editorialStats =
        await assessSmartEditorialClusters({
          clusters,
          sources:
            smartSources,
          providers,
          keyManager,
          db,
          notify,
          metrics
        });

      if (typeof global.gc === 'function') {
        global.gc();
        const memory = process.memoryUsage();
        console.log(
          '[SMART MEMORY] post-editorial-gc',
          JSON.stringify({
            rssMB: Math.round(memory.rss / 1024 / 1024),
            heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024)
          })
        );
      }

      metrics.editorialCacheHits =
        editorialStats.cacheHits;

      metrics.editorialAssessed =
        editorialStats.assessed;

      

      metrics.editorialAiCalls =
        editorialStats.aiCalls;
metrics.editorialAssessmentFailures =
        editorialStats.failed;

      metrics.editorialAssessmentPending =
        editorialStats.pending;

      console.log(
        '[SMART EDITORIAL]',
        JSON.stringify(
          editorialStats
        )
      );

      const clusterVersion =
        `${toVietnamIso(Date.now())}_${clusters.length}`;

      notify(
        'smart-publishing',
        'Publishing final Smart snapshot…',
        {
          current: 3,
          total: 3,
          publicationPhase: 'final',
          progressive: false
        }
      );
      await putManySafe(
        db,
        {
          smartEmbeddingIdentity: embeddingIdentity,
          smartClusteringFailedAttempt: 'null',
          smartDeferredReviewGroups:
            JSON.stringify({
              algorithmVersion: SMART_CLUSTER_VERSION,
              updatedAt: toVietnamIso(Date.now()),
              groups: reviewResult.deferredGroups || [],
              relationships: storyRelationshipsForSnapshot
            }),
          smartClusteringInputs:
            smartClusteringInputsJson,
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
           * Publish the completed snapshot and its identity atomically.
           */
          smartClusterState:
            JSON.stringify({
              provisional: false,
              stage: 'ready',
              clusterCount:
                clusters.length,
              ambiguousGroupsTotal:
                ambiguousGroupCount,
              ambiguousGroupsReviewed:
                reviewResult
                  .ambiguousGroupsTotal,
              ambiguousGroupsDeferred:
                reviewResult
                  .ambiguousGroupsDeferred || 0,
              memoryPressureDeferredGroups:
                reviewResult
                  .memoryPressureDeferredGroups || 0,
              relatedDevelopmentCount:
                storyRelationshipsForSnapshot.length,
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
            aiConfiguration,

          // Final publication atomically retires the progressive view.
          smartProgressivePublication:
            'null',
          smartProgressiveClusterState:
            JSON.stringify({
              active: false,
              provisional: false,
              stage: 'ready',
              version: '',
              runId: progressiveRunId,
              revision: progressiveRevision,
              algorithmVersion: SMART_CLUSTER_VERSION,
              completedReviewGroups: reviewResult.ambiguousGroupsTotal,
              totalReviewGroups: reviewResult.ambiguousGroupsTotal,
              remainingReviewGroups: 0,
              completedAt: toVietnamIso(Date.now())
            })
        },
        {
          allowLargeReduction:
            true
        }
      );

      if (typeof global.gc === 'function') {
        global.gc();
        const memory = process.memoryUsage();
        console.log(
          '[SMART MEMORY] post-final-persist-gc',
          JSON.stringify({
            rssMB: Math.round(memory.rss / 1024 / 1024),
            heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024)
          })
        );
      }

      const providerHealth =
        await getProviderHealth(db);

      const completed = {
        metrics,
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
        successfulSourceCount,
        failedSourceCount:
          sourceErrors.length,
        sourceErrors,
        hiddenArticleCount,
        candidateCount:
          candidateCountForCompleted,
        clusterCount:
          clusters.length,
        autoMergedClusterCount:
          autoMergedClusterCountForCompleted,
        ambiguousGroupCount:
          ambiguousGroupCount,
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
          ambiguousGroupsDeferred:
            reviewResult
              .ambiguousGroupsDeferred || 0,
          memoryPressureDeferredGroups:
            reviewResult
              .memoryPressureDeferredGroups || 0,
          relatedDevelopmentCount:
            (reviewResult.storyRelationships || []).length,
          activeRelatedDevelopmentCount:
            storyRelationshipsForSnapshot.length,
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

      // The Top Stories reconciler may start as soon as status becomes
      // ready. Release the heavy HNSW/review graph first so ranking does not
      // overlap with several gigabytes of now-dead clustering state.
      progressiveResolvedByGroup.clear();
      progressiveBaselineByGroup.clear();
      if (Array.isArray(reviewResult?.clusters)) {
        reviewResult.clusters.length = 0;
      }
      reviewResult = null;
      if (Array.isArray(autoMergedClusters)) {
        autoMergedClusters.length = 0;
      }
      autoMergedClusters = null;
      if (Array.isArray(reviewGroups)) {
        reviewGroups.length = 0;
      }
      reviewGroups = null;
      if (Array.isArray(candidates)) {
        candidates.length = 0;
      }
      candidates = null;
      storyIdRetentionClusters = null;
      existingClusters = null;
      if (currentLinks) currentLinks.clear();
      currentLinks = null;
      if (finalSnapshot?.clusters) {
        finalSnapshot.clusters.length = 0;
      }
      finalSnapshot = null;
      clusters.length = 0;
      clusters = null;

      if (typeof global.gc === 'function') {
        global.gc();
        const memory = process.memoryUsage();
        console.log(
          '[SMART MEMORY] pre-ready-gc',
          JSON.stringify({
            rssMB: Math.round(memory.rss / 1024 / 1024),
            heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024)
          })
        );
      }

      await setStatus(
        completed
      );

      notify(
        'smart-ready',
        `Smart feed ready: ${completed.clusterCount} clusters.`
      );

      console.log(
        '[SMART] Ready:',
        completed.clusterCount,
        'clusters from',
        completed.candidateCount,
        'candidates; providers:',
        aiProvidersUsed.join(', ') ||
        'none'
      );

      return {
        ok: true,
        ...completed
      };
    } catch (error) {
      if (error.code === 'CLUSTER_VERIFICATION_UNRESOLVED' && attemptedState) await db.put('smartClusteringFailedAttempt', JSON.stringify({ ...attemptedState, unresolvedAmbiguousGroups: metrics.unresolvedAmbiguousGroups }));
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
        metrics,
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
      try {
        const cumulative = (await db.get('smartClusteringCounters', { type: 'json' })) || {};
        for (const [key, value] of Object.entries(metrics)) if (typeof value === 'number') cumulative[key] = (Number(cumulative[key]) || 0) + value;
        cumulative.totalCacheEntries = Object.keys(await getVerificationCache(db)).length;
        cumulative.totalAiCallsAvoidedByCache = cumulative.verificationCacheHits || 0;
        await db.put('smartClusteringCounters', JSON.stringify(cumulative));
        console.log('[SMART SYNC METRICS]', JSON.stringify(metrics));
      } catch (error) { console.warn('[SMART METRICS]', error.message); }
      if (refreshLeaseActive) {
        activeSmartEngineRefreshes = Math.max(0, activeSmartEngineRefreshes - 1);
        refreshLeaseActive = false;
      }
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
    setSourceFetchMethods,
    setSourceFetchMethodsByIdentity,
    discoverSources,
    resetSources,
    sync,
    start,
    getSettings,
    updateSettings
  };
}
