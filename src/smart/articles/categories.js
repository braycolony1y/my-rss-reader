import { canonicalSmartCategory } from '../../utils/smart-destinations.js';
import { VALID_SMART_CATEGORIES } from '../config.js';
import { hostFromUrl } from '../sources/identity.js';
import { normalizeText, containsNormalizedPhrase } from '../text/normalize.js';
import { detectArticleLanguage } from './language.js';

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

function refineArticleCategory(
  item,
  initialCategory
) {
  initialCategory = canonicalSmartCategory(initialCategory);
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
        : 'news_global';
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
        : 'news_global'
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
  if (article.smartCategory) article = { ...article, smartCategory: canonicalSmartCategory(article.smartCategory) };
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
    : 'news_global';

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

export { isInvestingComSource, refineArticleCategory, inferCategory };
