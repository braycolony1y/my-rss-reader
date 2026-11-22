import { mapWithConcurrency } from '../../utils/article-utils.js';
import { cpuCapacity, workloadConcurrency } from '../../runtime/concurrency-limiter.js';

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

export async function prefetchOpenCliOnlySmartArticles(results, helpers) {
  if (typeof helpers?.prefetchOpenCliOnlyArticles !== 'function') return;
  const sources = (results || []).filter(result => hasOnlyOpenCliFetchMethod(result?.source?.fetchMethods));
  await mapWithConcurrency(sources, workloadConcurrency('RSS_SOURCE_PREFETCH_CONCURRENCY', Math.min(2, cpuCapacity())), async result => {
    const articlesToPrefetch = (result.articles || []).filter(smartArticleIdentity);
    if (articlesToPrefetch.length) await helpers.prefetchOpenCliOnlyArticles(articlesToPrefetch, result.source.url);
  });
}
