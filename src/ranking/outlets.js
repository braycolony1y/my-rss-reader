// Distinct real outlets of a story: aggregators are dropped, one publisher under several hostnames or feeds
// counts once, and syndicated or near-identical reposts (same wire copy under different domains) count once.
// Pure functions, no I/O.

/**
 * News aggregators republish headlines of others; they are not originators and never count as an outlet
 * for the hot floor (they still count for the corroboration features, which the model was fitted with).
 */
export const AGGREGATOR_DOMAINS = new Set(['news.google.com', 'news.google.com.vn', 'google.com', 'google.com.vn', 'techmeme.com', 'memeorandum.com', 'msn.com',
  'flipboard.com', 'feedly.com', 'newsbreak.com', 'ground.news', 'yahoo.com', 'news.yahoo.com', 'baomoi.com', 'smartnews.com']);

/** Hosts where every subdomain is a different publisher (blogs, newsletters): never collapse these. */
const SHARED_HOSTS = new Set(['blogspot.com', 'wordpress.com', 'substack.com', 'medium.com', 'github.io', 'tumblr.com', 'vercel.app', 'netlify.app', 'pages.dev']);
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);

/** Registrable domain of a hostname (edition.cnn.com -> cnn.com, www.bbc.co.uk -> bbc.co.uk); non-hostnames pass through. */
export function registrableDomain(host) {
  const h = String(host || '').toLowerCase().replace(/^(www\.|m\.|amp\.)/, '').replace(/\.$/, '');
  if (!/^[a-z0-9.-]+$/.test(h) || !h.includes('.')) return h;
  const labels = h.split('.');
  if (labels.length <= 2) return h;
  const tail2 = labels.slice(-2).join('.');
  if (SHARED_HOSTS.has(tail2)) return labels.slice(-3).join('.');
  if (SECOND_LEVEL.has(labels[labels.length - 2]) && labels[labels.length - 1].length === 2) return labels.slice(-3).join('.');
  return tail2;
}

export const isAggregator = publisher => AGGREGATOR_DOMAINS.has(publisher) || AGGREGATOR_DOMAINS.has(registrableDomain(publisher));

