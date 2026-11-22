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
  const keys = members.map(m => syndicationKey(m.title));
  const tokens = keys.map(k => new Set(k.split(' ').filter(Boolean)));
  const leads = members.map(m => leadKey(m.content));
  const { titleSimilarity, minLeadChars } = SYNDICATION;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (find(i) === find(j)) continue;
    if (reg[i] === reg[j]) { union(i, j); continue; }
    if (keys[i] && (keys[i] === keys[j] || jaccard(tokens[i], tokens[j]) >= titleSimilarity ||
      (Math.abs(keys[i].length - keys[j].length) <= 0.1 * Math.max(keys[i].length, keys[j].length) && levenshteinSimilarity(keys[i], keys[j], titleSimilarity) >= titleSimilarity))) { union(i, j); continue; }
    if (leads[i].length >= minLeadChars && leads[i] === leads[j]) union(i, j);
  }
  const ids = new Map();
  return Array.from({ length: n }, (_, i) => { const r = find(i); if (!ids.has(r)) ids.set(r, ids.size); return ids.get(r); });
}
