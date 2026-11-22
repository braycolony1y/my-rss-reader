// Deterministic evidence extraction for the ambiguous-pair resolver (see resolver.js).
// Everything here is pure text work: named entities, numbers and money amounts, places.
import { stripHtml } from '../text/normalize.js';

export const fold = value => String(value || '')
  .normalize('NFD').replace(/\p{M}+/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();

// Capitalised words that are never useful as entity evidence on their own.
const GENERIC = new Set(`the a an and or of to in on at for with from by as is are was were new news live video photo breaking update updates latest today
  mr mrs ms dr sir how why what when where who which will would after before over under about says say said monday tuesday wednesday thursday friday
  saturday sunday january february march april may june july august september october november december
  thu hai ba tu nam sau bay chu nhat thang tin bai anh clip nong moi hom nay ngay`.split(/\s+/));

// Upper-case tokens that are too generic to count as an acronym entity.
const GENERIC_ACRONYMS = new Set(['AI', 'TV', 'CEO', 'USD', 'VND', 'EUR', 'GDP', 'PM', 'AM', 'FAQ', 'LIVE', 'VIDEO', 'NEWS', 'THE', 'AND', 'FOR', 'NEW']);

// Folded place names. Capitalised sequences are looked up here (1 to 3 words).
const PLACES = new Set(`ha noi|ho chi minh|sai gon|da nang|hai phong|can tho|hue|quang ninh|quang nam|quang ngai|quang binh|quang tri|nghe an|thanh hoa|ha tinh|dong nai|binh duong|vung tau|ba ria|khanh hoa|nha trang|lam dong|da lat|dak lak|dak nong|gia lai|kon tum|binh thuan|binh phuoc|binh dinh|phu yen|ninh thuan|long an|tien giang|ben tre|tra vinh|vinh long|dong thap|ca mau|bac lieu|soc trang|hau giang|kien giang|phu quoc|an giang|tay ninh|bac giang|bac ninh|hai duong|hung yen|thai binh|nam dinh|ha nam|ninh binh|vinh phuc|phu tho|thai nguyen|lang son|cao bang|lao cai|yen bai|son la|dien bien|lai chau|hoa binh|ha giang|tuyen quang|bac kan|viet nam|vietnam|truong sa|hoang sa|bien dong|east sea|south china sea|
  united states|america|us|usa|u s|china|trung quoc|japan|nhat ban|south korea|han quoc|north korea|trieu tien|russia|nga|ukraine|israel|gaza|west bank|iran|iraq|syria|lebanon|yemen|saudi arabia|turkey|egypt|india|an do|pakistan|afghanistan|bangladesh|thailand|thai lan|singapore|malaysia|indonesia|philippines|myanmar|cambodia|campuchia|laos|taiwan|dai loan|hong kong|macau|australia|new zealand|canada|mexico|brazil|argentina|venezuela|cuba|chile|colombia|peru|germany|duc|france|phap|italy|spain|portugal|poland|netherlands|belgium|switzerland|sweden|norway|finland|greece|ireland|uk|britain|united kingdom|england|scotland|eu|european union|nato|africa|nigeria|south africa|kenya|ethiopia|sudan|libya|
  london|paris|berlin|moscow|kyiv|kiev|beijing|bac kinh|shanghai|thuong hai|shenzhen|tokyo|osaka|seoul|pyongyang|bangkok|jakarta|manila|kuala lumpur|delhi|mumbai|dubai|abu dhabi|tehran|baghdad|damascus|jerusalem|tel aviv|riyadh|cairo|washington|new york|los angeles|san francisco|silicon valley|california|texas|florida|chicago|boston|seattle|brussels|geneva|vienna|rome|madrid|lisbon|amsterdam|sydney|melbourne|toronto|wall street`.split('|').map(value => value.trim()));

// Country-level and bloc-level places stay in `places` (so they never count as entities) but are far
// too broad to be a pair's "place point": two unrelated stories about the US or China share them.
// City, province, region and sea names still count.
export const BROAD_PLACES = new Set(`viet nam|vietnam|united states|america|us|usa|u s|china|trung quoc|japan|nhat ban|south korea|han quoc|north korea|trieu tien|russia|nga|ukraine|israel|iran|iraq|syria|lebanon|yemen|saudi arabia|turkey|egypt|india|an do|pakistan|afghanistan|bangladesh|thailand|thai lan|singapore|malaysia|indonesia|philippines|myanmar|cambodia|campuchia|laos|taiwan|dai loan|australia|new zealand|canada|mexico|brazil|argentina|venezuela|cuba|chile|colombia|peru|germany|duc|france|phap|italy|spain|portugal|poland|netherlands|belgium|switzerland|sweden|norway|finland|greece|ireland|uk|britain|united kingdom|england|scotland|eu|european union|nato|africa|nigeria|south africa|kenya|ethiopia|sudan|libya`.split('|'));

const MONEY_WORDS = new Set(['usd', 'vnd', 'dong', 'euro', 'eur', 'yen', 'jpy', 'won', 'yuan', 'cny', 'gbp', 'pound', 'dollar', 'dollars', 'ty', 'trieu', 'nghin', 'ngan', 'billion', 'million', 'trillion', 'thousand', 'bn', 'mn', 'k']);
const SCALE = { ty: 1e9, billion: 1e9, bn: 1e9, trieu: 1e6, million: 1e6, mn: 1e6, nghin: 1e3, ngan: 1e3, thousand: 1e3, k: 1e3, trillion: 1e12 };

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’&.-]*/gu;
const isUpper = token => /^\p{Lu}/u.test(token);
const isAcronym = token => /^[\p{Lu}]{2,6}$/u.test(token.replace(/[.-]/g, ''));