/** Publisher name reduced to a comparable key: no diacritics, lowercase, no "the", no ".com"-style tail, letters and digits only. */
export const publisherNameKey = (name, keepThe = false) => {
  const k = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()
    .replace(/&[a-z#0-9]+;/g, ' ').replace(/\.(com|net|org|vn|co\.uk|io)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return keepThe ? k : k.replace(/^the /, '');
};

/** Well-known publisher names (as written by Google News) whose name does not spell their domain. Keys are publisherNameKey values. */
const PUBLISHER_ALIASES = new Map(Object.entries({
  'reuters': 'reuters.com', 'ap': 'apnews.com', 'ap news': 'apnews.com', 'associated press': 'apnews.com', 'bloomberg': 'bloomberg.com', 'bloomberg com': 'bloomberg.com',
  'cnbc': 'cnbc.com', 'cnn': 'cnn.com', 'bbc': 'bbc.co.uk', 'bbc news': 'bbc.co.uk', 'new york times': 'nytimes.com', 'ny times': 'nytimes.com', 'washington post': 'washingtonpost.com',
  'wall street journal': 'wsj.com', 'wsj': 'wsj.com', 'financial times': 'ft.com', 'guardian': 'theguardian.com', 'al jazeera': 'aljazeera.com', 'al jazeera english': 'aljazeera.com',
  'ars technica': 'arstechnica.com', 'verge': 'theverge.com', 'techcrunch': 'techcrunch.com', 'wired': 'wired.com', 'engadget': 'engadget.com', 'zdnet': 'zdnet.com',
  'fox news': 'foxnews.com', 'nbc news': 'nbcnews.com', 'abc news': 'abcnews.go.com', 'cbs news': 'cbsnews.com', 'npr': 'npr.org', 'politico': 'politico.com', 'axios': 'axios.com',
  'forbes': 'forbes.com', 'business insider': 'businessinsider.com', 'marketwatch': 'marketwatch.com', 'yahoo finance': 'finance.yahoo.com', 'south china morning post': 'scmp.com',
  'nikkei asia': 'asia.nikkei.com', 'vnexpress': 'vnexpress.net', 'vnexpress international': 'vnexpress.net', 'tuoi tre': 'tuoitre.vn', 'tuoi tre online': 'tuoitre.vn', 'tuoi tre news': 'tuoitre.vn',
  'thanh nien': 'thanhnien.vn', 'dan tri': 'dantri.com.vn', 'bao dan tri': 'dantri.com.vn', 'vietnamnet': 'vietnamnet.vn', 'vietnamnet news': 'vietnamnet.vn', 'zing news': 'znews.vn', 'znews': 'znews.vn',
  'tien phong': 'tienphong.vn', 'nhan dan': 'nhandan.vn', 'bao nhan dan': 'nhandan.vn', 'lao dong': 'laodong.vn', 'vietnamplus': 'vietnamplus.vn', 'vov': 'vov.vn', 'vtv': 'vtv.vn', 'vtv news': 'vtv.vn',
  'bao chinh phu': 'baochinhphu.vn', 'cafef': 'cafef.vn', 'cafebiz': 'cafebiz.vn', 'kenh14': 'kenh14.vn', 'bao dau tu': 'baodautu.vn', 'vietnam investment review': 'vir.com.vn',
  'cong an nhan dan': 'cand.com.vn', 'bao phap luat': 'baophapluat.vn', 'tap chi cong san': 'tapchicongsan.org.vn', 'bao quan doi nhan dan': 'qdnd.vn', 'sai gon giai phong': 'sggp.org.vn', 'sggp': 'sggp.org.vn',
  'nguoi lao dong': 'nld.com.vn', 'tuoitre vn': 'tuoitre.vn', 'vnexpress net': 'vnexpress.net', 'thanhnien vn': 'thanhnien.vn', 'vietnam news': 'vietnamnews.vn', 'the saigon times': 'thesaigontimes.vn', 'saigon times': 'thesaigontimes.vn'
}));

/** Normalised outlet key for a publisher name: a domain for a known alias, otherwise the compact name (no dots), which outletGroups matches against domain labels. */
export function publisherKey(name) {
  const k = publisherNameKey(name);
  if (k.length < 2) return null;
  // "The" is kept in the compact key because domains keep it (thenextweb.com, theglobeandmail.com).
  return PUBLISHER_ALIASES.get(k) || publisherNameKey(name, true).replace(/ /g, '');
}

/** Trailing " - Publisher" / " | Publisher" of a Google News headline, or null. */
export const titlePublisher = title => String(title || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().match(/\s[-–—|]\s+([^-–—|]{2,40})$/u)?.[1]?.trim() || null;

/**
 * Real publisher of an aggregator item as an outlet key (domain or compact name), or null when it cannot be told.
 * Order: a source field if the feed gave one (`source` string or {title|name, url}); the host of the resolved
 * article link when it is not itself an aggregator; the trailing " - Publisher" of the headline.
 */
export function resolveAggregatorPublisher(article) {
  const src = article?.source ?? article?.sourceName;
  const srcName = typeof src === 'string' ? src : src?.title || src?.name;
  const srcUrl = typeof src === 'object' ? src?.url : '';
  for (const url of [srcUrl, article?.link]) {
    try {
      const host = registrableDomain(new URL(url).hostname);
      if (host && !isAggregator(host)) return host;
    } catch { /* not a URL */ }
  }
  const host = registrableDomain(String(article?.domain || '').toLowerCase());
  // Techmeme and Memeorandum end a headline with "(Author/Publisher)".
  const paren = host === 'techmeme.com' || host === 'memeorandum.com' ? String(article?.title || '').match(/\(([^()]{2,80})\)\s*$/)?.[1]?.split('/').pop() : null;
  return publisherKey(srcName) || publisherKey(paren) || publisherKey(titlePublisher(article?.title));
}

/** Outlet key used to count a member as an outlet: its own domain, or the resolved publisher for an aggregator item (null = uncountable). */
export const outletOf = (publisher, member) => (isAggregator(publisher) ? member?.outlet || null : publisher);

const clean = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
/** Headline reduced to comparable words: lowercase, no punctuation, no trailing " - Publisher" / " | Publisher" tag. */
export const syndicationKey = title => clean(title).replace(/\s+[-–—|]\s+[^-–—|]{2,40}$/u, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const leadKey = content => clean(content).slice(0, 160).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export const SYNDICATION = Object.freeze({
  /** Token Jaccard or normalised Levenshtein similarity of two headlines at or above this = the same piece. */
  titleSimilarity: 0.9,
  /** A lead (first 160 chars) shared by two outlets counts only when at least this long (boilerplate is shorter). */
  minLeadChars: 60
});

const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let shared = 0; for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
};
/** 1 - editDistance / maxLength, with an early exit once the distance cannot reach `min`. */
export function levenshteinSimilarity(a, b, min = 0) {
  const n = Math.max(a.length, b.length);
  if (!n) return 1;
  if (Math.abs(a.length - b.length) / n > 1 - min) return 0;
  const limit = Math.floor((1 - min) * n);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > limit) return 0;
    prev = cur;
  }
  return 1 - prev[b.length] / n;
}

/**
 * Group the members of a story into distinct outlets. Members are linked when they share a registrable
 * domain, or have near-identical headlines (token Jaccard or Levenshtein >= SYNDICATION.titleSimilarity),
 * or the same lead text; linked members form one outlet (transitively).
 * @param {{title:string, content?:string}[]} members
 * @param {string[]} publishers publisher id of each member (hostname), same order
 * @returns {number[]} group id per member (0..k-1, first-appearance order)
 */
export function outletGroups(members, publishers) {
  const n = members.length, parent = Array.from({ length: n }, (_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  const reg = publishers.map(registrableDomain);
  // A publisher known only by name ("thenextweb") matches the domain whose first label spells it (thenextweb.com).
  const label = r => (r.includes('.') ? r.split('.')[0] : r);
  const keys = members.map(m => syndicationKey(m.title));
  const tokens = keys.map(k => new Set(k.split(' ').filter(Boolean)));
  const leads = members.map(m => leadKey(m.content));
  const { titleSimilarity, minLeadChars } = SYNDICATION;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (find(i) === find(j)) continue;
    if (reg[i] === reg[j]) { union(i, j); continue; }
    if ((!reg[i].includes('.') || !reg[j].includes('.')) && label(reg[i]).length >= 3 && label(reg[i]) === label(reg[j])) { union(i, j); continue; }
    if (keys[i] && (keys[i] === keys[j] || jaccard(tokens[i], tokens[j]) >= titleSimilarity ||
      (Math.abs(keys[i].length - keys[j].length) <= 0.1 * Math.max(keys[i].length, keys[j].length) && levenshteinSimilarity(keys[i], keys[j], titleSimilarity) >= titleSimilarity))) { union(i, j); continue; }
    if (leads[i].length >= minLeadChars && leads[i] === leads[j]) union(i, j);
  }
  const ids = new Map();
  return Array.from({ length: n }, (_, i) => { const r = find(i); if (!ids.has(r)) ids.set(r, ids.size); return ids.get(r); });
}
