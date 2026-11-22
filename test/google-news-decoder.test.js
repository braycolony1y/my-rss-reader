import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleNewsDecoder, decodeGoogleNewsOffline, cleanGoogleNewsDestination } from '../src/articles/google-news-decode.js';
import { createGoogleNewsResolver } from '../src/articles/google-news.js';
import { createClientArticlePreparer } from '../src/articles/client-preparer.js';
import { resolveOpenCliExecutable } from '../src/browser/opencli-executable.js';
import { resolveGoogleNewsBrowserRedirect, runGoogleNewsBrowserRedirect } from '../src/browser/google-news-redirect.js';
import { isGoogleNewsArticleUrl } from '../src/articles/search-destination.js';
import { applyGoogleNewsDestinations } from '../src/articles/google-news-repair.js';
import { withBrowserFetchBudget, getBrowserFetchBudget } from '../src/browser/work-budget.js';

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
        fetchImpl: async () => new Response('no result'),
        execFileAsync: async () => ({ stdout: '[]' }), browserRedirect: async () => '', ...overrides });
}
async function finishBackground(service, url, done = entry => entry?.resolvedUrl || entry?.browserAttempts || entry?.permanentFailure) {
    for (let i = 0; i < 30; i++) {
        await tick();
        const entry = service.googleNewsUrlCache?.get(url);
        if (done(entry)) return entry;
    }
    assert.fail('background resolution did not finish');
}

