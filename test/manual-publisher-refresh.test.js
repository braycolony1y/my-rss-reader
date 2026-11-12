import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceCooldown, sourceCooldown, rssSourceCooldown} from '../src/articles/source-cooldown.js';
import {withPublisherFetchKind} from '../src/articles/publisher-fetch-context.js';
import {createManualPublisherRefresh} from '../src/articles/manual-publisher-refresh.js';
import {manualRefreshOptions, matchesManualRefresh} from '../src/articles/manual-refresh-scopes.js';
import {coalesceFeedSync} from '../src/feeds/coalescing.js';
import {coalesceSmartRefresh} from '../src/smart/refresh/coalescing.js';
import {createFeedFetcher} from '../src/feeds/fetch-feed.js';
import {runFeedBrowserFallback} from '../src/feeds/browser-fallback.js';
import {getCurrentArticleFetchLaneContext, runArticleFetchTask, withArticleFetchLane} from '../src/articles/fetch-lanes.js';
import {fetchSmartSource} from '../src/smart/sources/fetch.js';
import {fetchSmartSourceForRefresh} from '../src/smart/sources/manual-fetch.js';
import {fastParseRSS} from '../feed-parsers.js';

const item = {url: 'https://publisher.test/feed.xml', category: 'Forum'};
const rss = '<rss><channel><title>Fixture</title><item><title>New article</title><link>https://publisher.test/article</link></item></channel></rss>';
const blocked = () => {throw Object.assign(Error('Publisher verification HTTP 403'), {code: 'PUBLISHER_VERIFICATION', status: 403});};

async function fixture(cooldown) {
    let clock = 1000;
    const values = {};
    const db = {get: async key => structuredClone(values[key]), put: async (key, raw) => {values[key] = JSON.parse(raw);}};
    cooldown ||= createSourceCooldown({now: () => clock, baseMs: 100});
    await cooldown.initialize(db);
    await assert.rejects(cooldown.run(item.url, blocked));
    return {cooldown, db, values, advance: ms => {clock += ms;}};
}

test('manual acquisition bypasses its pause, preserves background priority and clears only after accepted success', () => withPublisherFetchKind('rss', async () => {
    const f = await fixture(rssSourceCooldown), scopes = manualRefreshOptions(item.url).manualRefreshScopes;
    const recovery = await createManualPublisherRefresh(item, scopes, f.cooldown);
    const fetchFeed = createFeedFetcher({fetchFn: async () => new Response('Blocked', {status: 403}),
        openCliFetch: url => runFeedBrowserFallback(url, () => {
            const context = getCurrentArticleFetchLaneContext();
            assert.equal(context.lane, 'p3');
            return sourceCooldown.run(url, () => rss, context);
        }), openCliRead: () => assert.fail('working browser'), log() {}});
    assert.equal(await (await recovery.run(() => fetchFeed(item.url))).text(), rss);
    assert.equal(f.cooldown.get(item.url).strikes, 1, 'network success alone is not parsed acceptance');
    await assert.rejects(fetchFeed(item.url), {code: 'SOURCE_COOLDOWN'});
    await recovery.accept();
    assert.equal(f.cooldown.get(item.url).strikes, undefined);
    const restarted = createSourceCooldown(); await restarted.initialize(f.db);
    assert.equal(restarted.get(item.url).strikes, undefined);
}));

test('manual verification failure preserves an existing cooldown exactly, even after expiry', async () => {
    for (const expired of [false, true]) {
        const f = await fixture();
        if (expired) f.advance(101);
        const previous = structuredClone(f.values.publisherVerificationCooldowns);
        const recovery = await createManualPublisherRefresh(item, manualRefreshOptions().manualRefreshScopes, f.cooldown);
        await assert.rejects(recovery.run(() => f.cooldown.run(item.url, blocked)));
        assert.deepEqual(f.values.publisherVerificationCooldowns, previous);
        assert.equal(f.cooldown.get(item.url).strikes, 1);
    }
});

test('queued manual browser work retains its bypass while following background work stays paused', async () => {
    await sourceCooldown.initialize({get: async () => ({}), put: async () => {}});
    let release, entered;
    const started = new Promise(resolve => {entered = resolve;});
    const first = withArticleFetchLane('p3', () => runArticleFetchTask(item.url,
        () => new Promise(resolve => {release = resolve; entered();})));
    await started;
    await sourceCooldown.record(item.url, Error('HTTP 403'));
    const recovery = await createManualPublisherRefresh(item, manualRefreshOptions(item.url).manualRefreshScopes, sourceCooldown);
    const manual = recovery.run(() => runFeedBrowserFallback(item.url, async () => {
        const context = getCurrentArticleFetchLaneContext();
        // Simulate the browser's separate queue restoring only its lane context.
        return new Promise((resolve, reject) => setTimeout(() => {
            sourceCooldown.run(item.url, () => rss, {...context}).then(resolve, reject);
        }, 0));
    }));
    const automatic = withArticleFetchLane('p3', () => runArticleFetchTask(item.url,
        () => assert.fail('auto work must not inherit preceding manual permission')));
    const rejected = assert.rejects(automatic, {code: 'SOURCE_COOLDOWN'});
    release('earlier background work');
    await first;
    assert.equal(await manual, rss);
    await rejected;
    await recovery.accept();
    assert.equal(sourceCooldown.get(item.url).strikes, undefined);
});

