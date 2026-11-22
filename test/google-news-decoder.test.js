import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleNewsDecoder, decodeGoogleNewsOffline, cleanGoogleNewsDestination } from '../src/articles/google-news-decode.js';
import { createGoogleNewsResolver } from '../src/articles/google-news.js';
import { createClientArticlePreparer } from '../src/articles/client-preparer.js';
import { resolveOpenCliExecutable } from '../src/browser/opencli-executable.js';
import { resolveGoogleNewsBrowserRedirect, runGoogleNewsBrowserRedirect } from '../src/browser/google-news-redirect.js';
import { isGoogleNewsArticleUrl } from '../src/articles/search-destination.js';
import { applyGoogleNewsDestinations } from '../src/articles/google-news-repair.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const wrapper = (id = 'AU_yqL-token', path = 'rss/articles') => `https://news.google.com/${path}/${Buffer.from(id).toString('base64url')}`;
const oldWrapper = (url, path = 'rss/articles') => {
    const bytes = Buffer.from(url), size = []; let n = bytes.length;
    do { size.push((n & 127) | (n > 127 ? 128 : 0)); n >>>= 7; } while (n);
    return `https://news.google.com/${path}/` + Buffer.concat([Buffer.from([8, 19, 34, ...size]), bytes, Buffer.from([210, 1, 0])]).toString('base64url');
};
const metadata = '<c-wiz><div data-n-a-ts="123" data-n-a-sg="signature"></div></c-wiz>';
function rpcResponse(rows) { return new Response(")]}'\n\n" + JSON.stringify(rows)); }
const rpcRow = (url, tag) => ['wrb.fr', 'Fbv4je', JSON.stringify(['garturlres', url]), null, null, null, tag];
const feedUrl = 'https://news.google.com/rss/search?q=site%3Aexample.com';
function resolver(overrides = {}) {
    return createGoogleNewsResolver({ env: { RSS_DATA: { get: async () => ({}), put: async () => {} } },
        decoder: { decode: async () => ({ status: false, message: 'decode failed' }) },
        execFileAsync: async () => ({ stdout: '[]' }), browserRedirect: async () => '', ...overrides });
}
async function finishBackground(service, url) {
    for (let i = 0; i < 30; i++) { await tick(); if (service.googleNewsUrlCache?.has(url)) return; }
    assert.fail('background resolution did not finish');
}

test('offline protobuf decoding handles URL lengths above 127 and all wrapper paths', () => {
    const url = 'https://example.com/' + 'long/'.repeat(40) + '?id=7&utm_source=google&gclid=123#section';
    for (const path of ['rss/articles', 'articles', 'read']) {
        assert.equal(isGoogleNewsArticleUrl(oldWrapper(url, path)), true);
        assert.equal(decodeGoogleNewsOffline(oldWrapper(url, path)), 'https://example.com/' + 'long/'.repeat(40) + '?id=7#section');
    }
    assert.equal(decodeGoogleNewsOffline(wrapper()), '');
    assert.equal(decodeGoogleNewsOffline('https://example.com/articles/a'), '');
    assert.equal(decodeGoogleNewsOffline('https://news.google.com/articles/CBMi_w'), '');
});

test('destinations reject unsafe schemes, credentials and Google pages; preserve publisher query parameters', () => {
    for (const url of ['javascript:alert(1)', 'file:///tmp/a', 'https://user:pass@example.com/',
        'https://news.google.com/read/abc', 'https://consent.google.com/', 'https://google.co.uk/',
        'https://accounts.google.com./', 'https://lh3.googleusercontent.com/a', 'https://youtube.com/']) {
        assert.equal(cleanGoogleNewsDestination(url), '', url);
    }
    assert.equal(cleanGoogleNewsDestination('https://example.com/a?id=3&source=edition&utm_medium=rss&_gl=1'), 'https://example.com/a?id=3&source=edition');
});

test('old-format resolver avoids every network and browser step and shares concurrent cache loads', async () => {
    let calls = 0, loads = 0;
    const service = resolver({ decoder: { decode: () => { calls++; throw Error('unexpected'); } },
        env: { RSS_DATA: { get: async () => { loads++; return {}; } } } });
    const url = oldWrapper('https://example.com/a');
    assert.deepEqual(await Promise.all([service.resolveGoogleNewsUrl(url), service.resolveGoogleNewsUrl(url)]), ['https://example.com/a', 'https://example.com/a']);
    assert.equal(calls, 0); assert.equal(loads, 1);
});

