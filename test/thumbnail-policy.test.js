import test from 'node:test';
import assert from 'node:assert/strict';
import { createArticleImages } from '../src/articles/images.js';
import { getArticleThumbnail } from '../src/articles/thumbnail.js';
import { getCurrentArticleFetchLaneContext } from '../src/articles/fetch-lanes.js';

const url = 'https://voz.vn/t/story.123';
const cover = 'https://images.example.com/cover.jpg';
const content = `<div class="voz-post"><img src="https://example.com/avatar.jpg"><div class="voz-post-body"><blockquote><img class="bbImage" src="https://example.com/quote.jpg"></blockquote><img class="bbImage" src="https://voz.vn/proxy.php?image=${encodeURIComponent(cover)}&amp;hash=abc"></div></div><div class="voz-post"><div class="voz-post-body"><img class="bbImage" src="https://example.com/reply.jpg"></div></div>`;

test('VOZ thumbnail reuses first-post content even when cached image is null', async () => {
    const images = createArticleImages({
        getLastKnownCachedArticle: async () => ({ image: null, content }),
        getArticleFetchPolicy: () => assert.fail('Cached content must not be fetched again')
    });
    assert.equal(await images.getBestImage(url), cover);
    assert.equal(getArticleThumbnail(url + '/page-2', { content }), null);
    assert.equal(getArticleThumbnail(url, { content, pagination: { currentPage: 2 } }), null);
    assert.equal(getArticleThumbnail(url, { content: '<div class="voz-post"><div class="voz-post-body">Text only</div></div>' + content }), null);
});

test('thumbnails follow the source policy in order without legacy direct/proxy fallback', async () => {
    const calls = [];
    const cached = [];
    const policy = { strategyOrder: ['cloudflare', 'opencli-fetch'] };
    const images = createArticleImages({
        getLastKnownCachedArticle: async () => null,
        getArticleFetchPolicy: async target => { assert.equal(target, url); return policy; },
        fetchParsedArticleByStrategy: async (method, target, receivedPolicy) => {
            assert.equal(getCurrentArticleFetchLaneContext().lane, 'p2');
            calls.push(method);
            assert.equal(target, url);
            assert.equal(receivedPolicy, policy);
            if (method === 'cloudflare') throw Error('Publisher challenge');
            return { content, image: null, fetchStrategy: method };
        },
        cacheArticleResult: async (target, result) => cached.push(result)
    });
    assert.equal(await images.getBestImage(url + '/unread', () => assert.fail('Legacy fetch must not run')), cover);
    assert.deepEqual(calls, policy.strategyOrder);
    assert.equal(cached[0].image, cover);
});

test('cached card image bypasses full article normalization and all extraction', async () => {
    const images = createArticleImages({
        getLastKnownCachedArticleImage: async () => cover,
        getLastKnownCachedArticle: () => assert.fail('Card lookup must not normalize an entire cached thread'),
        getArticleFetchPolicy: () => assert.fail('Cached image needs no remote extraction')
    });
    assert.equal(await images.getBestImage(url), cover);
});

for (const methods of [['opencli'], ['jina'], ['direct'], []]) {
    test(`thumbnail stays within configured methods: ${methods.join(',') || 'none'}`, async () => {
        const calls = [];
        const images = createArticleImages({
            getLastKnownCachedArticle: async () => null,
            getArticleFetchPolicy: async () => ({ strategyOrder: methods }),
            fetchParsedArticleByStrategy: async method => { calls.push(method); throw Error('Unavailable'); }
        });
        assert.equal(await images.getBestImage('https://example.com/story', () => assert.fail('Unconfigured fetch')), null);
        assert.deepEqual(calls, methods);
    });
}
