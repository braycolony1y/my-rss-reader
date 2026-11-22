// Routine multi-outlet pattern detection (English + Vietnamese), used by the ranker to
//   1. damp the corroboration/velocity boost, and
//   2. never grant the hot-news floor.
//
// Many outlets covering the same match result, festival, anniversary, award ceremony, news
// digest or state-media wire repost says little about how much a story matters. Hard-news
// stakes (deaths, disasters, attacks) exempt a story from the sport/festival/anniversary/
// award patterns, so a stadium stampede or a festival fire is still treated as news.
import { eventMatch, isRoundupTitle } from './roundups.js';
import { NEWS_RULES, TECH_RULES } from '../smart/prefilter/policy.js';
import { ROUTINE_DAMPER } from './config.js';
import { norm, publisherOf, stripHtml } from './features.js';

// All patterns run on norm() text: lowercase, diacritics stripped.
const SPORTS = /\b(?:vs\.?|versus|beats?|defeat(?:s|ed)?|thrash(?:es|ed)?|stuns?|full.?time|half.?time|match report|player ratings|line.?ups?|fixtures?|standings|group stage|quarter.?finals?|semi.?finals?|premier league|la liga|serie a|bundesliga|ligue 1|champions league|europa league|world cup|euro 20\d\d|nba|nfl|nhl|mlb|wimbledon|grand slam|grand prix|formula 1|f1|ufc|boxing|tennis|golf|cricket|rugby)\b|\b(?:bong da|ket qua|ty so|lich thi dau|truc tiep bong da|tran dau|vong \d+|v.?league|ngoai hang anh|sea games|asiad|olympic|asian cup|hlv|doi tuyen|ban thang|vo dich|giai dau|chung ket|ban ket|tu ket|bong chuyen|bong ro|quan vot|cau long|the thao|bxh|vong loai)\b/;
const FESTIVAL = /\b(?:festival|carnival|fireworks?|lunar new year|tet holiday|new year'?s eve|mid.?autumn|parade|fair opens?|expo opens?|holiday season|long weekend)\b|\b(?:le hoi|dai le|tuan le|ngay hoi|dem hoi|phao hoa|dem nhac|lien hoan|hoi cho|hoi sach|trung thu|tet nguyen dan|dem giao thua|dien diu|chuong trinh nghe thuat|van hoa hoi tu)\b/;
const ANNIVERSARY = /\b(?:\d+(?:st|nd|rd|th) anniversary|anniversary|commemorat\w*|birthday|remembrance|memorial service|centenary|bicentenary|founding day)\b|\b(?:ky niem|tuong niem|ngay thanh lap|ngay truyen thong|ngay quoc khanh|sinh nhat|le dang huong|dang huong|truyen thong \d+ nam|\d+ nam (?:thanh lap|ngay))\b/;
const AWARD = /\b(?:awards?|oscars?|grammys?|emmys?|golden globes?|baftas?|nominees?|nominations?|red carpet|ceremony|prizes?|miss universe|miss world|beauty pageant)\b|\b(?:trao giai|giai thuong|vinh danh|le trao|lien hoan phim|hoa hau|a hau|de cu|cuoc thi|thang giai|sao viet)\b/;
// Stakes that keep sport/festival/anniversary/award stories newsworthy.
const HIGH_STAKES = /\b(?:killed|dead|deaths?|death toll|dies|died|injur\w*|stampede|collapse[sd]?|explosion|fire|shooting|terror\w*|attack(?:s|ed)?|earthquake|flood\w*|typhoon|hurricane|tsunami|evacuat\w*|riot|arrested|scandal|doping|banned)\b|\b(?:thiet mang|tu vong|chet nguoi|bi thuong|giay dap|dong dat|lu lut|khung bo|bat giu|be boi|doping|cam thi dau)\b/;
// Short Vietnamese words that are ambiguous once diacritics are stripped (nổ/nợ, sập/sắp, cháy/chạy, bão/báo) are matched with diacritics.
const HIGH_STAKES_VI = /(?<![\p{L}\p{N}])(?:nổ|cháy|sập|bão|ngập|tử nạn|thương vong)(?![\p{L}\p{N}])/u;

/**
 * Domains of state-run or state-aligned Vietnamese outlets that routinely carry the same
 * wire text (VNA, Nhân Dân, VTV, VOV ...). Coverage that is only these outlets and nearly
 * identical in wording is a repost chain, not independent corroboration.
 */
export const STATE_MEDIA_DOMAINS = new Set([
  'vnanet.vn', 'baotintuc.vn', 'vtv.vn', 'vov.vn', 'vovworld.vn', 'nhandan.vn', 'qdnd.vn', 'cand.vn', 'sggp.org.vn', 'hanoimoi.vn',
  'baochinhphu.vn', 'chinhphu.vn', 'quochoi.vn', 'baophapluat.vn', 'laodong.vn', 'dangcongsan.vn', 'tapchicongsan.vn', 'vietnamplus.vn',
  'bnews.vn', 'thanhtra.com.vn', 'baodansinh.vn', 'xaydungchinhsach.chinhphu.vn', 'vtc.vn', 'truyenhinhnhandan.vn', 'baoquocte.vn',
  'xinhua.net', 'xinhuanet.com', 'news.cn', 'cgtn.com', 'china.org.cn', 'chinadaily.com.cn', 'globaltimes.cn', 'tass.com', 'tass.ru', 'ria.ru', 'rt.com', 'sputnikglobe.com'
]);

export const ROUTINE_KINDS = Object.freeze(['sports', 'festival', 'anniversary', 'award', 'digest', 'state_media']);

const share = (titles, test) => titles.length ? titles.filter(test).length / titles.length : 0;

/**
 * Detect routine patterns of a cluster.
 * @returns {{kinds:string[], strength:number}} strength is the damper strength to apply (0 when routine-free)
 */
export function detectRoutine(cluster, { strength = ROUTINE_DAMPER.strength, maxStrength = ROUTINE_DAMPER.maxStrength } = {}) {
  const members = cluster.members;
  const titles = members.map(m => stripHtml(m.title));
  const normed = titles.map(t => norm(t));
  const kinds = [];
  const stakes = share(normed, t => HIGH_STAKES.test(t)) >= 0.5 || share(titles.map(t => t.toLowerCase()), t => HIGH_STAKES_VI.test(t)) >= 0.5;
  // A pattern applies when it describes most member headlines (or the lead headline of a small cluster).
  const dominant = re => share(normed, t => re.test(t)) >= 0.5;
  if (!stakes) {
    if (dominant(SPORTS)) kinds.push('sports');
    if (dominant(FESTIVAL)) kinds.push('festival');
    if (dominant(ANNIVERSARY)) kinds.push('anniversary');
    if (dominant(AWARD)) kinds.push('award');
  }
  if (share(titles, isRoundupTitle) >= 0.5) kinds.push('digest');
  // policy.js exclusion rules for ceremonial events / awards (Vietnamese news and tech desks).
  if (!kinds.length && !stakes) {
    const ceremonial = [...NEWS_RULES, ...TECH_RULES].filter(([code]) => /CEREMONIAL|EVENT|AWARD/.test(code)).map(([, re]) => re);
    if (ceremonial.length && share(normed, t => ceremonial.some(re => re.test(t))) >= 0.5) kinds.push('festival');
  }
  // State-media repost chain: >= 3 outlets, all state media, with nearly identical wording.
  const outlets = [...new Set(members.map(m => publisherOf(m)))];
  if (outlets.length >= 3 && outlets.every(o => STATE_MEDIA_DOMAINS.has(o))) {
    let pairs = 0, similar = 0;
    for (let i = 1; i < titles.length && i < 8; i++) { pairs++; if (eventMatch(titles[0], titles[i]).similarity >= 0.5) similar++; }
    if (pairs && similar / pairs >= 0.5) kinds.push('state_media');
  }
  if (!kinds.length) return { kinds, strength: 0 };
  return { kinds, strength: Math.min(maxStrength, strength * (1 + 0.25 * (kinds.length - 1))) };
}