test('new-format batchexecute uses metadata once and correlates reversed batch replies by tag', async () => {
    const calls = [];
    const decoder = createGoogleNewsDecoder({ intervalMs: 0, fetchImpl: async (url, options) => {
        calls.push([url, options]); assert.ok(options.signal instanceof AbortSignal);
        if (!options.method) return new Response(metadata);
        const rows = JSON.parse(options.body.get('f.req'))[0];
        return rpcResponse(rows.reverse().map(row => rpcRow('https://example.com/' + JSON.parse(row[1])[2], row[3])));
    } });
    const urls = [wrapper('AU_yqL-one'), wrapper('AU_yqL-two')];
    const results = await decoder.decodeBatch(urls);
    assert.equal(calls.length, 3);
    assert.deepEqual(results.map(r => r.decoded_url), urls.map(url => 'https://example.com/' + new URL(url).pathname.split('/').pop()));
    await decoder.decode(urls[0]);
    assert.equal(calls.filter(([, options]) => !options.method).length, 2);
});

test('uncorrelated batch replies trigger independent RPCs without refetching metadata', async () => {
    let metadataCalls = 0, rpcCalls = 0;
    const decoder = createGoogleNewsDecoder({ intervalMs: 0, fetchImpl: async (url, options) => {
        if (!options.method) { metadataCalls++; return new Response(metadata); }
        rpcCalls++; const rows = JSON.parse(options.body.get('f.req'))[0];
        return rpcResponse(rows.map(row => rpcRow('https://example.com/' + JSON.parse(row[1])[2], 'generic')));
    } });
    const urls = [wrapper('AU_yqL-first'), wrapper('AU_yqL-second')];
    const results = await decoder.decodeBatch(urls);
    assert.equal(metadataCalls, 2); assert.equal(rpcCalls, 3);
    assert.deepEqual(results.map(r => r.decoded_url), urls.map(url => 'https://example.com/' + new URL(url).pathname.split('/').pop()));
});

test('HTTP 429 opens backoff including Retry-After and retries after expiry', async () => {
    let time = Date.now(), calls = 0;
    const decoder = createGoogleNewsDecoder({ intervalMs: 0, now: () => time, fetchImpl: async () => {
        calls++; return new Response('', { status: 429, headers: { 'Retry-After': '300' } });
    } });
    assert.equal((await decoder.decode(wrapper())).status, false);
    assert.equal(decoder.blockedUntil, time + 300000);
    await decoder.decode(wrapper('AU_yqL-other')); assert.equal(calls, 1);
    time += 300001;
    await decoder.decode(wrapper()); assert.equal(calls, 2);
});

test('decoder aborts hung network IO using its timeout signal', async () => {
    const decoder = createGoogleNewsDecoder({ intervalMs: 0, timeoutMs: 10, fetchImpl: async (_, { signal }) => {
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } });
    // AbortSignal.timeout is unrefed, keep the test alive until the mock aborts.
    const timer = setTimeout(() => {}, 100);
    try { assert.equal((await decoder.decode(wrapper())).status, false); } finally { clearTimeout(timer); }
});

test('fallback order is decoder, verified HTTP search, background OpenCLI search, wrapper redirect', async t => {
    const order = [];
    t.mock.method(global, 'fetch', async () => { order.push('http-search'); return new Response('no result'); });
    const service = resolver({ decoder: { decode: async () => { order.push('decoder'); return {}; } },
        execFileAsync: async () => { order.push('opencli-search'); return { stdout: '[]' }; },
        browserRedirect: async () => { order.push('redirect'); return 'https://example.com/correct?utm_source=google'; } });
    const url = wrapper();
    assert.equal(await service.resolveGoogleNewsUrl(url, { title: 'A sufficiently long headline', feedUrl }, { backgroundResolve: true }), url);
    assert.deepEqual(order, []);
    await finishBackground(service, url);
    assert.deepEqual(order, ['decoder', 'http-search', 'opencli-search', 'redirect']);
    assert.equal(service.googleNewsUrlCache.get(url).resolvedUrl, 'https://example.com/correct');
});

test('verified HTTP search succeeds before any browser is used', async t => {
    let browser = 0;
    t.mock.method(global, 'fetch', async () => new Response('<a href="/l/?uddg=https%3A%2F%2Fexample.com%2Farticle">'));
    const service = resolver({ browserRedirect: async () => { browser++; return ''; } });
    assert.equal(await service.resolveGoogleNewsUrl(wrapper(), { title: 'A sufficiently long headline', feedUrl }), 'https://example.com/article');
    assert.equal(browser, 0);
});

