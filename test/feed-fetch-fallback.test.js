import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedFetcher } from '../src/feeds/fetch-feed.js';
import { createFeedSync } from '../src/feeds/sync.js';
import { fastParseRSS } from '../feed-parsers.js';

const FEED_URL = 'https://example.test/feed.xml';
const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture</title><item><title>Recovered article</title><link>https://example.test/article</link><pubDate>Thu, 29 Oct 2026 06:00:00 GMT</pubDate></item></channel></rss>';

function fixture({ statuses = [403, 403, 530], bodies = [], browserBody = RSS, readerBody = RSS, browserError } = {}) {
    const calls = [], responses = [];
    const fetchFeed = createFeedFetcher({
        CF_PROXY_BASE: 'https://cf.test/?url=',
        VIETSERVER_PROXY_BASE: 'https://vs.test/?url=',
        BROWSER_HEADERS: { 'User-Agent': 'fixture' },
        fetchFn: async (url, options) => {
            assert.ok(options.signal instanceof AbortSignal);
            const index = calls.length;
            calls.push(url);
            const response = new Response(bodies[index] || '<html>Blocked</html>', { status: statuses[index] });
            responses.push(response);
            return response;
        },
        openCliFetch: async url => {
            calls.push(['opencli-fetch', url]);
            if (browserError) throw browserError;
            return browserBody;
        },
        openCliRead: async url => { calls.push(['opencli', url]); return readerBody; },
        log() {},
    });
    return { fetchFeed, calls, responses };
}

test('blocked RSS tries direct, Cloudflare, Vietserver, then OpenCLI Fetch before the reader', async () => {
    const { fetchFeed, calls, responses } = fixture();
    const response = await fetchFeed(FEED_URL);
    assert.equal(await response.text(), RSS);
    assert.deepEqual(calls, [FEED_URL, 'https://cf.test/?url=' + encodeURIComponent(FEED_URL),
        'https://vs.test/?url=' + encodeURIComponent(FEED_URL), ['opencli-fetch', FEED_URL]]);
    assert.ok(responses.every(response => response.bodyUsed), 'unread failure bodies are released');
});

test('OpenCLI reader recovers the feed after OpenCLI Fetch fails', async () => {
    const { fetchFeed, calls } = fixture({ browserError: Error('HTTP 403') });
    assert.equal(await (await fetchFeed(FEED_URL)).text(), RSS);
    assert.deepEqual(calls.slice(-2), [['opencli-fetch', FEED_URL], ['opencli', FEED_URL]]);
});

test('HTTP 200 challenge pages cannot prevent the remaining fallbacks', async () => {
    const { fetchFeed, calls } = fixture({ statuses: [200, 200, 200],
        bodies: Array(3).fill('<html><title>Just a moment...</title><body>cf-chl-challenge</body></html>') });
    assert.equal(await (await fetchFeed(FEED_URL)).text(), RSS);
    assert.deepEqual(calls.at(-1), ['opencli-fetch', FEED_URL]);
});

test('reader is attempted when OpenCLI Fetch returns HTML instead of RSS', async () => {
    const { fetchFeed, calls } = fixture({ browserBody: '<html>Access denied</html>' });
    assert.equal(await (await fetchFeed(FEED_URL)).text(), RSS);
    assert.deepEqual(calls.at(-1), ['opencli', FEED_URL]);
});

test('a truncated feed or an RSS-shaped error cannot stop the fallback chain', async () => {
    for (const body of ['<rss>error</rss>', '<rss><channel><title>Truncated</title>']) {
        const { fetchFeed, calls } = fixture({ statuses: [200, 200, 200], bodies: Array(3).fill(body) });
        assert.equal(await (await fetchFeed(FEED_URL)).text(), RSS);
        assert.deepEqual(calls.at(-1), ['opencli-fetch', FEED_URL]);
    }
});

test('unusable reader text reports every attempted method instead of publishing an empty feed', async () => {
    const { fetchFeed, calls } = fixture({ browserError: Error('Browser unavailable'), readerBody: '# Feed converted to Markdown' });
    await assert.rejects(fetchFeed(FEED_URL), error => {
        assert.match(error.message, /All RSS fetch methods failed/);
        for (const method of ['direct', 'cloudflare', 'vietserver', 'opencli-fetch', 'opencli']) {
            assert.ok(error.message.includes(method + ':'), method);
        }
        return true;
    });
    assert.equal(calls.length, 5);
});

