import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceCooldown, articleSourceCooldown, rssSourceCooldown, createSourceCooldown} from '../src/articles/source-cooldown.js';
import {PUBLISHER_COOLDOWN_KEYS} from '../src/articles/publisher-cooldown-policy.js';
import {runPublisherFallbacks, retargetPublisherFallbacks} from '../src/articles/publisher-fallbacks.js';
import {withPublisherFetchKind} from '../src/articles/publisher-fetch-context.js';
import {publisherVerificationError} from '../src/articles/publisher-verification.js';
import {runArticleFetchTask, withArticleFetchLane, getCurrentArticleFetchLaneContext} from '../src/articles/fetch-lanes.js';
import {createFeedFetcher} from '../src/feeds/fetch-feed.js';
import {runFeedBrowserFallback} from '../src/feeds/browser-fallback.js';
import {articleFallbackRequest} from '../src/articles/fallback-request.js';
import {fetchSmartSource} from '../src/smart/sources/fetch.js';
import {fastParseRSS} from '../feed-parsers.js';
import {createManualPublisherRefresh} from '../src/articles/manual-publisher-refresh.js';
import {manualRefreshOptions} from '../src/articles/manual-refresh-scopes.js';
import {runArticleStrategies} from '../src/articles/strategy-fallbacks.js';
import {parseStrategyCandidate} from '../src/articles/strategy-candidate.js';

const articleUrl = 'https://voz.vn/t/example.123';
const feedUrl = 'https://voz.vn/f/apple.36/index.rss';
const rss = '<rss><channel><title>Feed</title><item><title>Item</title><link>https://voz.vn/t/example.123</link></item></channel></rss>';
const article = {content: '<p>' + 'Actual article text. '.repeat(30) + '</p>'};
const blocked = () => {throw publisherVerificationError({status: 403});};

async function initialize() {
    const values = {};
    const db = {get: async key => structuredClone(values[key] || {}), put: async (key, raw) => {values[key] = JSON.parse(raw);}};
    await sourceCooldown.initialize(db);
    return {db, values};
}

test('article pause cannot block RSS direct or queued browser fallbacks; states persist separately', async () => {
    const {db, values} = await initialize();
    await assert.rejects(articleSourceCooldown.run(articleUrl, blocked));
    const calls = [];
    const feed = createFeedFetcher({fetchFn: async () => new Response('Blocked', {status: 403}),
        openCliFetch: url => runFeedBrowserFallback(url, () => sourceCooldown.run(url, () => {
            calls.push('fetch'); return blocked();
        }, getCurrentArticleFetchLaneContext())),
        openCliRead: url => runFeedBrowserFallback(url, () => sourceCooldown.run(url, () => {
            calls.push('reader'); return rss;
        }, getCurrentArticleFetchLaneContext())), log() {}});
    assert.equal(await (await feed(feedUrl)).text(), rss);
    assert.deepEqual(calls, ['fetch', 'reader']);
    assert.equal(articleSourceCooldown.get(articleUrl).strikes, 1);
    assert.equal(rssSourceCooldown.get(feedUrl).strikes, undefined);
    assert.ok(values[PUBLISHER_COOLDOWN_KEYS.article]['voz.vn']);
    assert.equal(values[PUBLISHER_COOLDOWN_KEYS.rss], undefined);
    for (const kind of ['rss', 'article']) {
        const restarted = createSourceCooldown({stateKey: PUBLISHER_COOLDOWN_KEYS[kind]});
        await restarted.initialize(db);
        assert.equal(restarted.get(feedUrl).strikes, kind === 'article' ? 1 : undefined);
    }
});

test('RSS exhaustion pauses RSS only; an article fallback succeeds after its first method verifies', async () => {
    await initialize();
    const feed = createFeedFetcher({fetchFn: async () => new Response('Blocked', {status: 403}),
        openCliFetch: blocked, openCliRead: blocked, log() {}});
    await assert.rejects(feed(feedUrl), {code: 'PUBLISHER_VERIFICATION'});
    assert.equal(rssSourceCooldown.get(feedUrl).strikes, 1);
    const result = await withArticleFetchLane('p3', () => runPublisherFallbacks(articleUrl, async () => {
        await assert.rejects(runArticleFetchTask(articleUrl, blocked));
        assert.equal(articleSourceCooldown.get(articleUrl).strikes, undefined);
        return runArticleFetchTask(articleUrl, () => article);
    }, {kind: 'article'}));
    assert.deepEqual(result, article);
    assert.equal(articleSourceCooldown.get(articleUrl).strikes, undefined);
    assert.equal(rssSourceCooldown.get(feedUrl).strikes, 1);
});

test('all article fallbacks fail before one content incident is committed', async () => {
    await initialize();
    let calls = 0;
    await assert.rejects(withArticleFetchLane('p3', () => runPublisherFallbacks(articleUrl, async () => {
        for (let i = 0; i < 2; i++) {
            await assert.rejects(runArticleFetchTask(articleUrl, () => {calls++; return blocked();}));
            assert.equal(articleSourceCooldown.get(articleUrl).strikes, undefined);
        }
        return {error: 'Both methods failed'};
    }, {kind: 'article'})).then(result => {
        assert.equal(result.error, 'Both methods failed');
        return withArticleFetchLane('p3', () => runArticleFetchTask(articleUrl, () => assert.fail('content remains paused')));
    }), {code: 'SOURCE_COOLDOWN'});
    assert.equal(calls, 2);
    assert.equal(articleSourceCooldown.get(articleUrl).strikes, 1);
    assert.equal(rssSourceCooldown.get(feedUrl).strikes, undefined);
});