test('wrong-publisher decoder/search/browser results are rejected', async t => {
    t.mock.method(global, 'fetch', async () => new Response('<a href="?uddg=https%3A%2F%2Fevil.com%2Fcopy">'));
    const service = resolver({ decoder: { decode: async () => ({ decoded_url: 'https://evil.com/copied' }) },
        execFileAsync: async () => ({ stdout: '[{"url":"https://example.com.evil.com/copied"}]' }),
        browserRedirect: async () => 'https://evil.com/copied' });
    const url = wrapper();
    await service.resolveGoogleNewsUrl(url, { title: 'A sufficiently long headline', feedUrl }, { backgroundResolve: true });
    await finishBackground(service, url);
    assert.equal(service.googleNewsUrlCache.get(url).resolvedUrl, '');
});

test('failure cache suppresses background retries for five minutes, then permits retry', async () => {
    let time = Date.now(), calls = 0;
    const service = resolver({ now: () => time, decoder: { decode: async () => { calls++; return {}; } } });
    const url = wrapper();
    await service.resolveGoogleNewsUrl(url, {}, { backgroundResolve: true }); await finishBackground(service, url);
    await service.resolveGoogleNewsUrl(url, {}, { backgroundResolve: true }); await tick(); assert.equal(calls, 1);
    time += 300001;
    await service.resolveGoogleNewsUrl(url, {}, { backgroundResolve: true });
    for (let i = 0; i < 10 && calls < 2; i++) await tick();
    assert.equal(calls, 2);
});

test('foreground failures return before a browser fallback completes', async () => {
    let finish; const blocked = new Promise(resolve => { finish = resolve; }); let started = false;
    const service = resolver({ browserRedirect: async () => { started = true; return blocked; } });
    const url = wrapper();
    assert.equal(await service.resolveGoogleNewsUrl(url), url);
    for (let i = 0; i < 10 && !started; i++) await tick();
    assert.equal(started, true);
    // An active background browser must not become a foreground dependency.
    assert.equal(await service.resolveGoogleNewsUrl(url), url);
    finish('https://example.com/done'); await tick();
    assert.equal(await service.resolveGoogleNewsUrl(url), 'https://example.com/done');
});

test('client preparation returns before network work and reuses cached destination with metadata', async () => {
    let finish, calls = 0;
    const service = resolver({ decoder: { decode: async () => { calls++; return new Promise(resolve => { finish = resolve; }); } } });
    const prepare = createClientArticlePreparer({ resolveGoogleNewsUrl: service.resolveGoogleNewsUrl,
        getLastKnownCachedArticleImage: async () => '', getLastKnownCachedArticle: async () => null });
    const url = wrapper(), input = { link: url, title: 'Headline', domain: 'news.google.com', relatedArticles: [{ link: url, title: 'Related' }] };
    const result = await prepare(input);
    assert.equal(result.link, url); assert.equal(calls, 0);
    await tick(); assert.equal(calls, 1);
    finish({ decoded_url: 'https://example.com/destination' }); await tick();
    const cached = await prepare(input);
    assert.equal(cached.link, 'https://example.com/destination'); assert.equal(cached.originalLink, url);
    assert.equal(cached.domain, 'example.com'); assert.equal(input.link, url); assert.equal(input.relatedArticles[0].link, url);
});

test('executable lookup uses module root independent of cwd and falls back to PATH', () => {
    let checked;
    assert.equal(resolveOpenCliExecutable({ moduleUrl: 'file:///repo/src/browser/opencli-executable.js', access: path => { checked = path; } }), '/repo/node_modules/.bin/opencli');
    assert.equal(checked, '/repo/node_modules/.bin/opencli');
    assert.equal(resolveOpenCliExecutable({ access: () => { throw Error('missing'); } }), 'opencli');
});

test('background redirect reads final location and closes only its automation tab', async () => {
    const calls = [], locations = [wrapper(), 'https://example.com/a?gclid=1'];
    const url = await resolveGoogleNewsBrowserRedirect(wrapper(), { createPage: () => ({
        newTab: async value => { calls.push(['new', value]); return 'target-1'; },
        setActivePage: id => calls.push(['bind', id]), evaluate: async () => locations.shift(),
        closeTab: async id => calls.push(['close', id])
    }), sleep: async () => {} });
    assert.equal(url, 'https://example.com/a'); assert.deepEqual(calls.at(-1), ['close', 'target-1']);
});

