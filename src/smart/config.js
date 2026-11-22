import { ANTIGRAVITY_MODEL } from '../ai/antigravity.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

const SMART_REFRESH_MS = 30 * 60 * 1000;

const VIETNAM_OFFSET_MS = 7 * HOUR_MS;

const SMART_ITEMS_PER_SOURCE = 10;

const SMART_CLUSTER_VERSION =
  'v2.15_component_relationship_review_20260914-generic-recovery-v2';

const VALID_SMART_CATEGORIES = new Set([
  'news_vietnam',
  'news_global',
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
    maxArticlesPerLocalReview: 20,
    maxComponentsPerOnlineReview: 20,
    maxComponentsPerLocalReview: 20,
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
      id: 'gemini-web',
      type: 'gemini-web',
      model: '3.8 Flash',
      priority: 3,
      timeoutMs: 120_000,
      maxRetries: 0
    },
    {
      id: 'gemini-flash',
      type: 'gemini',
      model:
        process.env.GEMINI_MODEL ||
        'gemini-3.8-flash',
      priority: 4,
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
        'qwen2.5:3b',
      baseUrl:
        process.env.OLLAMA_BASE_URL ||
        'http://127.0.0.1:11434',
      priority: 5,
      timeoutMs: Math.max(
          60_000,
          Math.min(
            300_000,
            Number(process.env.SMART_LOCAL_AI_TIMEOUT_MS) ||
            180_000
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

const LOCAL_MODEL_AVAILABILITY_TTL_MS = 5 * 60 * 1000;

export { DAY_MS, HOUR_MS, SMART_REFRESH_MS, VIETNAM_OFFSET_MS, SMART_ITEMS_PER_SOURCE, SMART_CLUSTER_VERSION, VALID_SMART_CATEGORIES, EXCLUDED_SMART_FEED_URLS, SMART_NEWS_CLUSTER_CONFIG, SMART_NEWS_AI_CONFIG, LOCAL_AI_CONTEXT_TOKENS, LOCAL_AI_OUTPUT_TOKENS, LOCAL_AI_KEEP_ALIVE, LOCAL_MODEL_AVAILABILITY_TTL_MS };
