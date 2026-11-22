import { plainBlockedText, normalizeBlockedText } from './content-filter.js';

// Deterministic keyword suggestions for the "Not interested" popup. No model is consulted.
// Candidates: Vietnamese 2-3 syllable phrases, English words and bigrams, and capitalised
// name sequences (people, brands, clubs, places). Score: weighted term frequency in the
// article text multiplied by an inverse document frequency over recent articles.

export const SUGGESTION_LIMIT = 8;
export const IDF_WINDOW_MS = 14 * 86400000;
export const IDF_REFRESH_MS = 30 * 60000;
const MAX_IDF_DOCS = 40000;
const FIELD_WEIGHTS = { title: 3, member: 2, snippet: 0.6 };

const VI_DIACRITICS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

const wordSet = text => new Set(text.split(/\s+/).filter(Boolean));

const VI_STOP = wordSet(`
và của là có được cho các những một này đó trong với để khi đã sẽ đang không cũng như từ về tại theo sau trước
hơn rất nhiều vẫn lại ra vào lên xuống mà nên thì hay hoặc nhưng nếu vì bởi do còn đều chỉ cả mọi mỗi
đây kia ấy nào gì ai đâu sao thế vậy bị bằng qua tới đến trên dưới giữa ngoài phải cần muốn sau khi
tuy song mới cùng nữa luôn đã từng sắp vừa thêm hết đủ khá quá lắm
anh chị em ông bà tôi chúng họ mình
biết nói rằng cho rằng thấy cho
năm tháng ngày tuần hôm nay qua mai sáng chiều tối đêm giờ phút
người việc điều cái chiếc con bên phía
hơn kém tới đây
`);

const VI_GENERIC = wordSet(`
thông tin tin tức mới nhất video clip ảnh hình bài viết đọc xem tiếp chi tiết cập nhật báo cáo thời gian
vấn đề trường hợp hoạt động công việc kết quả tình hình tình trạng nội dung phát biểu chia sẻ
`);

const EN_STOP = wordSet(`
the a an and or but if then than so of to in on at by for with from into onto over under about after before
between through during without within against among amid is are was were be been being am do does did done
has have had having will would shall should can could may might must not no nor yes it its this that these
those he she they we you i me him her them us his hers their our your my who whom whose which what when
where why how all any both each few more most other some such only own same too very just also as up out
off down again further once here there while because until upon per via vs ahead
says said say saying report reports reported reporting new news first last year years week weeks day days
today tonight yesterday tomorrow latest live update updates breaking video photos photo watch read more
one two three four five six seven eight nine ten get gets got make makes made take takes took back set
now still even much many like back around against next top best after
`);

const NAME_CONNECTORS = wordSet('of de van von bin al el da di du la le del the');

// Phrases made only of generic news words that survive token-level stopping.
const GENERIC_PHRASES = new Set([
    'tin tức', 'thông tin', 'mới nhất', 'cập nhật', 'breaking news', 'press release', 'full story',
]);