test('browser consent, timeout and evaluation failure all close the tab', async () => {
    for (const mode of ['consent', 'timeout', 'throw']) {
        let time = 0, closed = 0;
        const operation = resolveGoogleNewsBrowserRedirect(wrapper(), { timeoutMs: 1, now: () => time,
            sleep: async () => { time += 2; }, createPage: () => ({
                newTab: async () => 'owned', setActivePage() {},
                evaluate: async () => { if (mode === 'throw') throw Error('disconnected'); return mode === 'consent' ? 'https://consent.google.com/' : wrapper(); },
                closeTab: async id => { assert.equal(id, 'owned'); closed++; }
            }) });
        if (mode === 'throw') await assert.rejects(operation, /disconnected/); else assert.equal(await operation, '');
        assert.equal(closed, 1);
    }
});

test('browser subprocesses are serialized and bounded by process timeout', async () => {
    let active = 0, peak = 0;
    const exec = async (binary, args, options) => {
        assert.equal(binary, process.execPath); assert.equal(options.timeout, 40000);
        active++; peak = Math.max(peak, active); await tick(); active--;
        return { stdout: '{"url":"https://example.com/a"}' };
    };
    await Promise.all([runGoogleNewsBrowserRedirect(wrapper(), exec), runGoogleNewsBrowserRedirect(wrapper('AU_yqL-2'), exec)]);
    assert.equal(peak, 1);
});

test('record repair preserves provenance, updates link identities and verifies related publishers', () => {
    const url = wrapper(), article = { link: url, articleKey: url, clusterId: url, domain: 'news.google.com',
        relatedArticles: [{ link: url, feedUrl: 'https://news.google.com/rss/search?q=site%3Aother.com' }] };
    assert.equal(applyGoogleNewsDestinations(article, { [url]: 'https://example.com/a' }), true);
    assert.equal(article.link, 'https://example.com/a'); assert.equal(article.originalLink, url);
    assert.equal(article.articleKey, article.link); assert.equal(article.clusterId, article.link);
    assert.equal(article.relatedArticles[0].link, url);
});

test('Smart ingestion resolves before clustering, preserves wrapper provenance and reuses failure cache', async () => {
    let calls = 0;
    const service = resolver({ decoder: { decode: async () => { calls++; return { decoded_url: 'https://example.com/a' }; } } });
    const url = wrapper(), article = { link: url, articleKey: url, domain: 'example.com', feedUrl, title: 'A story' };
    assert.deepEqual(await service.resolveSmartArticleDestinations([{ articles: [article] }]), { attempted: 1, resolved: 1 });
    assert.equal(article.link, 'https://example.com/a'); assert.equal(article.originalLink, url); assert.equal(article.articleKey, article.link);
    const again = { link: url, domain: 'example.com', feedUrl };
    await service.resolveSmartArticleDestinations([{ articles: [again] }]); assert.equal(calls, 1);
    const { normalizeArticle } = await import('../src/smart/articles/normalize.js');
    assert.equal(normalizeArticle(article).originalLink, url);
});

test('more than sixteen sync URLs use bounded batches without dropping entries', async () => {
    let calls = 0;
    const service = resolver({ decoder: { decode: async url => { calls++; return { decoded_url: 'https://example.com/' + new URL(url).pathname.split('/').pop() }; } } });
    const urls = Array.from({ length: 25 }, (_, i) => wrapper('AU_yqL-' + i));
    const results = await service.googleDecoder.decodeBatch(urls);
    assert.equal(calls, 25); assert.equal(results.filter(r => r.status).length, 25);
});

test('content boundary refuses unresolved Google wrappers and forwards successful destinations', async () => {
    const url = wrapper();
    const service = resolver();
    await assert.rejects(service.resolveArticleSourceUrl(url), { code: 'GOOGLE_NEWS_PENDING', status: 503 });
    const offline = oldWrapper('https://example.com/source');
    assert.equal(await service.resolveArticleSourceUrl(offline), 'https://example.com/source');
    assert.equal(await service.decodeGoogleNews(offline), 'https://example.com/source');
    await finishBackground(service, url);
});

test('reader transport resolves Google wrappers before fetching article HTML', async t => {
    const { createArticleReaders } = await import('../src/articles/readers.js');
    const url = wrapper(); const seen = [];
    t.mock.method(global, 'fetch', async value => { seen.push(value); return new Response('<html>Publisher body</html>'); });
    const readers = createArticleReaders({ resolveArticleSourceUrl: async value => value === url ? 'https://example.com/article' : value });
    assert.equal(await readers.fetchArticleHtmlByStrategy('direct', url), '<html>Publisher body</html>');
    assert.deepEqual(seen, ['https://example.com/article']);
});
