import { prefetchOpenCliOnlySmartArticles } from './prefetch.js';
import { discardResponseBody } from '../../fetch-response.js';
import { normalizeArticle } from '../articles/normalize.js';
import { SMART_ITEMS_PER_SOURCE } from '../config.js';

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

export { fetchSmartSource, fetchInBatches, prefetchOpenCliOnlySmartArticles };
