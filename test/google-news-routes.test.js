import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleNewsResolver } from '../src/articles/google-news.js';
import { registerArticleRoutes } from '../src/routes/article-routes.js';
import { registerSummaryRoutes } from '../src/routes/summary-routes.js';

const wrapper = 'https://news.google.com/read/' + Buffer.from('AU_yqL-route').toString('base64url');
const publisher = 'https://example.com/publisher';
const tick = () => new Promise(resolve => setImmediate(resolve));

function resolver({ cache = {}, decode = async () => ({}), browserRedirect = async () => '' } = {}) {
    return createGoogleNewsResolver({
        env: { RSS_DATA: { get: async () => cache, put: async () => {} } },
        decoder: { decode }, browserRedirect,
        fetchImpl: async () => { assert.fail('Unexpected publisher search'); }
    });
}

function routeFixture() {
    const handlers = new Map();
    return {
        app: {
            get(path, ...handlersForPath) { handlers.set(path, handlersForPath.at(-1)); },
            post(path, ...handlersForPath) { handlers.set(path, handlersForPath.at(-1)); }
        },
        async request(path, req) {
            const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
            await handlers.get(path)(req, res);
            return res;
        }
    };
}

function readerFixture(service, { cachedArticle, onFetch } = {}) {
    const fixture = routeFixture();
    registerArticleRoutes({
        app: fixture.app,
        resolveGoogleNewsUrl: service.resolveGoogleNewsUrl,
        progress: { activeForegroundRequests: 0 },
        articleReaderSessions: new Map(),
        isProtectedDeletedSourceSnapshot: async () => false,
        getCachedArticle: cachedArticle || (async () => null),
        updateArticleFetchProgress() {}, finishArticleFetchProgress() {},
        ARTICLE_FETCH_BASE_POINTS: { direct: 1 },
        getArticleFetchPolicy: async () => ({
            availableStrategies: ['direct'], allAvailableStrategies: ['direct'], strategyOrder: ['direct'],
            configuredMethods: ['direct'], hasStrictConfiguredMethods: true
        }),
        getArticleFetchPreferences: async () => ({}),
        fetchArticleHtmlByStrategy: async (_strategy, url) => {
            onFetch?.(url);
            return '<html><body><p>' + 'Article body. '.repeat(100) + '</p></body></html>';
        },
        parseArticleHtmlContent: async (content, url, fetchStrategy) => ({ url, title: 'Story', content, fetchStrategy }),
        expandArticleResultForSource: async (_url, result) => result,
        recordArticleFetchOutcome: async () => {}, cacheArticleResult: async () => {},
        deletedVozThreads: new Set()
    });
    return query => fixture.request('/api/article-content', { query: { url: wrapper, threadPage: '1', ...query } });
}

test('reader serves valid cached bodies and resolves unresolved wrapper keys in the background', async () => {
    for (const [key, hasMapping] of [[publisher, true], [wrapper, false], [wrapper, true]]) {
        let decodes = 0, fetches = 0;
        const service = resolver({
            cache: hasMapping ? { [wrapper]: { resolvedUrl: publisher, cachedAt: Date.now(), source: 'batchexecute' } } : {},
            decode: async () => { decodes++; return {}; }
        });
        const cached = { url: publisher, title: 'Cached story', content: '<p>Cached body</p>', fetchStrategy: 'direct' };
        const request = readerFixture(service, {
            cachedArticle: async lookup => lookup === key ? cached : null,
            onFetch: () => { fetches++; }
        });
        const response = await request();
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.cached, true);
        assert.equal(response.body.url, publisher);
        assert.equal(decodes, 0);
        assert.equal(fetches, 0);
        await tick();
        assert.equal(decodes, hasMapping ? 0 : 1);
    }
});

