import { normalizeArticleSourceUrl } from '../../article-source-state.js';
import { canonicalSmartCategory } from '../../utils/smart-destinations.js';
import { HOUR_MS, DAY_MS } from '../config.js';
import { parsePublishedTimestamp, toVietnamIso } from '../dates/publication-time.js';
import { hostFromUrl, publisherIcon } from '../sources/identity.js';
import { stripHtml } from '../text/normalize.js';
import { inferCategory, refineArticleCategory } from './categories.js';
import { detectArticleLanguage } from './language.js';
import { createHash } from 'node:crypto';

function normalizeArticle(
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
    canonicalSmartCategory(source.category) ||
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

export { normalizeArticle };
