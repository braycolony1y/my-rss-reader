import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import GroundNewsSource, { parseGroundNews, GROUND_URL } from '../src/sources/GroundNewsSource.js';
import registry from '../src/sources/index.js';

const fixture = readFileSync(new URL('./fixtures/ground-live.html', import.meta.url), 'utf8');
const push = chunk => `<script>self.__next_f.push(${JSON.stringify([1, chunk])})</script>`;
const page = value => push(`a:${JSON.stringify(value)}\n`);
const story = { id: 'event-1', title: 'A headline', description: 'A summary', slug: 'a-headline', start: '2026-09-05T12:00:00Z', sourceCount: 200, sources: [{ url: 'https://publisher.example/article', date: '2026-09-05', sourceInfo: { name: 'Publisher', bias: 'center' } }] };

test('real homepage finds unique clusters and preserves coverage and publisher metadata', () => {
    const { items, diagnostics } = parseGroundNews(fixture);
    assert.equal(items.length, 38);
    assert.ok(diagnostics.candidates > items.length);
    assert.equal(new Set(items.map(i => i.id)).size, items.length);
    for (const item of items) {
        assert.ok(item.title && item.description && item.id);
        assert.equal(item.guid, item.id);
        assert.equal(item.link, item.url);
        assert.match(item.url, /^https:\/\/ground\.news\/article\//);
        assert.ok(Number.isFinite(Date.parse(item.publishedAt)));
        assert.ok(item.groundNews.sourceCount >= 0);
        assert.equal(item.content, item.description);
    }
    const covered = items.find(i => i.groundNews.sources.length && i.groundNews.blindspotData);
    assert.ok(covered.groundNews.sources.some(s => s.name && s.url && s.date && s.bias));
    assert.ok(covered.groundNews.biasSourceCount > 0);
    assert.equal(typeof covered.groundNews.blindspotData.leftPercent, 'number');
    assert.equal(typeof covered.groundNews.blindspotData.cntrSrcCount, 'number');
});

test('merges duplicate IDs and canonical URLs, preserving richer optional fields and sections', () => {
    const r = parseGroundNews(page({ sectionName: 'Top Stories', stories: [
        { ...story, sources: [], description: '' }, story,
        { ...story, slug: 'a-new-headline', blindspotData: { leftPercent: 33 } },
        { ...story, id: undefined, url: `${GROUND_URL}article/a-headline?utm_source=test` }
    ] }));
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].groundNews.sources.length, 1);
    assert.equal(r.items[0].description, story.description);
    assert.equal(r.items[0].groundNews.blindspotData.leftPercent, 33);
    assert.deepEqual(r.items[0].groundNews.sections, ['Top Stories']);
});

test('ignores unrelated and malformed entries and never executes JavaScript', () => {
    assert.equal(parseGroundNews('<script>self.__next_f.push([0]);throw new Error("no")</script>').items.length, 0);
    assert.equal(parseGroundNews(page([{ title: 'Navigation', id: 'nav' }, { ...story.sources[0], title: 'Publisher article' }])).items.length, 0);
    assert.equal(parseGroundNews('<script>self.__next_f.push([1,broken])</script>' + page(story)).items.length, 1);
});

test('handles split Flight chunks, references, cycles and UTF-8 length-prefixed text', () => {
    const summary = 'Résumé\nwith another line';
    const record = `a:${JSON.stringify({ ...story, description: '$b', related: '$a' })}\nb:T${Buffer.byteLength(summary).toString(16)},${summary}`;
    const r = parseGroundNews(push(record.slice(0, 31)) + push(record.slice(31)));
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].description, summary);
});

