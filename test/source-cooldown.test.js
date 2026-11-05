import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createSourceCooldown, sourceCooldown } from '../src/articles/source-cooldown.js';
import { isPublisherVerification, readPublisherResponse, isVerificationPage, readWithHumanVerification } from '../src/articles/publisher-verification.js';
import { runArticleFetchTask, withArticleFetchLane } from '../src/articles/fetch-lanes.js';
import { createFeedFetcher } from '../src/feeds/fetch-feed.js';
import { createArticleProgress } from '../src/articles/progress.js';
import { createVerificationNoticeMiddleware } from '../src/articles/verification-notice.js';
import { assertArticleResultAcceptedBySource } from '../src/articles/source-results.js';
import { createArticleRequestFlight } from '../src/articles/request-flight.js';
import { backgroundPublisherFetch, backgroundPublisherCommand } from '../src/articles/background-publisher-fetch.js';

const FT = 'https://www.ft.com/content/article';
const BLOCK = '<html><h1>Security Verification</h1><p>For help please visit help.ft.com</p><p>Cloudflare Verifying...</p><p>Error Code: CG000 / 403</p></html>';
const blocked = () => { throw Error('OpenCLI browser fetch remained behind verification (HTTP 403)'); };

test('a delayed progress poll cannot erase a verification alert or change a newer article', () => {
    const browser = { window: {} };
    vm.runInNewContext(readFileSync(new URL('../public/js/article/verification-notice.js', import.meta.url), 'utf8'), browser);
    const notices = browser.window.ReaderPublisherVerification;
    const component = { articleOverlayOpen: true, overlayRequestId: 'first', overlayProgress: { message: 'Starting' } };
    notices.apply(component, { publisherVerification: { url: FT } });
    notices.applyProgress(component, { message: 'Old fetching response' }, 'first');
    assert.equal(component.overlayProgress.publisherVerification.url, FT);
    component.overlayRequestId = 'second';
    component.overlayProgress = { message: 'Second article' };
    notices.applyProgress(component, { publisherVerification: { url: FT } }, 'first');
    assert.equal(component.overlayProgress.publisherVerification, undefined);
    assert.equal(component.overlayProgress.message, 'Second article');
});

test('FT verification is detected in raw HTTP and browser results, including HTTP 200', async () => {
    assert.equal(isPublisherVerification(BLOCK), true);
    assert.equal(isPublisherVerification(Error('OpenCLI browser navigation did not become usable: Just a moment...')), true);
    assert.equal(isVerificationPage({ title: 'Financial Times', contentHtml: BLOCK }), true);
    await assert.rejects(readPublisherResponse(new Response(BLOCK)), { code: 'PUBLISHER_VERIFICATION' });
    await assert.rejects(readPublisherResponse(new Response('Too many requests', { status: 429, headers: { 'Retry-After': '600' } })), { code: 'PUBLISHER_VERIFICATION', retryAfterMs: 600000 });
    assert.throws(() => assertArticleResultAcceptedBySource(FT, { title: 'Security Verification', content: BLOCK }), { code: 'PUBLISHER_VERIFICATION' });
    assert.equal(isPublisherVerification('<article><h1>Security verification software market</h1><p>A report on software.</p></article>'), false);
    assert.equal(isPublisherVerification('<rss><channel><item><title>Security Verification</title><description>How Cloudflare works</description></item></channel></rss>'), false);
});

test('Smart and special feed HTTP paths share the publisher pause with article fetches', async () => {
    await sourceCooldown.initialize({ get: async () => ({}), put: async () => {} });
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(BLOCK, { status: 403 }); };
    try {
        await assert.rejects(backgroundPublisherFetch(FT), { code: 'PUBLISHER_VERIFICATION' });
        await assert.rejects(backgroundPublisherFetch('https://ft.com/rss'), { code: 'SOURCE_COOLDOWN' });
        await assert.rejects(backgroundPublisherCommand(FT, () => assert.fail('paused browser command')), { code: 'SOURCE_COOLDOWN' });
        assert.equal(calls, 1);
    } finally { globalThis.fetch = original; }
});

test('simultaneous foreground subscribers both receive the manual verification notice', async () => {
    const progress = createArticleProgress();
    let finish;
    const flight = createArticleRequestFlight(progress)(async (req, res) => {
        await new Promise(resolve => { finish = resolve; });
        const { getCurrentArticleFetchLaneContext } = await import('../src/articles/fetch-lanes.js');
        getCurrentArticleFetchLaneContext().onVerification({ url: FT });
        res.json({ error: 'Verification required' });
    });
    const middleware = createVerificationNoticeMiddleware(progress.updateArticleFetchProgress);
    const start = id => withArticleFetchLane('p0', async () => {
        let payload;
        const req = { query: { url: FT, requestId: id, interactive: '1' } };
        const res = { json: value => { payload = value; }, status() { return this; } };
        middleware(req, res, () => {});
        await flight(req, res);
        return payload;
    }, { requestId: id });
    const primary = start('primary');
    const follower = start('follower');
    finish();
    for (const payload of await Promise.all([primary, follower])) assert.equal(payload.publisherVerification.url, FT);
});