test('queued RSS work cannot lend its namespace or deferred verdict to following article work', async () => {
    await initialize();
    await assert.rejects(articleSourceCooldown.run(articleUrl, blocked));
    let release, entered;
    const started = new Promise(resolve => {entered = resolve;});
    const rssWork = withPublisherFetchKind('rss', () => runPublisherFallbacks(feedUrl, () => runFeedBrowserFallback(feedUrl,
        () => new Promise(resolve => {release = resolve; entered();})), {kind: 'rss'}));
    await started;
    const automatic = withArticleFetchLane('p3', () => runArticleFetchTask(articleUrl, () => assert.fail('article pause must apply')));
    const rejected = assert.rejects(automatic, {code: 'SOURCE_COOLDOWN'});
    release(rss);
    assert.equal(await rssWork, rss);
    await rejected;
});

test('cached background response stays readable during a content cooldown', async () => {
    await initialize();
    await assert.rejects(articleSourceCooldown.run(articleUrl, blocked));
    let payload;
    const res = {json: value => {payload = value;}};
    await withArticleFetchLane('p2', () => articleFallbackRequest(async (req, response) => response.json({...article, cached: true}))(
        {query: {url: articleUrl}}, res
    ));
    assert.equal(payload.cached, true);
    assert.equal(articleSourceCooldown.get(articleUrl).strikes, 1);
});

test('resolved article publisher owns the entire chain instead of the Google News URL', async () => {
    await initialize();
    let payload;
    await withArticleFetchLane('p3', () => articleFallbackRequest(async (req, res) => {
        retargetPublisherFallbacks(articleUrl);
        await assert.rejects(runArticleFetchTask(articleUrl, blocked));
        res.json(await runArticleFetchTask(articleUrl, () => article));
    })({query: {url: 'https://news.google.com/rss/articles/example'}}, {json: value => {payload = value;}}));
    assert.deepEqual(payload, article);
    assert.equal(articleSourceCooldown.get(articleUrl).strikes, undefined);
});

test('Smart primary challenge reaches its fallback URL without pausing RSS or article content', async () => {
    await initialize();
    const fetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => ++calls === 1 ? new Response('Blocked', {status: 403}) : new Response(rss);
    try {
        const result = await fetchSmartSource({url: feedUrl, fallbackUrl: 'https://other.test/rss'}, fastParseRSS, {});
        assert.equal(result.ok, true);
        assert.equal(result.fallbackUsed, true);
        assert.equal(calls, 2);
        assert.equal(rssSourceCooldown.get(feedUrl).strikes, undefined);
        assert.equal(articleSourceCooldown.get(articleUrl).strikes, undefined);
    } finally {globalThis.fetch = fetch;}
});

test('accepted manual RSS recovery clears only the RSS incident', async () => {
    await initialize();
    await assert.rejects(articleSourceCooldown.run(articleUrl, blocked));
    await assert.rejects(rssSourceCooldown.run(feedUrl, blocked));
    await withPublisherFetchKind('rss', async () => {
        const recovery = await createManualPublisherRefresh({url: feedUrl}, manualRefreshOptions(feedUrl).manualRefreshScopes, sourceCooldown);
        const feed = createFeedFetcher({fetchFn: async () => new Response(rss), log() {}});
        assert.equal(await (await recovery.run(() => feed(feedUrl))).text(), rss);
        assert.equal(rssSourceCooldown.get(feedUrl).strikes, 1, 'parsing still owns acceptance');
        await recovery.accept();
    });
    assert.equal(rssSourceCooldown.get(feedUrl).strikes, undefined);
    assert.equal(articleSourceCooldown.get(articleUrl).strikes, 1);
});

test('late chain success cannot clear an incident recorded after its admission', async () => {
    let clock = 1000, release, entered;
    const cooldown = createSourceCooldown({now: () => clock, baseMs: 100});
    await assert.rejects(cooldown.run(articleUrl, blocked));
    const started = new Promise(resolve => {entered = resolve;});
    const chain = runPublisherFallbacks(articleUrl, () => new Promise(resolve => {release = resolve; entered();}), {cooldown, lane: 'p0'});
    await started;
    clock += 101;
    await assert.rejects(cooldown.run(articleUrl, blocked));
    release(article);
    assert.deepEqual(await chain, article);
    assert.equal(cooldown.get(articleUrl).strikes, 2);
});

test('a Smart fallback-domain challenge creates an RSS incident only after both URLs fail', async () => {
    await initialize();
    const fetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        assert.equal(rssSourceCooldown.get(feedUrl).strikes, undefined);
        if (calls === 1) throw Error('Connection timed out');
        return new Response('Blocked', {status: 403});
    };
    try {
        const result = await fetchSmartSource({url: feedUrl, fallbackUrl: 'https://other.test/rss'}, fastParseRSS, {});
        assert.equal(result.ok, false);
        assert.equal(calls, 2);
        assert.equal(rssSourceCooldown.get(feedUrl).strikes, 1);
        assert.equal(articleSourceCooldown.get(articleUrl).strikes, undefined);
    } finally {globalThis.fetch = fetch;}
});

test('an HTTP success with unusable extracted content still tries the next configured reader', async () => {
    await initialize();
    const calls = [];
    const url = 'https://publisher.test/article';
    const result = await runArticleStrategies(url, ['direct', 'opencli-fetch'], async strategy => {
        calls.push(strategy);
        return parseStrategyCandidate(async () => strategy === 'direct' ? {content: '<p>Fragment</p>'} : article,
            '<html></html>', url);
    });
    assert.deepEqual(calls, ['direct', 'opencli-fetch']);
    assert.deepEqual(result, article);
    assert.equal(articleSourceCooldown.get(articleUrl).strikes, undefined);
});
