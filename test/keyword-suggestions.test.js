import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIdfIndex, suggestKeywords, suggestionInputFor, createIdfProvider, documentFrequency } from '../src/filters/keyword-suggestions.js';

const now = Date.parse('2026-11-20T00:00:00Z');
const day = 86400000;
const doc = (title, snippet = '', ageDays = 1) => ({ link: 'https://example.test/' + Math.random(), title, description: snippet, pubDate: new Date(now - ageDays * day).toISOString() });

// A fixed recent corpus: generic news vocabulary is everywhere, the specific names are rare.
function corpus() {
    const rows = [];
    for (let i = 0; i < 120; i++) {
        rows.push(doc(`Chính phủ cho biết năm nay kinh tế tăng trưởng ${i}`, 'Theo báo cáo, thủ tướng cho biết các bộ ngành sẽ họp vào tuần sau.'));
        rows.push(doc(`The government says report shows growth ${i}`, 'The report says the economy will grow next year, officials said.'));
    }
    rows.push(doc('Giá vàng hôm nay tăng mạnh', 'Giá vàng miếng SJC tăng.'));
    rows.push(doc('Manchester United thắng Chelsea 2-1', 'Trận đấu tại Old Trafford.'));
    rows.push(doc('Old article about Tesla Cybertruck', 'Tesla deliveries.', 40)); // outside the 14 day window
    return rows;
}
const index = buildIdfIndex(corpus(), { now });

const keywordsOf = result => result.map(item => item.keyword);

test('IDF index only counts the last 14 days and uses substring document frequency', () => {
    assert.equal(index.size, 242);
    assert.equal(documentFrequency(index, 'tesla'), 0);
    assert.equal(documentFrequency(index, 'cho biết'), 120);
    assert.equal(documentFrequency(index, 'giá vàng'), 1);
});

test('Vietnamese article: names and multi-syllable phrases, no stopwords or generic news words', () => {
    const result = suggestKeywords({
        title: 'Thủ tướng Phạm Minh Chính cho biết VinFast sẽ mở nhà máy xe điện tại Hà Tĩnh năm nay',
        snippet: 'Theo báo cáo, nhà máy xe điện VinFast tại Hà Tĩnh có công suất lớn. Ông Phạm Minh Chính cho biết dự án sẽ khởi công.',
        memberTitles: ['VinFast xây nhà máy xe điện ở Hà Tĩnh'],
        index,
    });
    const keywords = keywordsOf(result);
    assert.ok(result.length >= 4 && result.length <= 8, keywords.join('|'));
    assert.ok(keywords.includes('phạm minh chính'), keywords.join('|'));
    assert.ok(keywords.includes('vinfast'), keywords.join('|'));
    assert.ok(keywords.some(k => k.includes('hà tĩnh')), keywords.join('|'));
    assert.ok(keywords.some(k => k.includes('xe điện') || k.includes('nhà máy')), keywords.join('|'));
    for (const banned of ['cho biết', 'năm nay', 'của', 'và', 'theo báo cáo', 'báo cáo']) assert.ok(!keywords.includes(banned), banned);
    assert.ok(keywords.every(k => !/^(của|và|cho|là|có|sẽ|tại)\s/.test(k) && !/\s(của|và|cho|là|có|sẽ|tại)$/.test(k)), keywords.join('|'));
    // Overlapping n-grams are collapsed: no suggestion contains or is contained in another.
    for (const a of keywords) for (const b of keywords) if (a !== b) assert.ok(!(` ${a} `).includes(` ${b} `), `${b} inside ${a}`);
});

test('English article: words, bigrams and names; stopwords and report verbs removed', () => {
    const result = suggestKeywords({
        title: 'OpenAI says new GPT model beats Google Gemini in coding benchmark, report',
        snippet: 'OpenAI released the model on Tuesday. Sam Altman said the model beats Google Gemini on the coding benchmark.',
        index,
    });
    const keywords = keywordsOf(result);
    assert.ok(keywords.includes('openai'), keywords.join('|'));
    assert.ok(keywords.includes('sam altman'), keywords.join('|'));
    assert.ok(keywords.includes('google gemini') || keywords.includes('gemini'), keywords.join('|'));
    assert.ok(keywords.includes('coding benchmark') || keywords.includes('benchmark'), keywords.join('|'));
    for (const banned of ['says', 'report', 'the', 'new', 'said', 'on tuesday']) assert.ok(!keywords.includes(banned), banned);
    assert.ok(result.length <= 8);
});