test('each publisher escalates independently; foreground and cached work remain possible', async () => {
    let clock = 1000;
    const cooldown = createSourceCooldown({ now: () => clock, baseMs: 100, maxMs: 400, quietMs: 10000 });
    for (const duration of [100, 200, 400, 400]) {
        await assert.rejects(cooldown.run(FT, blocked));
        assert.equal(cooldown.get(FT).remainingMs, duration);
        await assert.rejects(cooldown.run('https://ft.com/another', () => assert.fail('paused')), { code: 'SOURCE_COOLDOWN' });
        assert.equal(await cooldown.run('https://www.bbc.com/a', () => 'other source'), 'other source');
        assert.equal(await cooldown.run(FT, () => 'foreground content', { lane: 'p0' }), 'foreground content');
        clock += duration + 1;
    }
    clock += 10000;
    await assert.rejects(cooldown.run(FT, blocked));
    assert.equal(cooldown.get(FT).remainingMs, 100);
});

test('simultaneous and nested blocked results count once, even if an old request finishes after expiry', async () => {
    let clock = 1000, finish;
    const cooldown = createSourceCooldown({ now: () => clock, baseMs: 100 });
    const late = cooldown.run(FT, () => new Promise((resolve, reject) => { finish = reject; }));
    await assert.rejects(cooldown.run(FT, () => cooldown.run(FT, blocked)));
    clock += 101;
    finish(Error('HTTP 403'));
    await assert.rejects(late);
    assert.equal(cooldown.get(FT).strikes, 1);
});

test('cooldowns survive restart and honor Retry-After', async () => {
    const values = {};
    const db = { get: async key => values[key], put: async (key, value) => { values[key] = JSON.parse(value); } };
    const cooldown = createSourceCooldown({ now: () => 1000, baseMs: 100 });
    await cooldown.initialize(db);
    await assert.rejects(cooldown.run(FT, () => { throw Object.assign(Error('HTTP 429'), { retryAfterMs: 1000 }); }));
    const restarted = createSourceCooldown({ now: () => 1100 });
    await restarted.initialize(db);
    assert.equal(restarted.get(FT).remainingMs, 900);
    await assert.rejects(restarted.run(FT, () => assert.fail('paused')), { code: 'SOURCE_COOLDOWN' });
});

test('queued background articles check the pause when they start; p0 still runs', async () => {
    await sourceCooldown.initialize({ get: async () => ({}), put: async () => {} });
    let release;
    const first = withArticleFetchLane('p3', () => runArticleFetchTask(FT, () => new Promise(resolve => { release = resolve; })));
    const second = withArticleFetchLane('p3', () => runArticleFetchTask(FT, () => assert.fail('queued fetch should not run')));
    await new Promise(resolve => setImmediate(resolve));
    release(BLOCK);
    await assert.rejects(first, { code: 'PUBLISHER_VERIFICATION' });
    await assert.rejects(second, { code: 'SOURCE_COOLDOWN' });
    assert.equal(await withArticleFetchLane('p0', () => runArticleFetchTask(FT, () => 'opened by user')), 'opened by user');
});

test('RSS skips later background calls only after verification exhausts its fallbacks', async () => {
    let calls = 0;
    const fetchFeed = createFeedFetcher({ cooldown: createSourceCooldown(), fetchFn: async () => { calls++; return new Response(BLOCK); },
        openCliFetch: async () => {calls++; return BLOCK;}, openCliRead: async () => {calls++; return BLOCK;}, log() {} });
    await assert.rejects(fetchFeed(FT), { code: 'PUBLISHER_VERIFICATION' });
    await assert.rejects(fetchFeed(FT), { code: 'SOURCE_COOLDOWN' });
    assert.equal(calls, 3);
});

test('foreground verification reaches progress and final response, and the manual browser read resumes', async () => {
    const progress = createArticleProgress();
    await withArticleFetchLane('p0', async () => {
        let payload;
        const response = { json: value => { payload = value; } };
        createVerificationNoticeMiddleware(progress.updateArticleFetchProgress)({}, response, () => {});
        await assert.rejects(runArticleFetchTask(FT, blocked));
        progress.finishArticleFetchProgress('notice-test', 'Failed');
        response.json({ error: 'Failed' });
        assert.equal(payload.publisherVerification.url, FT);
        assert.equal(progress.articleFetchProgress.get('notice-test').publisherVerification.url, FT);
    }, { requestId: 'notice-test' });
    let prompted = 0;
    const pages = [{ contentHtml: BLOCK }, { contentHtml: '<article>Actual article</article>' }];
    const result = await readWithHumanVerification(page => page.evaluate(), { evaluate: async () => pages.shift(), wait: async () => {} }, {}, () => { prompted++; return true; });
    assert.equal(prompted, 1);
    assert.match(result.contentHtml, /Actual article/);
});
