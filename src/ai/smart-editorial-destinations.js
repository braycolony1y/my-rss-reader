import { eligibleClusterDestinations } from '../smart/prefilter/boundaries.js';
const DESTINATION_SET = new Set(['news_vietnam','news_global','finance_vietnam','finance_global','tech_vietnam','tech_global']);
const membersOf = cluster => [cluster, ...(cluster?.relatedArticles || [])].filter(Boolean);
function sourceDestinations(
  source
) {
  const category =
    String(
      source?.category || ''
    ).toLowerCase();

  if (
    DESTINATION_SET.has(
      category
    )
  ) {
    return [category];
  }

  if (
    category ===
    'finance_global'
  ) {
    return [
      'finance_global'
    ];
  }

  if (
    category ===
      'tech_foreign' ||
    category ===
      'tech_global'
  ) {
    return [
      'tech_global'
    ];
  }

  /*
   * Generic Tech feeds are intentionally eligible for both.
   * AI decides geography semantically instead of using article language.
   */
  if (
    category ===
    'tech'
  ) {
    const region =
      String(
        source?.region || ''
      ).toLowerCase();

    if (
      region ===
      'vietnam'
    ) {
      return [
        'tech_vietnam'
      ];
    }

    if (
      region &&
      region !==
      'vietnam'
    ) {
      return [
        'tech_global'
      ];
    }

    return [
      'tech_vietnam',
      'tech_global'
    ];
  }

  const normalized =
    category
      .replace(
        '_world',
        '_global'
      )
      .replace(
        '_foreign',
        '_global'
      );

  return DESTINATION_SET.has(
    normalized
  )
    ? [normalized]
    : [];
}

export function smartEditorialEligibleDestinations(
  cluster,
  sources
) {
  const urls =
    new Set(
      membersOf(cluster)
        .map(
          article =>
            article?.feedUrl
        )
        .filter(Boolean)
    );

  const result =
    new Set();

  for (
    const source
    of sources || []
  ) {
    if (
      source?.enabled ===
      false
    ) {
      continue;
    }

    if (
      !urls.has(
        source?.url
      ) &&
      !urls.has(
        source?.fallbackUrl
      )
    ) {
      continue;
    }

    for (
      const destination
      of sourceDestinations(
        source
      )
    ) {
      result.add(
        destination
      );
    }
  }

  return eligibleClusterDestinations(cluster, [...result].sort(), sources);
}

