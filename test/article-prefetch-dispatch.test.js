import test from 'node:test';
import assert from 'node:assert/strict';
import {createArticlePrefetch} from '../src/feeds/prefetch.js';
import {getCurrentArticleFetchLaneContext} from '../src/articles/fetch-lanes.js';

test('next-article and idle prefetch actually dispatch allowed strategies in their intended lanes', async () => {
    const article = {link: 'https://example.com/next', title: 'Next article', feedUrl: 'feed'};
    const policy = {strategyOrder: ['direct'], availableStrategies: ['direct']};
    const calls = [];
    let notify;
    const cached = new Promise(resolve => {notify = resolve;});
    const env = {RSS_DATA: {get: async key => ['articles', 'universalPrefetchTargets'].includes(key) ? [article] : []}};
    const service = createArticlePrefetch({env, progress: {activeForegroundRequests: 0}, googleNews: {},
        getCachedArticle: async () => null, waitForHttpIdle: async () => {}, getArticleFetchPolicy: async () => policy,
        fetchParsedArticleByStrategy: async (strategy, link, resolved) => {
            assert.equal(resolved, policy);
            calls.push({strategy, link, lane: getCurrentArticleFetchLaneContext().lane});
            return {title: article.title, content: '<p>Fetched article content.</p>'};
        }, cacheArticleResult: async () => notify(), requiresIndependentDeletionConfirmation: () => false});
    await service.triggerNextFiveArticlesPrefetch('https://example.com/current', false, [article]);
    let timeout;
    try {
        await Promise.race([cached, new Promise((_, reject) => {timeout = setTimeout(() => reject(Error('Prefetch never dispatched')), 3000);})]);
    } finally {clearTimeout(timeout);}
    await service.runUniversalTabPrefetch(env);
    assert.deepEqual(calls, [
        {strategy: 'direct', link: article.link, lane: 'p2'},
        {strategy: 'direct', link: article.link, lane: 'p4'}
    ]);
});
