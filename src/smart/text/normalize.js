import { decodeHTMLEntities } from '../../../feed-parsers.js';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on',
  'at', 'with', 'from', 'by', 'is', 'are', 'this', 'that', 'after',
  'new', 'says', 'say', 'said', 'as', 'it', 'its', 'be', 'has',
  'have', 'will', 'more', 'about', 'according', 'announces',
  'announced', 'report', 'reports', 'reported', 'official',
  'officials', 'market', 'markets', 'stock', 'stocks', 'share',
  'shares', 'price', 'prices', 'business', 'finance', 'financial',
  'global', 'world', 'national', 'local', 'state', 'country',
  'government', 'company', 'companies', 'group', 'industry',
  'percent', 'billion', 'million', 'year', 'years', 'month',
  'months', 'week', 'weeks', 'day', 'days', 'today', 'yesterday',
  'latest', 'breaking', 'update', 'updates', 'live', 'video',
  'photo', 'watch', 'can', 'could', 'would', 'should', 'may',
  'might', 'must', 'over', 'under', 'into', 'through', 'against',
  'what', 'why', 'how', 'when', 'where', 'who', 'which', 'while',
  'because', 'both', 'only', 'just', 'even', 'also', 'than',
  'other', 'another', 'some', 'any', 'all', 'every', 'much',
  'many', 'most', 'very', 'already', 'still',

  'va', 'la', 'cua', 'cho', 'voi', 'tai', 'tu', 'trong', 'tren',
  'sau', 'truoc', 'nhung', 'mot', 'cac', 'khi', 'duoc', 'co',
  'se', 've', 'theo', 'nay', 'dang', 'den', 'khong', 'nhieu',
  'chuyen', 'gia', 'tinh', 'thanh', 'quoc', 'viet', 'nam',
  'gioi', 'cong', 'ty', 'giam', 'doc', 'chu', 'tich', 'bo',
  'truong', 'lanh', 'dao', 'chinh', 'phu', 'dau', 'tu', 'du',
  'an', 'phat', 'trien', 'kinh', 'te', 'thi', 'truong', 'ngan',
  'hang', 'doanh', 'nghiep', 'phieu', 'chung', 'khoan', 'vang',
  'lai', 'suat', 'lam', 'xuat', 'khau', 'nhap', 'bat', 'dong',
  'san', 'nha', 'dat', 'tieu', 'dung', 'so', 'thu', 'hoi',
  'quan', 'tri', 'ban', 'hanh', 'quyet', 'dinh', 'thong', 'tin',
  'tuc', 'bao', 'cao', 'nguoi', 'dan', 'to', 'can', 'tra',
  'dieu', 'xu', 'ly', 'pham', 'giai', 'quyet', 'ho', 'tro',
  'tham', 'chuc', 'hoat', 'kien', 'van', 'de', 'ket', 'qua',
  'muc', 'thoi', 'gian', 'khu', 'vuc', 'pho', 'huyen', 'xa',
  'phuong', 'ngay', 'thang', 'ngoai', 'duoi', 'giua', 'lon',
  'nho', 'moi', 'cu', 'thap', 'tuy', 'nhien', 'do', 'nen',
  'phai', 'hoac', 'cung', 'hai', 'ba', 'bon', 'sau', 'bay',
  'tam', 'chin', 'muoi', 'tram', 'nghin', 'trieu', 'ty', 'dong',
  'usd', 'vnd', 'tuan', 'quy', 'hom', 'qua', 'mai'
]);

let batchStopTokens = new Set();

function stripHtml(value = '') {
  let decoded = String(value);

  for (let pass = 0; pass < 3; pass++) {
    const next = decodeHTMLEntities(decoded);
    if (next === decoded) break;
    decoded = next;
  }

  return decoded
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value = '') {
  return stripHtml(value)
    .toLocaleLowerCase('vi')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsNormalizedPhrase(normalizedText, phrase) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;

  const pattern = new RegExp(
    `(?:^|\\s)${escapeRegExp(normalizedPhrase).replace(/\s+/g, '\\s+')}(?:$|\\s)`,
    'i'
  );

  return pattern.test(normalizedText);
}

function cleanTitleForScoring(title) {
  if (!title) return '';

  let value = String(title).trim();

  value = value.replace(/^\[[^\]]+\]\s*|\([^)]+\)\s*/g, '');

  value = value.replace(
    /\s*[|–-]\s*[^\n|–-]{2,40}$/u,
    match => {
      if (
        /^[^\w\p{L}]*[\p{L}\d\s.&'"]+$/u.test(match) &&
        match.length < 42
      ) {
        return '';
      }
      return match;
    }
  );

  value = value.replace(
    /\s*[|–-]\s*[A-Z0-9\s.,&'"]+$/i,
    ''
  );

  value = value.replace(
    /\bprice prediction(?:\s*:\s*|\s+)\d{4}(?:,\s*\d{4})*(?:[-–]\d{4})?\b/gi,
    ''
  );

  value = value.replace(
    /\bhints? and answers? for\s+[a-z]+\s+\d{1,2}\b/gi,
    ''
  );

  value = value.replace(
    /\b(?:dự báo giá|bảng giá|cập nhật giá)\b/gi,
    ''
  );

  return value.trim() || String(title).trim();
}

function updateBatchStopTokens(articles) {
  batchStopTokens = new Set();

  if (!Array.isArray(articles) || articles.length < 50) {
    return;
  }

  const counts = new Map();
  const threshold = Math.max(
    15,
    Math.floor(articles.length * 0.025)
  );

  for (const article of articles) {
    const words = new Set(
      normalizeText(cleanTitleForScoring(article.title))
        .split(' ')
        .filter(
          word =>
            word.length > 2 &&
            !STOP_WORDS.has(word)
        )
    );

    for (const word of words) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }

  for (const [word, count] of counts.entries()) {
    if (count > threshold) {
      batchStopTokens.add(word);
    }
  }
}

function titleTokens(title) {
  return new Set(
    normalizeText(cleanTitleForScoring(title))
      .split(' ')
      .filter(
        word =>
          word.length > 2 &&
          !STOP_WORDS.has(word) &&
          !batchStopTokens.has(word)
      )
  );
}

function tokenSimilarity(left, right) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let shared = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared++;
    }
  }

  const union =
    leftTokens.size +
    rightTokens.size -
    shared;

  const jaccard = union ? shared / union : 0;
  const containment =
    shared /
    Math.min(leftTokens.size, rightTokens.size);

  return Math.max(
    jaccard,
    containment * 0.82
  );
}

function tokenOverlapCount(left, right) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);

  let shared = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared++;
    }
  }

  return shared;
}

export { stripHtml, normalizeText, containsNormalizedPhrase, cleanTitleForScoring, updateBatchStopTokens, titleTokens, tokenSimilarity, tokenOverlapCount };