test('manual failure still creates a pause when no earlier cooldown exists', async () => {
    const cooldown = createSourceCooldown();
    const recovery = await createManualPublisherRefresh(item, manualRefreshOptions(item.url).manualRefreshScopes, cooldown);
    await assert.rejects(recovery.run(() => cooldown.run(item.url, blocked)));
    assert.equal(cooldown.get(item.url).strikes, 1);
    await assert.rejects(cooldown.run(item.url, () => assert.fail('background paused')), {code: 'SOURCE_COOLDOWN'});
});

test('manual scope cannot bypass another publisher or a concurrent background task', async () => {
    const f = await fixture(), other = 'https://other.test/feed.xml';
    await assert.rejects(f.cooldown.run(other, blocked));
    const recovery = await createManualPublisherRefresh(item, manualRefreshOptions(item.url).manualRefreshScopes, f.cooldown);
    let entered, finish;
    const started = new Promise(resolve => {entered = resolve;});
    const manual = recovery.run(async () => {
        await assert.rejects(f.cooldown.run(other, () => assert.fail('unrelated publisher')), {code: 'SOURCE_COOLDOWN'});
        return f.cooldown.run(item.url, () => new Promise(resolve => {finish = resolve; entered();}));
    });
    await started;
    await assert.rejects(f.cooldown.run(item.url, () => assert.fail('concurrent background')), {code: 'SOURCE_COOLDOWN'});
    finish('manual success'); await manual;
    await recovery.accept();
    assert.equal(f.cooldown.get(other).strikes, 1);
});

test('detached work loses manual permission when acquisition finishes', async () => {
    const f = await fixture();
    const recovery = await createManualPublisherRefresh(item, manualRefreshOptions().manualRefreshScopes, f.cooldown);
    let resume, detached;
    await recovery.run(async () => {
        detached = new Promise(resolve => {resume = resolve;}).then(() =>
            f.cooldown.run(item.url, () => assert.fail('detached background work')));
    });
    const rejected = assert.rejects(detached, {code: 'SOURCE_COOLDOWN'});
    resume(); await rejected;
});

test('accepted manual success cannot erase a newer independent verification incident', async () => {
    const f = await fixture();
    const recovery = await createManualPublisherRefresh(item, manualRefreshOptions().manualRefreshScopes, f.cooldown);
    await recovery.run(() => f.cooldown.run(item.url, () => rss));
    f.advance(101); await assert.rejects(f.cooldown.run(item.url, blocked));
    await recovery.accept();
    assert.equal(f.cooldown.get(item.url).strikes, 2);
});

test('RSS manual bypass scopes remain isolated from automatic pending work', async () => {
    const calls = [], gates = [];
    const sync = coalesceFeedSync(async (env, feed, progress, category, options) => {
        calls.push({feed, category, options}); await new Promise(resolve => gates.push(resolve));
    }, () => {});
    const env = {RSS_DATA: {}};
    const first = sync(env);
    const a = sync(env, item.url, null, null, manualRefreshOptions(item.url));
    const b = sync(env, 'https://other.test/feed.xml');
    assert.equal(calls[1].feed, item.url);
    assert.equal(matchesManualRefresh(item, calls[1].options.manualRefreshScopes), true);
    assert.equal(matchesManualRefresh({url: 'https://other.test/feed.xml'}, calls[1].options.manualRefreshScopes), false);
    gates.shift()(); await first;
    assert.equal(calls[2].feed, 'https://other.test/feed.xml');
    assert.deepEqual(calls[2].options.manualRefreshScopes, []);
    gates.shift()(); gates.shift()(); await Promise.all([a, b]);
});

test('Smart coalescing unions selected manual categories without granting a full bypass', async () => {
    const calls = [], gates = [];
    const sync = coalesceSmartRefresh(async (progress, category, options) => {
        calls.push({category, options}); await new Promise(resolve => gates.push(resolve));
    }, () => {});
    const first = sync();
    const a = sync(null, 'news_vietnam', manualRefreshOptions(null, 'news_vietnam'));
    const b = sync(null, 'tech_global', manualRefreshOptions(null, 'tech_global'));
    const auto = sync();
    gates.shift()(); await first;
    const scopes = calls[1].options.manualRefreshScopes;
    assert.equal(calls[1].category, null);
    for (const category of ['news_vietnam', 'tech_global']) assert.equal(matchesManualRefresh({category}, scopes), true);
    assert.equal(matchesManualRefresh({category: 'finance_global'}, scopes), false);
    gates.shift()(); await Promise.all([a, b, auto]);
});

test('Smart manual refresh bypasses publisher verification cooldown while background source sync stays paused', async () => {
    const f = await fixture(rssSourceCooldown), originalFetch = globalThis.fetch;
    const source = {...item, category: 'news_vietnam'};
    let requests = 0;
    globalThis.fetch = async () => {requests++; return new Response(rss);};
    try {
        const background = await fetchSmartSource(source, fastParseRSS, {});
        assert.equal(background.ok, false); assert.equal(requests, 0);
        const manual = await fetchSmartSourceForRefresh(source, fastParseRSS, {}, manualRefreshOptions(null, source.category).manualRefreshScopes);
        assert.equal(manual.ok, true); assert.equal(requests, 1);
        assert.equal(f.cooldown.get(item.url).strikes, undefined);
    } finally {globalThis.fetch = originalFetch;}
});
