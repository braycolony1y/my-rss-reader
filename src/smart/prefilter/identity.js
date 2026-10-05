import { createHash } from 'node:crypto';
import { normalizeArticleSourceUrl } from '../../article-source-state.js';
import { cleanUrl } from '../../utils/article-utils.js';
import { canonicalSourceUrl, hostFromUrl } from '../sources/identity.js';
import { stripHtml } from '../text/normalize.js';

const digest = value => createHash('sha256').update(value).digest('hex');
// Unlike scoring/dedup tokens, retain accents, numbers, negation and every word.
export const exactTitle = value => stripHtml(value || '').normalize('NFC').toLocaleLowerCase('vi').replace(/\s+/g, ' ').trim();
// Google News-style publisher suffixes observed in the supplied corpus. Only
// strip exact branding tied to the actual publisher host; never arbitrary suffixes.
const decorations = { 'vnexpress.net': ['vnexpress'], 'vov.vn': ['vov.vn'], 'cafef.vn': ['cafef'] };
export function safeTitle(article) {
  let title = exactTitle(article.title);
  const host = hostFromUrl(article.link);
  for (const [domain, brands] of Object.entries(decorations)) {
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    for (const brand of brands) {
      for (const separator of [' - ', ' | ', ' – ']) {
        if (title.endsWith(separator + brand)) title = title.slice(0, -(separator + brand).length).trim();
      }
    }
  }
  return title;
}
export function articleIdentity(article) {
  const url = canonicalSourceUrl(cleanUrl(normalizeArticleSourceUrl(article.link || '')));
  const title = exactTitle(article.title);
  const safe = safeTitle(article);
  const evidence = exactTitle([article.content, article.description, article.summary].filter(Boolean).join('\n'));
  // Revision guard applies EVEN to the same URL/ID. A changed headline or
  // newly available evidence must not inherit an obsolete terminal exclusion.
  const revision = digest(JSON.stringify([safe, evidence]));
  const origin = article.feedUrl || hostFromUrl(article.link);
  const trustedId = article.guid && origin ? `${origin}:${article.guid}` : (article.articleKey || '');
  return { url, title, safeTitle: safe, evidence, revision,
    key: digest(JSON.stringify([url || trustedId || safe, revision])),
    keys: [
      ...(trustedId ? [['reused_identity', `id:${trustedId}`]] : []),
      ...(url ? [['reused_url', `url:${url}`]] : []),
      ...(title ? [['reused_title', `title:${digest(title)}`]] : []),
      ...(safe ? [['reused_boilerplate_title', `safe:${digest(safe)}`]] : []),
      ...(article.contentHash ? [['reused_identity', `content:${article.contentHash}`]] : []),
    ] };
}