test('missing optional fields and invalid dates/media are safe, with ID and slug fallbacks', () => {
    const r = parseGroundNews(page([
        { id: 'id-only', title: 'Minimal', sources: null, sourceCount: 0, start: 'bad', image: 'javascript:alert(1)' },
        { title: 'Slug only', slug: 'slug-only', sources: [] },
        { title: 'No identity', sources: [] }
    ]));
    assert.equal(r.items.length, 2);
    assert.equal(r.items[0].url, `${GROUND_URL}article/id-only`);
    assert.equal(r.items[0].publishedAt, null);
    assert.equal(r.items[0].image, null);
    assert.deepEqual(r.items[0].groundNews.sources, []);
    assert.equal(r.items[1].guid, `${GROUND_URL}article/slug-only`);
});

test('backend fetch uses fixed homepage, headers, timeout, TTL and coalesces refreshes', async () => {
    let calls = 0, clock = 0;
    const source = new GroundNewsSource({ now: () => clock, fetchImpl: async (url, options) => {
        calls++;
        assert.equal(url, GROUND_URL);
        assert.match(options.headers['User-Agent'], /Mozilla/);
        assert.ok(options.signal instanceof AbortSignal);
        return new Response(page(story));
    } });
    const [a, b] = await Promise.all([source.fetchFeed(), source.fetchFeed()]);
    assert.equal(a, b);
    await source.fetchFeed();
    assert.equal(calls, 1);
    clock = 600001;
    await source.fetchFeed();
    assert.equal(calls, 2);
    assert.ok(registry.getHandler(GROUND_URL) instanceof GroundNewsSource);
    assert.equal(registry.getHandler('https://ground.news.evil.example'), null);
});

for (const [label, fetchImpl] of [
    ['HTTP error', async () => new Response('bad', { status: 503 })],
    ['timeout', async () => { throw new Error('Timeout'); }],
    ['schema change', async () => new Response('<html>No stories</html>')]
]) test(`isolates ${label} and backs off`, async () => {
    let calls = 0;
    const source = new GroundNewsSource({ fetchImpl: async () => { calls++; return fetchImpl(); } });
    await assert.rejects(source.fetchFeed(), /Ground News/);
    await assert.rejects(source.fetchFeed(), /cooling down/);
    assert.equal(calls, 1);
});

test('shared sync persists cluster metadata, deduplicates changed slugs, and retains articles on failure', async t => {
    const { createFeedSync } = await import('../src/feeds/sync.js');
    const handler = registry.getHandler(GROUND_URL);
    let result = parseGroundNews(page(story));
    t.mock.method(handler, 'fetchFeed', async () => result);
    const state = {
        feeds: [{ url: GROUND_URL, title: 'Ground News', category: 'World' }],
        articles: [{ title: 'Other source', link: 'https://other.example/a', feedUrl: 'https://other.example/rss', pubDate: '2026-09-05', content: 'Preserve me' }]
    };
    const env = { RSS_DATA: {
        get: async key => structuredClone(state[key] || []),
        putMany: async values => { for (const [k, v] of Object.entries(values)) state[k] = JSON.parse(v); }
    } };
    const events = [];
    const service = createFeedSync({ env, recordFetch: (...args) => events.push(args),
        hasOnlyOpenCliFetchMethod: () => false, prefetchOpenCliOnlyArticles: async () => {} });
    await service.syncFeeds(env, GROUND_URL);
    let item = state.articles.find(a => a.guid === story.id);
    assert.equal(item.groundNews.sourceCount, 200);
    assert.equal(item.groundNews.sources[0].name, 'Publisher');
    assert.equal(item.feedIcon, 'https://ground.news/favicon.ico');
    result = parseGroundNews(page({ ...story, slug: 'changed-slug' }));
    await service.syncFeeds(env, GROUND_URL);
    assert.equal(state.articles.filter(a => a.guid === story.id).length, 1);
    const before = structuredClone(state.articles);
    t.mock.method(handler, 'fetchFeed', async () => { throw new Error('Ground News parser found no stories'); });
    const failed = await service.syncFeeds(env, GROUND_URL);
    assert.match(failed.logs[0].Issue, /Ground News parser/);
    assert.deepEqual(state.articles, before);
    assert.ok(events.some(e => e[2] === 'error'));
    assert.ok(state.articles.some(a => a.title === 'Other source'));
});

