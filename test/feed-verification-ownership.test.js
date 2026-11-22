import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceCooldown, rssSourceCooldown, createSourceCooldown} from '../src/articles/source-cooldown.js';
import {getCurrentArticleFetchLaneContext} from '../src/articles/fetch-lanes.js';
import {publisherVerificationError} from '../src/articles/publisher-verification.js';
import {createFeedFetcher} from '../src/feeds/fetch-feed.js';
import {runFeedBrowserFallback} from '../src/feeds/browser-fallback.js';
import {createVozForumMetadataScraper} from '../src/feeds/voz-forum-metadata.js';

const url = 'https://voz.vn/f/diem-bao.33/index.rss';
const forum = 'https://voz.vn/f/diem-bao.33/';
const rss = '<rss><channel><title>Recovered VOZ feed</title></channel></rss>';
const blocked = () => {throw publisherVerificationError({status: 403});};

test('nested browser challenges defer the pause until the whole RSS fallback attempt fails', async () => {
    let persisted;
    await sourceCooldown.initialize({get: async () => ({}), put: async (key, raw) => {persisted = JSON.parse(raw);}});
    for (const readerWorks of [true, false]) {
        const calls = [];
        const fetchFeed = createFeedFetcher({
            fetchFn: async () => new Response('Blocked', {status: 403}),
            openCliFetch: target => runFeedBrowserFallback(target, () => {
                calls.push('fetch');
                // The real browser fetch has its own cooldown wrapper, too.
                return sourceCooldown.run(target, blocked, getCurrentArticleFetchLaneContext());
            }),
            openCliRead: target => runFeedBrowserFallback(target, () => {
                calls.push('reader');
                assert.equal(sourceCooldown.get(target).strikes, undefined);
                const context = getCurrentArticleFetchLaneContext();
                assert.equal(context.lane, 'p3');
                return sourceCooldown.run(target, readerWorks ? () => rss : blocked, context);
            }), log() {}
        });
        if (readerWorks) {
            assert.equal(await (await fetchFeed(url)).text(), rss);
            assert.equal(rssSourceCooldown.get(url).strikes, undefined);
            assert.equal(persisted, undefined);
        } else {
            await assert.rejects(fetchFeed(url), {code: 'PUBLISHER_VERIFICATION'});
            assert.equal(rssSourceCooldown.get(url).strikes, 1);
            assert.equal(persisted['voz.vn'].strikes, 1);
            await assert.rejects(fetchFeed(url), {code: 'SOURCE_COOLDOWN'});
        }
        assert.deepEqual(calls, ['fetch', 'reader']);
    }
});

test('optional VOZ metadata verification cannot rearm a successfully fetched RSS source', async () => {
    for (const status of [200, 403]) {
        const cooldown = createSourceCooldown();
        const feed = createFeedFetcher({cooldown, fetchFn: async () => new Response(rss), log() {}});
        assert.equal(await (await feed(url)).text(), rss);
        let calls = 0;
        const scraper = createVozForumMetadataScraper({cooldown, CF_PROXY_BASE: 'https://proxy.test/?url=',
            fetchFn: async () => {calls++; return new Response('<html><title>Just a moment...</title></html>', {status});}});
        assert.equal((await scraper(forum)).size, 0);
        assert.equal(calls, 1, 'a challenge does not trigger page two');
        assert.equal(cooldown.get(url).strikes, undefined);
        assert.equal(await cooldown.run(url, () => 'still available'), 'still available');
    }
});

test('optional VOZ metadata cannot pause RSS on 429 but still respects an existing RSS pause', async () => {
    const cooldown = createSourceCooldown();
    let calls = 0;
    const scraper = createVozForumMetadataScraper({cooldown, CF_PROXY_BASE: 'https://proxy.test/?url=',
        fetchFn: async () => {calls++; return new Response('Rate limited', {status: 429, headers: {'Retry-After': '600'}});}});
    assert.equal((await scraper(forum)).size, 0);
    assert.equal(cooldown.get(url).strikes, undefined);
    await cooldown.record(url, publisherVerificationError({status: 429, retryAfterMs: 600000}));
    assert.equal((await scraper(forum)).size, 0);
    assert.equal(calls, 1);
});

test('VOZ metadata still merges starter dates and view counts across usable pages', async () => {
    let calls = 0;
    const scraper = createVozForumMetadataScraper({cooldown: createSourceCooldown(), CF_PROXY_BASE: 'https://proxy.test/?url=',
        fetchFn: async target => {
            const page = ++calls;
            assert.equal(new URL(target).searchParams.get('url'), forum + (page === 2 ? '?page=2' : ''));
            return new Response(`<html><div class="structItem js-threadListItem-${page}">
                <div class="structItem-startDate"><time datetime="2026-11-01T10:00:00Z"></time></div>
                <div class="structItem-cell--meta"><dl class="pairs"><dd>20</dd></dl>
                <dl class="pairs structItem-minor"><dd>1K</dd></dl></div></div></html>`);
        }});
    const results = await scraper(forum);
    assert.equal(calls, 2);
    assert.equal(results.size, 2);
    assert.equal(results.get('1').views, 1000);
    assert.equal(results.get('2').replies, 20);
    assert.equal(results.get('2').createDate, '2026-11-01T10:00:00.000Z');
});