function sentenceTokens(text) {
  // [{ token, first }] where first marks the grammatical sentence start (capital letter is not evidence).
  const result = [];
  for (const sentence of String(text || '').split(/(?<=[.!?:;])\s+|\s[-–—|]\s|\n+/u)) {
    const words = sentence.match(WORD) || [];
    words.forEach((word, index) => result.push({ token: word.replace(/^[.'’&-]+|[.'’&-]+$/g, ''), first: index === 0 }));
  }
  return result.filter(entry => entry.token);
}

/** Text used as evidence: title plus the leading part of the description or content. */
export function evidenceText(article) {
  const body = stripHtml(article?.description || article?.summary || article?.content || '').slice(0, 500);
  return `${article?.title || ''}. ${body}`;
}

/**
 * @returns {{ phrases:Set<string>, tokens:Set<string>, acronyms:Set<string>, places:Set<string>,
 *            numbers:Map<string,'money'|'percent'|'plain'> }}
 */
export function extractEvidence(article) {
  const text = evidenceText(article);
  const entries = sentenceTokens(text);
  const phrases = new Set(), tokens = new Set(), acronyms = new Set(), places = new Set();

  for (let i = 0; i < entries.length; i++) {
    const { token, first } = entries[i];
    if (!isUpper(token)) continue;
    const key = fold(token);
    const acronym = isAcronym(token) && !GENERIC_ACRONYMS.has(token.toUpperCase());
    if (acronym) { acronyms.add(key); if (PLACES.has(key)) places.add(key); continue; }
    if (isAcronym(token)) continue;
    if (!first && key.length >= 3 && !GENERIC.has(key)) tokens.add(key);
    // Capitalised runs (1 to 3 words): places by lookup, entity phrases from adjacent pairs.
    const run = [key];
    for (let j = i + 1; j < entries.length && j < i + 3 && !entries[j].first && isUpper(entries[j].token) && !isAcronym(entries[j].token); j++) run.push(fold(entries[j].token));
    for (let length = 1; length <= run.length; length++) if (PLACES.has(run.slice(0, length).join(' '))) places.add(run.slice(0, length).join(' '));
    if (run.length >= 2 && !run.slice(0, 2).some(word => GENERIC.has(word))) phrases.add(`${run[0]} ${run[1]}`);
  }
  // A place is not an "entity" too: keep the two channels separate so a shared city cannot double count.
  for (const place of places) { tokens.delete(place); for (const part of place.split(' ')) tokens.delete(part); }
  for (const phrase of [...phrases]) if (places.has(phrase) || phrase.split(' ').every(part => places.has(part))) phrases.delete(phrase);

  return { phrases, tokens, acronyms, places, numbers: extractNumbers(text) };
}

function normalizeAmount(raw) {
  const text = raw.replace(/\s+/g, '');
  // 1.234.567 / 1,234,567 are thousands separators; a single separator followed by 1-2 digits is a decimal.
  if (/^\d{1,3}([.,]\d{3})+$/.test(text)) return Number(text.replace(/[.,]/g, ''));
  if (/^\d+[.,]\d{1,2}$/.test(text) || /^\d+[.,]\d+$/.test(text)) return Number(text.replace(',', '.'));
  return Number(text.replace(/[.,]/g, ''));
}

/** Significant numbers and money/percent amounts, keyed so "25 tỷ USD" equals "$25 billion". */
export function extractNumbers(text) {
  const numbers = new Map();
  const source = String(text || '');
  const pattern = /([$€£₫])?\s?(\d[\d.,]*\d|\d)(?:\s?(%|[\p{L}]+))?/gu;
  for (const match of source.matchAll(pattern)) {
    const [, symbol, raw, tail] = match;
    let value = normalizeAmount(raw);
    if (!Number.isFinite(value)) continue;
    const word = fold(tail || '');
    const percent = tail === '%' || word === 'percent' || word === 'phan' && /^\s?tram/i.test(source.slice(match.index + match[0].length));
    const money = Boolean(symbol) || MONEY_WORDS.has(word);
    if (SCALE[word]) value *= SCALE[word];
    if (percent) { numbers.set(`percent:${value}`, 'percent'); continue; }
    if (money) { numbers.set(`money:${Number(value.toPrecision(4))}`, 'money'); continue; }
    const digits = raw.replace(/[^\d]/g, '').length;
    const year = /^(19|20)\d{2}$/.test(raw);
    const decimal = /[.,]\d{1,2}$/.test(raw) && !/^\d{1,3}([.,]\d{3})+$/.test(raw);
    if ((digits >= 3 && !year) || (decimal && digits >= 2)) numbers.set(`plain:${Number(value.toPrecision(6))}`, 'plain');
  }
  return numbers;
}