test('story reader retains the real article total and bias counts without page chrome', () => {
    const html = readFileSync(new URL('./fixtures/ground-story.html', import.meta.url), 'utf8');
    const url = 'https://ground.news/article/chonburi-and-pattaya-officials-say-thank-you-to-us-sailors-as-uss-abraham-lincoln-prepares-to-head-home';
    const source = new GroundNewsSource();
    const result = {};
    const content = source.parseArticleHtmlContent(html, url, result);
    assert.match(content, /49 Articles/);
    assert.match(content, /Left<span>7<\/span>/);
    assert.match(content, /Center<span>8<\/span>/);
    assert.match(content, /Right<span>11<\/span>/);
    assert.match(content, /27%/);
    assert.match(content, /31%/);
    assert.match(content, /42%/);
    assert.match(content, /data-ground-bias="left"/);
    assert.match(content, /The Independent/);
    assert.doesNotMatch(content, /self\.__next_f|Subscribe|All\*\*Left/);
    assert.equal(source.isUsableArticleResult({ content }), true);
    assert.equal(source.isUsableArticleResult({ content: '<p>All**Left**7</p>' }), false);
    assert.equal(source.parseArticleHtmlContent(html, 'https://ground.news/article/unrelated', {}), false);
});

test('reader escapes publisher text and summary and handles missing coverage', async () => {
    const { renderGroundNewsStory } = await import('../src/sources/ground-news-reader.js');
    const html = renderGroundNewsStory({ url: GROUND_URL, description: '<script>alert(1)</script>', groundNews: { sources: [] } });
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /null%|undefined|0%/);
});

test('perspectives and publisher filters work through a stopped overlay click and keep selection independent', async () => {
    const { JSDOM } = await import('jsdom');
    const html = readFileSync(new URL('./fixtures/ground-story-perspectives.html', import.meta.url), 'utf8');
    const url = 'https://ground.news/article/chonburi-and-pattaya-officials-say-thank-you-to-us-sailors-as-uss-abraham-lincoln-prepares-to-head-home';
    const content = new GroundNewsSource().parseArticleHtmlContent(html, url, {});
    const { cleanArticleMarkup } = await import('../src/articles/markup.js');
    const cachedContent = cleanArticleMarkup(content);
    const dom = new JSDOM(`<div id="overlay">${cachedContent}</div>`, { runScripts: 'outside-only' });
    try {
        const { document } = dom.window;
        document.querySelector('#overlay').addEventListener('click', e => e.stopPropagation());
        const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
        dom.window.eval(script.slice(script.indexOf('// Capture runs before the reader overlay')));
        for (const group of ['left', 'center', 'right', 'all']) {
            document.querySelector(`[data-ground-filter="${group}"]`).click();
            const visible = [...document.querySelectorAll('[data-ground-bias]')].filter(node => !node.hidden);
            assert.ok(visible.length > 0);
            assert.ok(visible.every(node => group === 'all' || node.dataset.groundBias === group));
        }
        for (const group of ['center', 'right', 'analysis', 'left']) {
            document.querySelector(`[data-ground-summary="${group}"]`).click();
            const visible = [...document.querySelectorAll('[data-ground-summary-panel]')].filter(node => !node.hidden);
            assert.equal(visible.length, 1);
            assert.equal(visible[0].dataset.groundSummaryPanel, group);
            assert.ok(visible[0].querySelectorAll('li').length >= 3);
            assert.equal(document.querySelector('[data-ground-filter="all"]').getAttribute('aria-pressed'), 'true');
        }
        const logos = document.querySelectorAll('img.ground-publisher-logo');
        assert.ok(logos.length > 20);
        logos[0].dispatchEvent(new dom.window.Event('error'));
        assert.equal(logos[0].hidden, true);
    } finally { dom.window.close(); }
});
