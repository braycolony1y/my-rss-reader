import { detectArticleLanguage } from '../articles/language.js';
import { HOUR_MS } from '../config.js';
import { parsePublishedTimestamp } from '../dates/publication-time.js';
import { normalizeText, containsNormalizedPhrase, tokenOverlapCount, tokenSimilarity } from '../text/normalize.js';

const ACTION_GROUPS = {
  investigation: {
    en: ['investigate', 'investigation', 'probe', 'under investigation'],
    vi: ['dieu tra', 'xac minh']
  },
  arrest: {
    en: ['arrest', 'arrested', 'detain', 'detained', 'taken into custody'],
    vi: ['bat giu', 'tam giu', 'tam giam']
  },
  charge: {
    en: ['charge', 'charged', 'indict', 'indicted', 'prosecute'],
    vi: ['khoi to', 'truy to', 'cao buoc']
  },
  trial: {
    en: ['trial', 'stand trial', 'court hearing'],
    vi: ['xet xu', 'hau toa', 'phien toa']
  },
  conviction: {
    en: ['convict', 'convicted', 'found guilty'],
    vi: ['ket toi', 'tuyen co toi']
  },
  sentencing: {
    en: ['sentence', 'sentenced'],
    vi: ['ket an', 'tuyen an', 'linh an']
  },
  appeal: {
    en: ['appeal', 'appealed'],
    vi: ['khang cao', 'phuc tham']
  },
  sentenceUpheld: {
    en: ['uphold sentence', 'sentence upheld'],
    vi: ['y an', 'giu nguyen ban an']
  },
  resign: {
    en: ['resign', 'resigned', 'step down', 'quit'],
    vi: ['tu chuc', 'xin thoi', 'roi ghe']
  },
  appoint: {
    en: ['appoint', 'appointed', 'named as'],
    vi: ['bo nhiem', 'chi dinh']
  },
  nominate: {
    en: ['nominate', 'nominated'],
    vi: ['de cu']
  },
  acquire: {
    en: ['acquire', 'acquired', 'acquisition', 'buyout', 'merger'],
    vi: ['mua lai', 'sap nhap', 'thau tom']
  },
  launch: {
    en: ['launch', 'launched', 'release', 'released'],
    vi: ['ra mat', 'trinh lang', 'phat hanh']
  },
  approve: {
    en: ['approve', 'approved', 'passed'],
    vi: ['phe duyet', 'thong qua', 'chap thuan']
  },
  propose: {
    en: ['propose', 'proposed'],
    vi: ['de xuat', 'kien nghi']
  },
  earnings: {
    en: ['earnings', 'profit', 'revenue'],
    vi: ['ket qua kinh doanh', 'loi nhuan', 'doanh thu', 'bao lai']
  }
};

function extractActionGroups(article) {
  const text = normalizeText(
    [
      article?.title,
      article?.content
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 1500)
  );

  const detected = new Set();

  for (
    const [groupName, group]
    of Object.entries(ACTION_GROUPS)
  ) {
    const phrases = [
      ...group.en,
      ...group.vi
    ];

    if (
      phrases.some(phrase =>
        containsNormalizedPhrase(
          text,
          phrase
        )
      )
    ) {
      detected.add(groupName);
    }
  }

  return detected;
}

const SPORTS_HEADLINE_FOCUS_PATTERNS = {
  match_prediction: [
    /\bdu doan\b/,
    /\bnhan dinh\b/,
    /\bsoi keo\b/,
    /\bty so\b/,
    /\bscore prediction\b/,
    /\bmatch prediction\b/,
    /\bbetting odds\b/
  ],
  player_availability: [
    /\bchua ra san\b/,
    /\bkhong ra san\b/,
    /\bkhong thi dau\b/,
    /\bvang mat\b/,
    /\bchan thuong\b/,
    /\btreo gio\b/,
    /\bhas not played\b/,
    /\bhasn t played\b/,
    /\bruled out\b/,
    /\bunused substitute\b/
  ],
  event_attendance: [
    /\bdu khan\b/,
    /\bchu tich fifa\b/,
    /\bfifa president\b/,
    /\bin attendance\b/
  ]
};

function extractSportsHeadlineFocus(article) {
  const title = normalizeText(
    article?.title || ''
  );

  const detected = new Set();

  for (
    const [focus, patterns]
    of Object.entries(
      SPORTS_HEADLINE_FOCUS_PATTERNS
    )
  ) {
    if (
      patterns.some(pattern =>
        pattern.test(title)
      )
    ) {
      detected.add(focus);
    }
  }

  return detected;
}

const AIRLINE_HEADLINE_PATTERNS = {
  vietjet: [
    /\bvietjet\b/
  ],
  vietnam_airlines: [
    /\bvietnam airlines\b/
  ],
  bamboo_airways: [
    /\bbamboo airways\b/
  ],
  vietravel_airlines: [
    /\bvietravel airlines\b/
  ],
  pacific_airlines: [
    /\bpacific airlines\b/
  ],
  vasco: [
    /\bvasco\b/
  ]
};