test('a working direct response never starts a proxy or browser', async () => {
    const { fetchFeed, calls } = fixture({ statuses: [200], bodies: [RSS] });
    assert.equal(await (await fetchFeed(FEED_URL)).text(), RSS);
    assert.deepEqual(calls, [FEED_URL]);
});

test('a direct network failure or stalled body can still reach the browser fallbacks', async () => {
    const calls = [];
    const fetchFeed = createFeedFetcher({
        CF_PROXY_BASE: 'https://cf.test/?url=',
        fetchFn: async url => {
            calls.push(url);
            if (calls.length === 1) throw Error('Connection reset');
            return { ok: true, status: 200, text: async () => { throw Error('Body timed out'); } };
        },
        openCliFetch: async url => { calls.push(url); return RSS; },
        openCliRead: async () => assert.fail('reader should not run'),
        log() {},
    });
    assert.equal(await (await fetchFeed(FEED_URL)).text(), RSS);
    assert.equal(calls.length, 3);
});

test('empty RSS and Atom documents remain successful feeds', async () => {
    for (const body of ['<rss><channel><title>Empty</title></channel></rss>',
        '<feed xmlns="http://www.w3.org/2005/Atom"><title>Empty</title></feed>']) {
        const { fetchFeed, calls } = fixture({ statuses: [200], bodies: [body] });
        assert.equal(await (await fetchFeed(FEED_URL)).text(), body);
        assert.equal(calls.length, 1);
    }
});

test('removed feeds retain their HTTP status without browser retries', async () => {
    for (const status of [404, 410]) {
        const { fetchFeed, calls, responses } = fixture({ statuses: [status] });
        const response = await fetchFeed(FEED_URL);
        assert.equal(response.status, status);
        assert.equal(response, responses[0]);
        assert.equal(await response.text(), '<html>Blocked</html>');
        assert.equal(calls.length, 1);
    }
});

test('BaoMoi HTML listings and the Kenh14 RSS URL rewrite are preserved', async () => {
    const html = '<html><body><a href="/story.epi">Listing</a></body></html>';
    const baoMoi = fixture({ statuses: [200], bodies: [html] });
    assert.equal(await (await baoMoi.fetchFeed('https://baomoi.com/')).text(), html);
    assert.equal(baoMoi.calls.length, 1);
    const kenh14 = fixture({ statuses: [200], bodies: [RSS] });
    await kenh14.fetchFeed('https://kenh14.vn/home.rss');
    assert.deepEqual(kenh14.calls, ['https://kenh14.vn/rss/home.rss']);
});

test('sync persists articles and records success after either browser fallback recovers RSS', async () => {
    for (const useReader of [false, true]) {
        const { fetchFeed, calls } = fixture({ browserError: useReader ? Error('HTTP 403') : undefined });
        const values = { feeds: [{ url: FEED_URL, title: 'Fixture', category: 'News' }], articles: [] };
        const history = [];
        const env = { RSS_DATA: {
            get: async key => structuredClone(values[key] || []),
            putMany: async changes => {
                for (const [key, value] of Object.entries(changes)) values[key] = JSON.parse(value);
            },
        } };
        const sync = createFeedSync({
            env, fetchFeedResponse: fetchFeed, recordFetch: (...args) => history.push(args),
            runParserWorker: async (type, body) => fastParseRSS(body),
            hasOnlyOpenCliFetchMethod: () => false,
            prefetchOpenCliOnlyArticles: async () => {},
        });
        const result = await sync.syncFeeds(env, FEED_URL);
        assert.deepEqual(result.logs, []);
        assert.equal(values.articles[0].title, 'Recovered article');
        assert.equal(values.articles[0].feedUrl, FEED_URL);
        assert.deepEqual(history.map(entry => entry.slice(2, 4)), [['success', '1 articles']]);
        assert.deepEqual(calls.at(-1), [useReader ? 'opencli' : 'opencli-fetch', FEED_URL]);
    }
});