test('reader rejects cached Google wrapper URLs even under a publisher key', async () => {
    for (const hasMapping of [false, true]) {
        const destination = { resolvedUrl: publisher, cachedAt: Date.now(), source: 'offline' };
        const service = resolver({ cache: hasMapping ? { [wrapper]: destination } : {},
            decode: async () => ({ status: true, decoded_url: publisher }) });
        const fetches = [];
        const request = readerFixture(service, {
            cachedArticle: async () => ({ url: wrapper, title: 'Google wall', content: '<p>Consent page</p>', fetchStrategy: 'direct' }),
            onFetch: url => fetches.push(url)
        });
        const response = await request();
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.title, 'Story');
        assert.deepEqual(fetches, [publisher]);
    }
});

test('serving a body under the wrapper key respects resolution backoff', async () => {
    let decodes = 0, browserVisits = 0;
    const service = resolver({
        cache: { [wrapper]: { cachedAt: Date.now(), browserRetryAt: Date.now() + 3600000 } },
        decode: async () => { decodes++; return {}; }, browserRedirect: async () => { browserVisits++; }
    });
    const request = readerFixture(service, {
        cachedArticle: async key => key === wrapper ? { url: publisher, title: 'Valid cached body', content: '<p>Story</p>', fetchStrategy: 'direct' } : null
    });
    const response = await request();
    await tick();
    assert.equal(response.body.cached, true);
    assert.equal(decodes, 0);
    assert.equal(browserVisits, 0);
});

test('reader bypassCache retries only the cheap decoder for a permanent entry', async () => {
    let decodes = 0, browserVisits = 0;
    const service = resolver({
        cache: { [wrapper]: { cachedAt: Date.now(), permanentFailure: true } },
        decode: async () => { decodes++; return {}; },
        browserRedirect: async () => { browserVisits++; }
    });
    const fetched = [];
    const request = readerFixture(service, { onFetch: url => fetched.push(url) });
    assert.equal((await request()).statusCode, 200);
    assert.equal(decodes, 0);
    assert.equal((await request({ bypassCache: 'true' })).statusCode, 200);
    await tick();
    assert.equal(decodes, 1);
    assert.equal(browserVisits, 0);
    assert.deepEqual(fetched, [wrapper, wrapper]);
});

test('unresolved reader fetches the wrapper while the browser is pending and refresh respects backoff', async () => {
    let release, attempts = 0;
    const browser = new Promise(resolve => { release = resolve; });
    const service = resolver({ browserRedirect: async () => { attempts++; return browser; } });
    const fetches = [];
    const request = readerFixture(service, { onFetch: url => fetches.push(url) });
    try {
        assert.equal(await service.resolveGoogleNewsUrl(wrapper), wrapper);
        for (let i = 0; i < 20 && !attempts; i++) await tick();
        assert.equal(attempts, 1);
        const response = await request();
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.url, wrapper);
        assert.equal(response.body.error, undefined);
        assert.deepEqual(fetches, [wrapper]);
    } finally {
        release('');
    }
    await tick();
    assert.equal(service.googleNewsUrlCache.get(wrapper).browserAttempts, 1);
    assert.equal((await request({ strategy: 'refresh' })).statusCode, 200);
    await tick();
    assert.equal(attempts, 1);
});

test('summary polling and prioritization keep using the wrapper when decoding misses', async () => {
    const service = resolver();
    const fixture = routeFixture();
    const calls = [];
    registerSummaryRoutes({
        app: fixture.app, decodeGoogleNews: service.decodeGoogleNews,
        summaryEngine: {
            getSummaryFromCache: async url => { calls.push(['poll', url]); return { status: 'ready' }; },
            summaryQueue: { prioritize: url => calls.push(['prioritize', url]) }
        }
    });
    const poll = await fixture.request('/api/summary', { query: { url: wrapper } });
    assert.deepEqual(poll.body, { status: 'ready' });
    const response = await fixture.request('/api/summary/prioritize', { body: { url: wrapper } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true });
    assert.deepEqual(calls, [['poll', wrapper], ['prioritize', wrapper]]);
    await tick();
});
