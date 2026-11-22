import test from 'node:test';
import assert from 'node:assert/strict';
import { isRedditUrl } from '../src/utils/article-utils.js';
import { createArticlePipeline } from '../src/articles/pipeline.js';
import { createArticleFetchPolicy } from '../src/articles/fetch-policy.js';
import { createArticlePrefetch } from '../src/feeds/prefetch.js';
import { createArticleImages } from '../src/articles/images.js';

const reddit = 'https://www.reddit.com/r/hardware/comments/123/review/';
test('Reddit domains and short links are external, without matching lookalike hosts', () => {
    for (const url of [reddit, 'https://old.reddit.com/r/test', 'https://redd.it/abc']) assert.equal(isRedditUrl(url), true);
    for (const url of ['https://notreddit.com', 'https://reddit.com.example.org', 'javascript:alert(1)', 'invalid']) assert.equal(isRedditUrl(url), false);
});
test('Reddit content and image work is skipped even for explicit or stale jobs', async () => {
    const policy = await createArticleFetchPolicy().getArticleFetchPolicy(reddit);
    assert.deepEqual(policy.strategyOrder, []);
    assert.equal(policy.openExternally, true);
    assert.equal(await createArticlePipeline().fetchParsedArticleByStrategy('opencli', reddit, {}), null);
    assert.equal(await createArticleImages().getBestImage(reddit, () => assert.fail('No network fetch'), 'https://preview.redd.it/photo.jpg'), 'https://preview.redd.it/photo.jpg');
    const prefetch = createArticlePrefetch();
    assert.deepEqual(await prefetch.prefetchOpenCliOnlyArticles([{ link: reddit }]), [false]);
    assert.deepEqual(await prefetch.triggerNextFiveArticlesPrefetch(reddit), []);
});
test('mixed and persisted prefetch queues exclude Reddit before cache or network access', async () => {
    const news = 'https://publisher.example/article';
    const seen = [];
    const env = { RSS_DATA: { get: async key => key === 'articles' ? [{ link: reddit }, { link: news }]
        : key === 'universalPrefetchTargets' ? [{ link: reddit }] : [] } };
    const prefetch = createArticlePrefetch({ env, getCachedArticle: async url => { seen.push(url); return null; }, waitForHttpIdle: async () => {} });
    const next = await prefetch.triggerNextFiveArticlesPrefetch(news, true, [reddit, news]);
    assert.deepEqual(next.map(item => item.url), [news]);
    const universal = await prefetch.computeUniversalPrefetchList(env);
    assert.ok(universal.every(item => !isRedditUrl(item.url)));
    await prefetch.runUniversalTabPrefetch(env);
    assert.deepEqual(seen, [news]);
});
