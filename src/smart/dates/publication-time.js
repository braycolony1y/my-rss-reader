import { VIETNAM_OFFSET_MS } from '../config.js';

function freshestPublishedAt(articles = []) {
  const times =
    (Array.isArray(articles) ? articles : [])
      .map(article =>
        parsePublishedTimestamp(
          article?.pubDate ||
          article?.date ||
          article?.publishedAt
        )
      )
      .filter(Number.isFinite);

  return times.length
    ? Math.max(...times)
    : 0;
}

function parsePublishedTimestamp(value) {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'number') {
    return value < 100000000000
      ? value * 1000
      : value;
  }

  let raw = String(value || '')
    .replace(/[\u200B-\u200D\u202F\u00A0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw) return NaN;

  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    return raw.length <= 10
      ? numeric * 1000
      : numeric;
  }

  raw = raw
    .replace(/\bSA\b/i, 'AM')
    .replace(/\bCH\b/i, 'PM');

  const makeVietnamTime = (
    year,
    month,
    day,
    hour = 0,
    minute = 0,
    second = 0,
    meridiem = ''
  ) => {
    year = Number(year);
    month = Number(month);
    day = Number(day);
    hour = Number(hour || 0);
    minute = Number(minute || 0);
    second = Number(second || 0);

    if (meridiem) {
      if (hour === 12) hour = 0;
      if (
        String(meridiem).toUpperCase() ===
        'PM'
      ) {
        hour += 12;
      }
    }

    if (
      year < 2000 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      return NaN;
    }

    const timestamp =
      Date.UTC(
        year,
        month - 1,
        day,
        hour,
        minute,
        second
      ) -
      VIETNAM_OFFSET_MS;

    const check = new Date(
      timestamp + VIETNAM_OFFSET_MS
    );

    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      return NaN;
    }

    return timestamp;
  };

  const hasExplicitZone =
    /(?:Z|[+-]\d{2}:?\d{2}|GMT[+-]\d{1,2})$/i.test(raw) ||
    /\s(?:GMT|UTC|UT|ICT|[A-Z]{3,4})$/i.test(raw);

  if (hasExplicitZone) {
    const normalized = raw
      .replace(/\sICT$/i, ' GMT+0700')
      .replace(/GMT\+7$/i, 'GMT+0700');

    return new Date(normalized).getTime();
  }

  const yearFirst = raw.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  );

  if (yearFirst) {
    return makeVietnamTime(
      yearFirst[1],
      yearFirst[2],
      yearFirst[3],
      yearFirst[4],
      yearFirst[5],
      yearFirst[6],
      yearFirst[7]
    );
  }

  const localNumeric = raw.match(
    /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  );

  if (localNumeric) {
    const first = Number(localNumeric[1]);
    const second = Number(localNumeric[2]);
    const hasMeridiem =
      Boolean(localNumeric[7]);

    const monthFirst =
      second > 12 ||
      (
        first <= 12 &&
        second <= 12 &&
        hasMeridiem
      );

    const month = monthFirst
      ? first
      : second;

    const day = monthFirst
      ? second
      : first;

    return makeVietnamTime(
      localNumeric[3],
      month,
      day,
      localNumeric[4],
      localNumeric[5],
      localNumeric[6],
      localNumeric[7]
    );
  }

  return new Date(
    `${raw} GMT+0700`
  ).getTime();
}

function safeDate(value) {
  const timestamp =
    parsePublishedTimestamp(value);

  return Number.isFinite(timestamp) &&
    timestamp > 0
    ? timestamp
    : Date.now();
}

function toVietnamIso(value) {
  const timestamp = safeDate(value);

  const vietnamWallClock = new Date(
    timestamp + VIETNAM_OFFSET_MS
  ).toISOString();

  return `${vietnamWallClock.slice(0, -1)}+07:00`;
}

export { freshestPublishedAt, parsePublishedTimestamp, safeDate, toVietnamIso };