test('offline protobuf decoding handles URL lengths above 127 and all wrapper paths', () => {
    const url = 'https://example.com/' + 'long/'.repeat(40) + '?id=7&utm_source=google&gclid=123#section';
    for (const path of ['rss/articles', 'articles', 'read']) {
        assert.equal(isGoogleNewsArticleUrl(oldWrapper(url, path)), true);
        assert.equal(decodeGoogleNewsOffline(oldWrapper(url, path)), 'https://example.com/' + 'long/'.repeat(40) + '?id=7');
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
    assert.equal(cleanGoogleNewsDestination("https://example.com/story.html)?sig=%2f%2F+~!'&%75tm_medium=rss&x=%20&x=+&flag#section"),
        "https://example.com/story.html?sig=%2f%2F+~!'&x=%20&x=+&flag");
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

test('uncorrelated batch replies get at most two retries without refetching metadata', async () => {
    let metadataCalls = 0, rpcCalls = 0;
    const decoder = createGoogleNewsDecoder({ intervalMs: 0, fetchImpl: async (url, options) => {
        if (!options.method) { metadataCalls++; return new Response(metadata); }
        rpcCalls++; const rows = JSON.parse(options.body.get('f.req'))[0];
        return rpcResponse(rows.map(row => rpcRow('https://example.com/' + JSON.parse(row[1])[2], 'generic')));
    } });
    const urls = Array.from({ length: 8 }, (_, i) => wrapper(`AU_yqL-uncorrelated-${i}`));
    const results = await decoder.decodeBatch(urls);
    assert.equal(metadataCalls, 8);
    assert.equal(rpcCalls, 3);
    assert.deepEqual(results.filter(result => result.status).map(result => result.decoded_url),
        urls.slice(0, 2).map(url => 'https://example.com/' + new URL(url).pathname.split('/').pop()));
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

test('fallback order is decoder, verified HTTP search, background OpenCLI search, wrapper redirect', async () => {
    const order = [];
    const service = resolver({ fetchImpl: async () => { order.push('http-search'); return new Response('no result'); }, decoder: { decode: async () => { order.push('decoder'); return {}; } },
        execFileAsync: async () => { order.push('opencli-search'); return { stdout: '[]' }; },
        browserRedirect: async () => { order.push('redirect'); return 'https://example.com/correct?utm_source=google'; } });
    const url = wrapper();
    assert.equal(await service.resolveGoogleNewsUrl(url, { title: 'A sufficiently long headline', feedUrl }, { backgroundResolve: true }), url);
    assert.deepEqual(order, []);
    await finishBackground(service, url);
    assert.deepEqual(order, ['decoder', 'http-search', 'opencli-search', 'redirect']);
    assert.equal(service.googleNewsUrlCache.get(url).resolvedUrl, 'https://example.com/correct');
});

test('verified HTTP search succeeds in the background and rejects conflicting publisher hints', async () => {
    let browser = 0;
    const service = resolver({
        fetchImpl: async () => new Response('<a href="/l/?uddg=https%3A%2F%2Fexample.com%2Farticle">'),
        browserRedirect: async () => { browser++; return ''; }
    });
    const url = wrapper();
    assert.equal(await service.resolveGoogleNewsUrl(url, { title: 'A sufficiently long headline', feedUrl }), url);
    const stored = await finishBackground(service, url);
    assert.equal(stored.source, 'search');
    assert.equal(await service.resolveGoogleNewsUrl(url, { feedUrl }, { cacheOnly: true }), 'https://example.com/article');
    assert.equal(await service.resolveGoogleNewsUrl(url, { domain: 'unrelated.example' }, { cacheOnly: true }), url);
    assert.equal(await service.resolveGoogleNewsUrl(url, { feedUrl }, { cacheOnly: true }), 'https://example.com/article');
    assert.equal(browser, 0);
});

test('offline, batchexecute and browser cache entries are authoritative across hint changes', async () => {
    const dest = 'https://bbc.com/news/story';
    const hints = { domain: 'bbc.co.uk' };
    const offline = oldWrapper(dest);
    const rpc = wrapper('AU_yqL-rpc');
    const redirect = wrapper('AU_yqL-redirect');
    const service = resolver({
        decoder: { decode: async url => url === rpc ? { decoded_url: dest } : {} },
        browserRedirect: async () => dest
    });
    assert.equal(await service.resolveGoogleNewsUrl(offline, hints), dest);
    assert.equal(await service.resolveGoogleNewsUrl(rpc, hints), dest);
    assert.equal(await service.resolveGoogleNewsUrl(redirect, hints), redirect);
    await finishBackground(service, redirect);
    for (const [url, source] of [[offline, 'offline'], [rpc, 'batchexecute'], [redirect, 'browser']]) {
        assert.equal(service.googleNewsUrlCache.get(url).source, source);
        assert.equal(await service.resolveGoogleNewsUrl(url, hints, { cacheOnly: true }), dest);
    }
});

test('foreground and sync resolve through the decoder while sixteen background jobs are pending', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let started = 0, canDecode = false;
    const service = resolver({
        decoder: { decode: async () => canDecode ? { decoded_url: 'https://example.com/foreground' } : {} },
        browserRedirect: async () => { started++; return gate; }
    });
    const urls = Array.from({ length: 16 }, (_, i) => wrapper('AU_yqL-browser-' + i));
    await Promise.all(urls.map(url => service.resolveGoogleNewsUrl(url, {}, { backgroundResolve: true })));
    for (let i = 0; i < 30 && started < 16; i++) await tick();
    try {
        assert.equal(started, 16);
        canDecode = true;
        assert.equal(await service.resolveGoogleNewsUrl(urls[0]), 'https://example.com/foreground');
        assert.equal((await service.googleDecoder.decode(wrapper('AU_yqL-sync'))).decoded_url, 'https://example.com/foreground');
        const article = { link: wrapper('AU_yqL-smart') };
        assert.deepEqual(await service.resolveSmartArticleDestinations([{ articles: [article] }]), { attempted: 1, resolved: 1 });
    } finally {
        release('https://example.com/late-browser');
    }
    await tick();
    assert.equal(await service.resolveGoogleNewsUrl(urls[0]), 'https://example.com/foreground');
});

test('browser failure backoff survives a cache reload and grows from one hour to a 48-hour cap', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const hour = 3600000, url = wrapper();
    let time = Date.now(), browser = 0, decodes = 0, persisted = {};
    const makeService = () => resolver({
        now: () => time,
        env: { RSS_DATA: {
            get: async () => structuredClone(persisted),
            patchEntries: async (_key, changes) => { Object.assign(persisted, structuredClone(changes)); }
        } },
        decoder: { decode: async () => { decodes++; return {}; } },
        browserRedirect: async () => { browser++; return ''; }
    });
    const service = makeService();
    for (let i = 0; i < 4; i++) assert.equal(await service.resolveGoogleNewsUrl(url), url);
    let failure = await finishBackground(service, url);
    assert.equal(failure.browserRetryAt, time + hour);
    assert.equal(browser, 1);
    assert.equal(decodes, 1);
    t.mock.timers.tick(3000);
    await tick();
    assert.equal(persisted[url].browserAttempts, 1);
    assert.equal(persisted[url].browserRetryAt, time + hour);

    const restarted = makeService();
    await restarted.resolveGoogleNewsUrl(url, {}, { force: true });
    await restarted.resolveGoogleNewsUrl(url, {}, { backgroundResolve: true, force: true });
    await tick();
    assert.equal(browser, 1, 'force does not bypass browser backoff');

    for (let attempt = 2; attempt <= 8; attempt++) {
        time = failure.browserRetryAt;
        await restarted.resolveGoogleNewsUrl(url);
        failure = await finishBackground(restarted, url, entry => entry?.browserAttempts === attempt);
        assert.equal(failure.browserRetryAt, time + hour * Math.min(48, 2 ** (attempt - 1)));
        assert.equal(browser, attempt);
    }
});

test('permanently rejected offline, RPC and browser results never retry in the browser', async () => {
    let time = Date.now(), browser = 0;
    const offline = oldWrapper('https://www.youtube.com/watch?v=abc');
    const rpc = wrapper('AU_yqL-rpc-rejected');
    const wall = wrapper('AU_yqL-browser-wall');
    const service = resolver({
        now: () => time,
        decoder: { decode: async url => url === rpc ? { permanentFailure: true } : {} },
        browserRedirect: async () => { browser++; return { permanentFailure: true }; }
    });
    for (const url of [offline, rpc, wall]) {
        assert.equal(await service.resolveGoogleNewsUrl(url), url);
        assert.equal((await finishBackground(service, url)).permanentFailure, true);
    }
    assert.equal(browser, 1);
    time += 49 * 3600000;
    for (const url of [offline, rpc, wall]) {
        assert.equal(await service.resolveGoogleNewsUrl(url, {}, { force: true }), url);
        await service.resolveGoogleNewsUrl(url, {}, { backgroundResolve: true });
    }
    await tick();
    assert.equal(browser, 1);
});

test('sorry, consent, sign-in and 429 redirects remain retryable after backoff', async () => {
    for (const [wall, status] of [['https://www.google.com/sorry/index', 302], ['https://www.google.com/sorry/index', 200],
        ['https://consent.google.com/', 200], ['https://accounts.google.com/', 200], ['https://youtube.com/', 429]]) {
        let time = Date.now(), calls = 0;
        const decoder = createGoogleNewsDecoder({ intervalMs: 0, now: () => time, fetchImpl: async url => {
            calls++;
            return calls === 1 ? { ok: status === 200, status, url: status === 302 ? url : wall,
                headers: new Headers({ 'Retry-After': '180', Location: wall }) }
                : { ok: true, status: 200, url: 'https://example.com/article', text: async () => '' };
        } });
        const service = resolver({ decoder, now: () => time });
        const url = wrapper();
        assert.equal(await service.resolveGoogleNewsUrl(url, {}, { decodersOnly: true }), url);
        assert.equal(service.googleNewsUrlCache.get(url).permanentFailure, false);
        assert.equal(decoder.blockedUntil, time + 180000);
        time += 179999;
        assert.equal(await service.resolveGoogleNewsUrl(url, {}, { force: true, decodersOnly: true }), url);
        assert.equal(calls, 1);
        time++;
        assert.equal(await service.resolveGoogleNewsUrl(url, {}, { decodersOnly: true }), 'https://example.com/article');
        assert.equal(calls, 2);
    }
});

test('RPC walls apply backoff while a non-article RPC result is permanent', async () => {
    let time = Date.now(), result = 'https://consent.google.com/';
    const decoder = createGoogleNewsDecoder({ intervalMs: 0, now: () => time, fetchImpl: async (_url, options) => {
        return options.method === 'POST' ? rpcResponse([rpcRow(result)]) : new Response(metadata);
    } });
    assert.match((await decoder.decode(wrapper())).message, /consent/);
    assert.equal(decoder.blockedUntil, time + 120000);
    time += 120000;
    result = 'https://ad.doubleclick.net/some-ad';
    assert.deepEqual(await decoder.decode(wrapper()), { status: false, permanentFailure: true });
});

test('a non-article metadata redirect alone does not create a permanent failure', async () => {
    const decoder = createGoogleNewsDecoder({ intervalMs: 0, fetchImpl: async () => ({
        ok: true, status: 200, url: 'https://youtube.com/watch?v=preview'
    }) });
    const result = await decoder.decode(wrapper());
    assert.equal(result.status, false);
    assert.equal(result.permanentFailure, undefined);
});

test('a persisted wall deadline still applies to a forced request after restart', async () => {
    const url = wrapper();
    let time = Date.now(), calls = 0;
    const retryAt = time + 120000;
    const service = resolver({
        now: () => time,
        env: { RSS_DATA: { get: async () => ({ [url]: { cachedAt: time, decoderAttemptedAt: time, decoderRetryAt: retryAt } }) } },
        decoder: { decode: async () => { calls++; return { decoded_url: 'https://example.com/recovered' }; } }
    });
    assert.equal(await service.resolveGoogleNewsUrl(url, {}, { force: true }), url);
    assert.equal(calls, 0);
    time = retryAt;
    assert.equal(await service.resolveGoogleNewsUrl(url, {}, { force: true }), 'https://example.com/recovered');
    assert.equal(calls, 1);
});

test('force retries a permanent mapping through the cheap decoder only', async () => {
    const url = wrapper();
    let decodes = 0, browser = 0;
    const service = resolver({
        env: { RSS_DATA: { get: async () => ({ [url]: { permanentFailure: true, cachedAt: Date.now() } }) } },
        decoder: { decode: async () => ++decodes === 1 ? {} : { status: true, decoded_url: 'https://example.com/article' } },
        browserRedirect: async () => { browser++; }
    });
    assert.equal(await service.resolveGoogleNewsUrl(url), url);
    assert.equal(decodes, 0);
    assert.equal(await service.resolveGoogleNewsUrl(url, {}, { force: true }), url);
    await tick();
    assert.equal(decodes, 1);
    assert.equal(browser, 0);
    assert.equal(await service.resolveGoogleNewsUrl(url, {}, { force: true }), 'https://example.com/article');
    assert.equal(decodes, 2);
});

test('an in-memory permanent failure expires at 30 days', async () => {
    const url = wrapper();
    const savedAt = Date.now();
    let time = savedAt, decodes = 0;
    const service = resolver({
        now: () => time,
        env: { RSS_DATA: { getEntries: async () => ({ [url]: { permanentFailure: true, cachedAt: savedAt } }) } },
        decoder: { decode: async () => { decodes++; return { decoded_url: 'https://example.com/found' }; } }
    });
    assert.equal(await service.resolveGoogleNewsUrl(url), url);
    time += 30 * 86400000 - 1;
    assert.equal(await service.resolveGoogleNewsUrl(url), url);
    assert.equal(decodes, 0);
    time++;
    assert.equal(await service.resolveGoogleNewsUrl(url), 'https://example.com/found');
    assert.equal(decodes, 1);
});

test('destination cache retains recent reads and reloads evicted persisted rows', async () => {
    const urls = Array.from({ length: 3001 }, (_, i) => wrapper('AU_yqL-lru-' + i));
    const reads = [];
    const service = resolver({
        env: { RSS_DATA: { getEntries: async (_key, keys) => {
            reads.push(...keys);
            return { [keys[0]]: { resolvedUrl: 'https://example.com/found', cachedAt: Date.now(), source: 'offline' } };
        } } }
    });
    const read = url => service.resolveGoogleNewsUrl(url, {}, { cacheOnly: true });
    for (const url of urls.slice(0, -1)) await read(url);
    await read(urls[0]);
    await read(urls.at(-1));
    assert.equal(service.googleNewsUrlCache.size, 3000);
    assert.equal(service.googleNewsUrlCache.has(urls[0]), true);
    assert.equal(service.googleNewsUrlCache.has(urls[1]), false);
    assert.equal(await read(urls[1]), 'https://example.com/found');
    assert.equal(reads.length, 3002);
});

test('failed cache saves retry with capped exponential delays and bounded pending writes', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'error', () => {});
    const batches = [];
    let failing = true;
    const service = resolver({
        env: { RSS_DATA: { get: async () => ({}), patchEntries: async (_key, changes) => {
            batches.push(changes);
            if (failing) throw Error('storage unavailable');
        } } }
    });
    const first = oldWrapper('https://example.com/first');
    await service.resolveGoogleNewsUrl(first);
    t.mock.timers.tick(3000);
    await tick();
    assert.equal(batches.length, 1);
    let latest;
    for (let i = 0; i < 3001; i++) {
        latest = oldWrapper('https://example.com/cache/' + i);
        await service.resolveGoogleNewsUrl(latest);
    }
    let count = 1;
    for (const delay of [6000, 12000, 24000, 48000, 96000, 192000, 300000, 300000]) {
        t.mock.timers.tick(delay - 1);
        await tick();
        assert.equal(batches.length, count);
        t.mock.timers.tick(1);
        await tick();
        assert.equal(batches.length, ++count);
    }
    failing = false;
    t.mock.timers.tick(300000);
    await tick();
    assert.equal(batches.length, ++count);
    assert.equal(Object.keys(batches.at(-1)).length, 3000);
    assert.equal(batches.at(-1)[first], undefined);
    assert.equal(batches.at(-1)[latest].resolvedUrl, 'https://example.com/cache/3000');
    await service.resolveGoogleNewsUrl(first);
    t.mock.timers.tick(3000);
    await tick();
    assert.equal(batches.length, ++count);
});

test('source-less cache entries require the same publisher match as search', async () => {
    const url = wrapper(), candidate = 'https://example.com/legacy';
    const service = resolver({
        env: { RSS_DATA: { get: async () => ({ [url]: { resolvedUrl: candidate, cachedAt: Date.now() } }) } }
    });
    assert.equal(await service.resolveGoogleNewsUrl(url, { domain: 'wrong.example' }, { cacheOnly: true }), url);
    assert.equal(await service.resolveGoogleNewsUrl(url, { feedUrl }, { cacheOnly: true }), candidate);
});

test('client cards use the resolver publisher decision for exact and source-less mappings', async () => {
    const url = wrapper();
    const resolvedUrl = 'https://example.com/exact';
    const article = { link: url, title: 'Story', feedUrl: 'https://news.google.com/rss/search?q=site%3Aother.example' };
    for (const source of ['offline', 'search', undefined]) {
        const service = resolver({
            env: { RSS_DATA: { get: async () => ({ [url]: { resolvedUrl, cachedAt: Date.now(), source } }) } }
        });
        const prepare = createClientArticlePreparer({
            resolveGoogleNewsUrl: service.resolveGoogleNewsUrl, getLastKnownCachedArticleImage: async () => ''
        });
        const result = await prepare(article);
        assert.equal(result.link, source === 'offline' ? resolvedUrl : url);
        assert.equal(result.originalLink, url);
        await tick();
    }
});

test('browser walls block Google requests and schedule hour-scale retry', async () => {
    let time = Date.now(), attempts = 0;
    const decoder = createGoogleNewsDecoder({ now: () => time, intervalMs: 0, fetchImpl: async () => new Response('') });
    const service = resolver({
        now: () => time, decoder,
        browserRedirect: url => {
            attempts++;
            return resolveGoogleNewsBrowserRedirect(url, { createPage: () => ({
                newTab: async () => 'owned', setActivePage() {}, closeTab: async () => {},
                evaluate: async () => ({ url: 'https://www.google.com/sorry/index', status: 429 })
            }) });
        }
    });
    const url = wrapper();
    await service.resolveGoogleNewsUrl(url);
    const first = await finishBackground(service, url);
    assert.equal(first.permanentFailure, false);
    assert.equal(first.browserRetryAt, time + 3600000);
    assert.equal(decoder.blockedUntil, time + 120000);
    assert.equal(first.decoderRetryAt, decoder.blockedUntil);
    time = first.browserRetryAt - 1;
    await service.resolveGoogleNewsUrl(url, {}, { backgroundResolve: true });
    await tick();
    assert.equal(attempts, 1);
    time++;
    await service.resolveGoogleNewsUrl(url, {}, { backgroundResolve: true });
    const second = await finishBackground(service, url, entry => entry?.browserAttempts === 2);
    assert.equal(second.browserRetryAt, time + 7200000);
    await assert.rejects(runGoogleNewsBrowserRedirect(url, async () => ({ stdout: JSON.stringify({ wall: 'Google News HTTP 429' }) })),
        { code: 'GOOGLE_NEWS_WALL' });
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

test('browser polls through intermediate Google hops and closes only its automation tab', async () => {
    const calls = [], locations = [wrapper(), 'https://news.google.com/redirect', 'https://www.google.com/url?q=article', 'https://example.com/a?gclid=1'];
    const url = await resolveGoogleNewsBrowserRedirect(wrapper(), { createPage: () => ({
        newTab: async value => { calls.push(['new', value]); return 'target-1'; },
        setActivePage: id => calls.push(['bind', id]), evaluate: async () => locations.shift(),
        closeTab: async id => calls.push(['close', id])
    }), sleep: async () => {} });
    assert.equal(url, 'https://example.com/a'); assert.deepEqual(calls.at(-1), ['close', 'target-1']);
});

test('browser marks only a final non-article location permanent', async () => {
    for (const [last, expected] of [['https://example.com/article', 'https://example.com/article'],
        ['https://youtube.com/watch?v=123', { permanentFailure: true }]]) {
        let time = 0;
        const locations = ['https://youtube.com/redirect', last];
        const result = await resolveGoogleNewsBrowserRedirect(wrapper(), {
            timeoutMs: 400, now: () => time, sleep: async ms => { time += ms; },
            createPage: () => ({
                newTab: async () => 'owned', setActivePage() {}, closeTab: async () => {},
                evaluate: async () => locations.shift()
            })
        });
        assert.deepEqual(result, expected);
    }
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
        if (mode === 'throw') await assert.rejects(operation, /disconnected/);
        else if (mode === 'consent') await assert.rejects(operation, /consent/);
        else assert.equal(await operation, '');
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

test('record repair preserves provenance, OG fallback parameters and search publisher validation', () => {
    const url = wrapper(), article = { link: url, articleKey: url, clusterId: url, domain: 'news.google.com',
        image: '/api/og-image?url=original&rss=https%3A%2F%2Fimages.example%2Fa&icon=icon%20value',
        relatedArticles: [{ link: url, feedUrl: 'https://news.google.com/rss/search?q=site%3Aother.com' }] };
    assert.equal(applyGoogleNewsDestinations(article, { [url]: { resolvedUrl: 'https://example.com/a', source: 'search' } }), true);
    assert.equal(article.link, 'https://example.com/a'); assert.equal(article.originalLink, url);
    assert.equal(article.articleKey, article.link); assert.equal(article.clusterId, article.link);
    assert.equal(article.relatedArticles[0].link, url);
    assert.equal(article.image, '/api/og-image?url=https%3A%2F%2Fexample.com%2Fa&rss=https%3A%2F%2Fimages.example%2Fa&icon=icon%20value');
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

test('content and summary boundaries keep unresolved wrappers and preserve non-Google URL bytes', async () => {
    const url = wrapper();
    const service = resolver();
    assert.equal(await service.resolveArticleSourceUrl(url), url);
    assert.equal(await service.decodeGoogleNews(url), url);
    const signed = "HTTPS://Example.com/a?sig=%2f+~!'&raw=a b#section";
    assert.equal(await service.resolveArticleSourceUrl(signed), signed);
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

test('Google News subprocess can run while every reader browser slot is occupied', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const slots = Array.from({ length: getBrowserFetchBudget().limit }, () => withBrowserFetchBudget(() => gate));
    let started = false;
    const redirect = runGoogleNewsBrowserRedirect(wrapper(), async () => {
        started = true;
        return { stdout: '{"url":"https://example.com/a"}' };
    });
    try {
        await tick();
        assert.equal(started, true);
    } finally {
        release();
        await Promise.all(slots);
    }
    assert.equal(await redirect, 'https://example.com/a');
});

test('browser cleanup gets its own time budget after the poll deadline', async () => {
    let time = 0;
    const closed = [];
    const result = await resolveGoogleNewsBrowserRedirect(wrapper(), {
        timeoutMs: 2, now: () => time, sleep: async () => { time = 2; },
        createPage: () => ({
            newTab: async () => 'owned', setActivePage() {}, evaluate: async () => wrapper(),
            closeTab: id => new Promise(resolve => setTimeout(() => { closed.push(id); resolve(); }, 15))
        })
    });
    assert.equal(result, '');
    assert.deepEqual(closed, ['owned']);
});

test('a tab acknowledged after the opening deadline still closes', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let opened;
    const opening = new Promise(resolve => { opened = resolve; });
    const closed = [];
    const redirect = resolveGoogleNewsBrowserRedirect(wrapper(), {
        createPage: () => ({
            newTab: () => opening,
            setActivePage: () => assert.fail('Timed-out tab must not be used'),
            closeTab: async id => { closed.push(id); }
        })
    });
    const rejected = assert.rejects(redirect, /timed out/);
    t.mock.timers.tick(8000);
    await tick();
    opened('late-tab');
    await rejected;
    assert.deepEqual(closed, ['late-tab']);
});
