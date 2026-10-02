import { isEnglishArticle } from '../articles/language.js';
import { safeDate } from '../dates/publication-time.js';

function isPaywalledSource(article) {
  const link = String(
    article?.link ||
    article?.url ||
    ''
  ).toLowerCase();

  const feed = String(
    article?.feedTitle ||
    article?.source ||
    ''
  ).toLowerCase();

  return /(?:barrons\.com|barron['’s]|wsj\.com|wall street journal|bloomberg\.com|ft\.com|financial times|thetimes\.co\.uk|economist\.com)/i.test(
    `${link} ${feed}`
  );
}

function chooseRepresentative(articles) {
  return [...articles].sort(
    (left, right) => {
      const leftPaywalled =
        isPaywalledSource(left);

      const rightPaywalled =
        isPaywalledSource(right);

      if (
        leftPaywalled !==
        rightPaywalled
      ) {
        return leftPaywalled
          ? 1
          : -1;
      }

      if (
        left.smartCategory ===
        'tech'
      ) {
        const leftEnglish =
          isEnglishArticle(left);

        const rightEnglish =
          isEnglishArticle(right);

        if (
          leftEnglish !==
          rightEnglish
        ) {
          return rightEnglish
            ? 1
            : -1;
        }
      }

      const weightDifference =
        Number(
          right.sourceWeight || 1
        ) -
        Number(
          left.sourceWeight || 1
        );

      if (weightDifference) {
        return weightDifference;
      }

      const reliableDifference =
        Number(
          right.publicationTimeReliable !==
          false
        ) -
        Number(
          left.publicationTimeReliable !==
          false
        );

      if (reliableDifference) {
        return reliableDifference;
      }

      const contentDifference =
        Math.min(
          String(
            right.content || ''
          ).length,
          900
        ) -
        Math.min(
          String(
            left.content || ''
          ).length,
          900
        );

      if (contentDifference) {
        return contentDifference;
      }

      const imageDifference =
        Number(Boolean(right.image)) -
        Number(Boolean(left.image));

      if (imageDifference) {
        return imageDifference;
      }

      return (
        safeDate(right.pubDate) -
        safeDate(left.pubDate)
      );
    }
  )[0];
}

export { chooseRepresentative };
