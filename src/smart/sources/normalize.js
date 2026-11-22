import { canonicalSmartCategory } from '../../utils/smart-destinations.js';
import { isInvestingComSource } from '../articles/categories.js';
import { VALID_SMART_CATEGORIES } from '../config.js';
import { stripHtml } from '../text/normalize.js';
import { canonicalSourceUrl, isExcludedSmartUrl, hostFromUrl } from './identity.js';

const SMART_SOURCE_FETCH_METHODS = new Set(['jina', 'cloudflare', 'vietserver', 'opencli', 'opencli-fetch', 'direct', 'allorigins']);

function normalizeSmartSource(source) {
  source = { ...source, category: canonicalSmartCategory(source?.category) };
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
      : 'news_global';

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
    news_global: 0,
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

export { SMART_SOURCE_FETCH_METHODS, normalizeSmartSource, countSmartSources };