const SEGMENT_BREAK = /[,:;!?"“”„()[\]{}|–—…•·]|\.(?=\s|$)|\s[-/]\s|\s+['‘’]|['‘’]\s/u;
const TOKEN = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;
const indexTokens = text => (text.match(TOKEN) || []).map(word => word.replace(/['’]s$/i, ''));

function tokenizeSegments(text) {
    const segments = [];
    for (const raw of plainBlockedText(text).split(SEGMENT_BREAK)) {
        const tokens = (raw.match(TOKEN) || []).map(word => {
            const surface = word.replace(/['’]s$/i, '');
            return { surface, key: surface.toLocaleLowerCase('vi-VN') };
        });
        if (tokens.length) segments.push(tokens);
    }
    return segments;
}

const isNumeric = key => /^\p{N}+$/u.test(key);
const hasDigit = key => /\p{N}/u.test(key);
const isStop = key => VI_STOP.has(key) || EN_STOP.has(key) || VI_GENERIC.has(key);
// Capitalised: initial uppercase letter, or an internal capital (iPhone, VinFast).
const isCapitalised = surface => /^\p{Lu}/u.test(surface) || /^\p{Ll}+\p{Lu}/u.test(surface);
const isAcronym = surface => surface.length >= 2 && surface === surface.toLocaleUpperCase('vi-VN') && /\p{Lu}/u.test(surface) && !isNumeric(surface);
const edgeOk = token => token.key.length > 1 && !isStop(token.key) && !isNumeric(token.key);

function bump(map, key, weight, extra) {
    const entry = map.get(key);
    if (entry) entry.tf += weight;
    else map.set(key, { phrase: key, tf: weight, ...extra });
}

function collectCandidates(segments, weight, map) {
    for (const tokens of segments) {
        const viewTokens = tokens.length;
        const capitalised = tokens.filter(t => isCapitalised(t.surface)).length;
        // English headlines in Title Case capitalise nearly everything, so capital runs carry no signal there.
        const titleCase = viewTokens >= 4 && capitalised / viewTokens > 0.6 && !tokens.some(t => VI_DIACRITICS.test(t.key));
        const segmentVietnamese = tokens.filter(t => VI_DIACRITICS.test(t.key)).length / viewTokens >= 0.3;

        // Capitalised name runs (people, brands, clubs, places), optionally followed by a number (Galaxy S25, Euro 2028).
        if (!titleCase) {
            let i = 0;
            while (i < tokens.length) {
                const first = tokens[i];
                const startsRun = isCapitalised(first.surface) && !isNumeric(first.key) && !(isStop(first.key) && !isAcronym(first.surface));
                if (!startsRun) { i++; continue; }
                let j = i + 1;
                while (j < tokens.length) {
                    const t = tokens[j];
                    if (isCapitalised(t.surface) && !isStop(t.key)) { j++; continue; }
                    if (isNumeric(t.key) && t.key.length <= 4) { j++; continue; }
                    if (NAME_CONNECTORS.has(t.key) && j + 1 < tokens.length && isCapitalised(tokens[j + 1].surface)) { j += 2; continue; }
                    break;
                }
                const run = tokens.slice(i, j);
                // A single sentence-initial capital is ordinary grammar, not a name.
                const sentenceInitialSingle = i === 0 && run.length === 1 && !isAcronym(first.surface) && !/\p{Lu}.*\p{Lu}/u.test(first.surface);
                if (run.length <= 5 && !sentenceInitialSingle && edgeOk(run[0])) {
                    const key = run.map(t => t.key).join(' ');
                    bump(map, key, weight, { kind: 'name', words: run.length });
                    // Long runs also offer their two-word parts as broader options.
                    if (run.length > 3) {
                        for (let a = 0; a + 2 <= run.length; a++) {
                            const part = run.slice(a, a + 2);
                            if (edgeOk(part[0]) && edgeOk(part[1])) bump(map, part.map(t => t.key).join(' '), weight, { kind: 'name', words: 2 });
                        }
                    }
                }
                i = j;
            }
        }

        // Plain n-grams (Vietnamese syllable phrases and English words / bigrams).
        for (let n = 1; n <= 3; n++) {
            for (let i = 0; i + n <= tokens.length; i++) {
                const gram = tokens.slice(i, i + n);
                if (!edgeOk(gram[0]) || !edgeOk(gram[n - 1])) continue;
                if (gram.slice(1, -1).some(t => isStop(t.key) && !NAME_CONNECTORS.has(t.key))) continue;
                if (gram.some(t => t.key.length > 30)) continue;
                const joined = gram.map(t => t.key).join(' ');
                if (GENERIC_PHRASES.has(joined)) continue;
                const vietnamese = gram.some(t => VI_DIACRITICS.test(t.key)) || (segmentVietnamese && n >= 2);
                if (n === 1) {
                    const t = gram[0];
                    if (vietnamese) continue; // a single Vietnamese syllable is not a useful filter
                    const proper = isCapitalised(t.surface) && !(i === 0 && !isAcronym(t.surface)) || isAcronym(t.surface);
                    if (t.key.length < 4 && !isAcronym(t.surface)) continue;
                    if (hasDigit(t.key) && !proper) continue;
                    bump(map, joined, weight, { kind: proper ? 'name' : 'word', words: 1 });
                } else if (n === 2) {
                    if (gram.some(t => isNumeric(t.key))) continue;
                    if (!vietnamese && gram.some(t => t.key.length < 3)) continue;
                    bump(map, joined, weight, { kind: 'phrase', words: 2 });
                } else {
                    if (gram.some(t => isNumeric(t.key))) continue;
                    if (!vietnamese && gram.some(t => t.key.length < 3 && !NAME_CONNECTORS.has(t.key))) continue;
                    bump(map, joined, weight, { kind: 'phrase', words: 3 });
                }
            }
        }
    }
}

// ---- inverse document frequency over recent articles ----------------------

function snippetOf(article) {
    const text = article?.contentSnippet || article?.description || article?.summary || article?.excerpt || article?.content || '';
    return plainBlockedText(text).slice(0, 500);
}

function articleTime(article) {
    const value = Date.parse(article?.pubDate || article?.date || article?.createDate || '');
    return Number.isFinite(value) ? value : NaN;
}

// Builds a compact index: normalized "title snippet" strings and unigram postings.
export function buildIdfIndex(articles, { now = Date.now(), windowMs = IDF_WINDOW_MS, maxDocs = MAX_IDF_DOCS } = {}) {
    const rows = [];
    for (const article of articles || []) {
        const at = articleTime(article);
        if (!Number.isFinite(at) || now - at > windowMs || at - now > 86400000) continue;
        rows.push({ at, article });
    }
    rows.sort((a, b) => b.at - a.at);
    const docs = [];
    const postings = new Map();
    for (const { article } of rows.slice(0, maxDocs)) {
        const text = normalizeBlockedText(`${article.title || ''} . ${snippetOf(article)}`);
        const id = docs.length;
        docs.push(text);
        for (const token of new Set(indexTokens(text))) {
            const list = postings.get(token);
            if (list) list.push(id); else postings.set(token, [id]);
        }
    }
    return { builtAt: now, docs, postings, size: docs.length };
}

// Documents containing the phrase (substring, matching how Content filters match).
export function documentFrequency(index, phrase) {
    const tokens = indexTokens(phrase);
    if (!tokens.length || !index?.size) return 0;
    let rarest = null;
    for (const token of tokens) {
        const list = index.postings.get(token);
        if (!list) return 0;
        if (!rarest || list.length < rarest.length) rarest = list;
    }
    if (tokens.length === 1 && !/\s/.test(phrase)) return rarest.length;
    let count = 0;
    for (const id of rarest) if (index.docs[id].includes(phrase)) count++;
    return count;
}

export function inverseDocumentFrequency(index, phrase) {
    const size = index?.size || 0;
    return Math.log((size + 1) / (documentFrequency(index, phrase) + 1));
}

// ---- suggestion ------------------------------------------------------------

// Longer names are specific; plain 3-syllable runs of ordinary words are only mildly better than 2.
function lengthBoost(candidate) {
    if (candidate.kind === 'name') return candidate.words > 1 ? 1.4 : 1;
    return candidate.words === 2 ? 1.3 : candidate.words === 3 ? 1.1 : 1;
}

// True when every token of `small` occurs in `big`.
function covers(big, small) {
    const tokens = new Set(big.split(' '));
    return small.split(' ').every(token => tokens.has(token));
}

// Two phrases overlap when one covers the other or they share two or more words.
function overlaps(a, b) {
    if (covers(a, b) || covers(b, a)) return true;
    const tokens = new Set(a.split(' '));
    return b.split(' ').filter(token => tokens.has(token)).length >= 2;
}

export function suggestKeywords({ title = '', snippet = '', memberTitles = [], blockedKeywords = [], index = null, limit = SUGGESTION_LIMIT } = {}) {
    const map = new Map();
    collectCandidates(tokenizeSegments(title), FIELD_WEIGHTS.title, map);
    for (const member of memberTitles) collectCandidates(tokenizeSegments(member), FIELD_WEIGHTS.member, map);
    collectCandidates(tokenizeSegments(snippet), FIELD_WEIGHTS.snippet, map);

    const blocked = (blockedKeywords || []).map(value => normalizeBlockedText(value)).filter(Boolean);
    const size = index?.size || 0;
    const scored = [];
    for (const candidate of map.values()) {
        const phrase = candidate.phrase;
        // Already covered by an existing filter entry (equal to it, or contains it).
        if (blocked.some(entry => phrase.includes(entry))) continue;
        const df = index ? documentFrequency(index, phrase) : 0;
        // Too common to be a useful filter.
        if (size >= 50 && df > size * 0.04) continue;
        // Rare-in-corpus phrases that only appear once in a single field add little but stay eligible.
        const idf = index ? Math.log((size + 1) / (df + 1)) + 0.5 : 1;
        const boost = lengthBoost(candidate);
        scored.push({ ...candidate, df, score: candidate.tf * idf * boost });
    }
    scored.sort((a, b) => b.score - a.score || b.words - a.words || a.phrase.localeCompare(b.phrase));

    // Deduplicate overlapping phrases, preferring the longer one when it scores close.
    const picked = [];
    for (const candidate of scored) {
        let skip = false;
        for (let i = 0; i < picked.length; i++) {
            const other = picked[i];
            if (other.phrase === candidate.phrase) { skip = true; break; }
            if (covers(other.phrase, candidate.phrase) || (!covers(candidate.phrase, other.phrase) && overlaps(candidate.phrase, other.phrase))) { skip = true; break; }
            if (covers(candidate.phrase, other.phrase)) {
                if (candidate.score >= other.score * 0.7) { picked[i] = candidate; }
                skip = true; break;
            }
        }
        if (!skip) picked.push(candidate);
    }
    // A replacement may now duplicate an earlier longer entry; keep the first of any overlap.
    const final = [];
    for (const candidate of picked.sort((a, b) => b.score - a.score)) {
        if (final.some(other => overlaps(other.phrase, candidate.phrase))) continue;
        final.push(candidate);
    }
    return final.slice(0, Math.max(1, Math.min(SUGGESTION_LIMIT, limit))).map(c => ({
        keyword: c.phrase,
        kind: c.kind,
        score: Math.round(c.score * 100) / 100,
        matches: c.df,
    }));
}

// ---- cached index ----------------------------------------------------------

export function createIdfProvider({ loadArticles, refreshMs = IDF_REFRESH_MS, now = Date.now } = {}) {
    let cached = null;
    let building = null;
    return async function getIndex() {
        const time = now();
        if (cached && time - cached.builtAt < refreshMs) return cached;
        if (!building) {
            building = (async () => {
                try { cached = buildIdfIndex(await loadArticles(), { now: now() }); }
                finally { building = null; }
                return cached;
            })();
        }
        try { return await building; } catch (error) { if (cached) return cached; throw error; }
    };
}

// Text used to describe one story: the title, snippet and member titles of a cluster or article.
export function suggestionInputFor(article) {
    const members = Array.isArray(article?.relatedArticles) ? article.relatedArticles : [];
    return {
        title: plainBlockedText(article?.title),
        snippet: snippetOf(article),
        memberTitles: members.map(member => plainBlockedText(member?.title)).filter(Boolean).slice(0, 30),
    };
}
