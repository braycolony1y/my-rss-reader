import { sourceFetchPolicyIdentity } from './fetch-identity.js';
import { EXCLUDED_SMART_FEED_URLS } from '../config.js';

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

function canonicalSourceIdentity(article) {
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

function isExcludedFromSmart(
  article,
  dynamicExcludedUrls = null
) {
  return isExcludedSmartUrl(
    article?.feedUrl,
    dynamicExcludedUrls
  );
}

export { hostFromUrl, canonicalSourceUrl, sourceFetchPolicyIdentity, canonicalSourceIdentity, publisherIcon, isExcludedSmartUrl, isExcludedFromSmart };