function extractHeadlineAirlines(article) {
  const title = normalizeText(
    article?.title || ''
  );
  const detected = new Set();

  for (
    const [airline, patterns]
    of Object.entries(
      AIRLINE_HEADLINE_PATTERNS
    )
  ) {
    if (
      patterns.some(pattern =>
        pattern.test(title)
      )
    ) {
      detected.add(airline);
    }
  }

  return detected;
}

function extractHeadlineNumbers(article) {
  const normalized =
    String(article?.title || '')
      .replace(/,/g, '');

  return Array.from(
    normalized.matchAll(
      /\b\d+(?:\.\d+)?\b/g
    )
  ).map(match => match[0]);
}

function detectEventConflicts(
  articleA,
  articleB
) {
  const result = {
    hasHardConflict: false,
    hasSoftConflict: false,
    reasons: []
  };

  const timestampA =
    parsePublishedTimestamp(
      articleA?.pubDate
    );

  const timestampB =
    parsePublishedTimestamp(
      articleB?.pubDate
    );

  if (
    Number.isFinite(timestampA) &&
    Number.isFinite(timestampB)
  ) {
    const differenceHours =
      Math.abs(
        timestampA - timestampB
      ) /
      HOUR_MS;

    if (differenceHours > 72) {
      result.hasHardConflict = true;
      result.reasons.push(
        'Publication times are more than 72 hours apart'
      );
    } else if (differenceHours > 24) {
      result.hasSoftConflict = true;
      result.reasons.push(
        'Publication times are more than 24 hours apart'
      );
    }
  }

  // Explicit event dates check
  if (articleA?.eventDate && articleB?.eventDate && articleA.eventDate !== articleB.eventDate) {
    result.hasHardConflict = true;
    result.reasons.push('Conflicting explicit event dates');
  }

  const airlinesA =
    extractHeadlineAirlines(articleA);

  const airlinesB =
    extractHeadlineAirlines(articleB);

  if (
    airlinesA.size &&
    airlinesB.size &&
    ![...airlinesA].some(
      airline =>
        airlinesB.has(airline)
    )
  ) {
    result.hasHardConflict = true;
    result.reasons.push(
      `Different airline organizations: ${[
        ...airlinesA
      ].join(', ')} vs ${[
        ...airlinesB
      ].join(', ')}`
    );
  }

  const sportsFocusA =
    extractSportsHeadlineFocus(
      articleA
    );

  const sportsFocusB =
    extractSportsHeadlineFocus(
      articleB
    );

  if (
    sportsFocusA.size &&
    sportsFocusB.size &&
    ![...sportsFocusA].some(
      focus =>
        sportsFocusB.has(focus)
    )
  ) {
    result.hasHardConflict = true;
    result.reasons.push(
      `Different sports headline focus: ${[
        ...sportsFocusA
      ].join(', ')} vs ${[
        ...sportsFocusB
      ].join(', ')}`
    );
  }

  return result;
}

function countSharedValues(
  leftValues,
  rightValues
) {
  const rightSet =
    new Set(rightValues);

  let shared = 0;

  for (const value of leftValues) {
    if (rightSet.has(value)) {
      shared++;
    }
  }

  return shared;
}

function getEventEvidence(
  articleA,
  articleB
) {
  const languageA =
    articleA?.language ||
    detectArticleLanguage(
      articleA
    );

  const languageB =
    articleB?.language ||
    detectArticleLanguage(
      articleB
    );

  const crossLanguage =
    languageA !== 'unknown' &&
    languageB !== 'unknown' &&
    languageA !== languageB;

  const titleOverlap =
    tokenOverlapCount(
      articleA?.title,
      articleB?.title
    );

  const titleSimilarity =
    tokenSimilarity(
      articleA?.title,
      articleB?.title
    );

  const sharedNumbers =
    countSharedValues(
      extractHeadlineNumbers(
        articleA
      ),
      extractHeadlineNumbers(
        articleB
      )
    );

  const sharedActions =
    countSharedValues(
      extractActionGroups(
        articleA
      ),
      extractActionGroups(
        articleB
      )
    );

  let score = 0;

  if (titleOverlap >= 4) {
    score += 3;
  } else if (titleOverlap >= 3) {
    score += 2;
  } else if (titleOverlap >= 2) {
    score += 1;
  }

  if (titleSimilarity >= 0.45) {
    score += 2;
  } else if (
    titleSimilarity >= 0.30
  ) {
    score += 1;
  }

  if (sharedNumbers > 0) {
    score += 1;
  }

  if (sharedActions > 0) {
    score += 1;
  }

  return {
    score,
    crossLanguage,
    titleOverlap,
    titleSimilarity,
    sharedNumbers,
    sharedActions
  };
}

export { detectEventConflicts, getEventEvidence };