test('numbers appear only as part of a name', () => {
    const result = suggestKeywords({ title: 'Samsung Galaxy S25 Ultra giảm giá 5 triệu, Euro 2028 sắp bắt đầu', snippet: '2026 2027 15 20', index });
    const keywords = keywordsOf(result);
    assert.ok(keywords.some(k => /galaxy s25/.test(k)), keywords.join('|'));
    assert.ok(keywords.every(k => /\p{L}/u.test(k)), keywords.join('|'));
    assert.ok(!keywords.some(k => /^\d+$/.test(k)));
});

test('entries already in Content filters are dropped, along with phrases containing them', () => {
    const input = { title: 'VinFast mở nhà máy xe điện tại Hà Tĩnh', snippet: 'Nhà máy VinFast ở Hà Tĩnh.', index };
    const before = keywordsOf(suggestKeywords(input));
    assert.ok(before.includes('vinfast'));
    const after = keywordsOf(suggestKeywords({ ...input, blockedKeywords: ['VINFAST', 'hà tĩnh'] }));
    assert.ok(after.every(k => !k.includes('vinfast') && !k.includes('hà tĩnh')), after.join('|'));
});

test('common corpus phrases score lower than rare ones (IDF)', () => {
    const result = suggestKeywords({ title: 'Chính phủ cho biết Manchester United thắng Chelsea', index });
    const keywords = keywordsOf(result);
    assert.ok(keywords.indexOf('manchester united') >= 0);
    assert.ok(keywords.indexOf('manchester united') < (keywords.indexOf('chính phủ') < 0 ? 99 : keywords.indexOf('chính phủ')));
});

test('output is deterministic, bounded and honours limit', () => {
    const input = { title: 'Alpha Beta Gamma Delta rise as Epsilon Zeta Eta Theta fall in Iota Kappa market', snippet: 'Lambda Mu Nu Xi', index };
    assert.deepEqual(suggestKeywords(input), suggestKeywords(input));
    assert.ok(suggestKeywords(input).length <= 8);
    assert.equal(suggestKeywords({ ...input, limit: 3 }).length, 3);
    assert.deepEqual(suggestKeywords({ title: '', snippet: '' }), []);
});

test('suggestionInputFor reads cluster title, snippet and member titles', () => {
    const input = suggestionInputFor({ title: '<b>Tiêu đề</b> chính', content: '<p>Nội dung</p>', relatedArticles: [{ title: 'Tiêu đề phụ' }, {}] });
    assert.deepEqual(input, { title: 'Tiêu đề chính', snippet: 'Nội dung', memberTitles: ['Tiêu đề phụ'] });
});

test('IDF provider builds lazily, caches in memory and refreshes at most every 30 minutes', async () => {
    let loads = 0, clock = now;
    const provider = createIdfProvider({ loadArticles: async () => { loads++; return corpus(); }, now: () => clock });
    assert.equal(loads, 0);
    const [a, b] = await Promise.all([provider(), provider()]);
    assert.equal(loads, 1);
    assert.equal(a, b);
    clock += 29 * 60000;
    assert.equal(await provider(), a);
    assert.equal(loads, 1);
    clock += 2 * 60000;
    const refreshed = await provider();
    assert.equal(loads, 2);
    assert.notEqual(refreshed, a);
});

test('IDF provider keeps serving the previous index if a refresh fails', async () => {
    let clock = now, fail = false;
    const provider = createIdfProvider({ loadArticles: async () => { if (fail) throw new Error('db'); return corpus(); }, now: () => clock });
    const first = await provider();
    fail = true; clock += 31 * 60000;
    assert.equal(await provider(), first);
});
