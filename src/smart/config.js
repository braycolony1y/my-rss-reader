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
  }
};

export { DAY_MS, HOUR_MS, SMART_REFRESH_MS, VIETNAM_OFFSET_MS, SMART_ITEMS_PER_SOURCE, SMART_CLUSTER_VERSION, VALID_SMART_CATEGORIES, EXCLUDED_SMART_FEED_URLS, SMART_NEWS_CLUSTER_CONFIG };
