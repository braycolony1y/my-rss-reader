import { normalizeText, cleanTitleForScoring } from '../text/normalize.js';

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

function dedupeGoogleNewsWrappers(
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

export { dedupeGoogleNewsWrappers };
