import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeedSync} from '../src/feeds/sync.js';
import registry from '../src/sources/index.js';

test('RSS commits one Board observation for completed feeds before publishing the refreshed corpus', async t => {
    const feeds = ['first', 'failed', 'last'].map(name => ({url: `https://${name}.example.test/rss`, title: name}));
    const values = {feeds, articles: []}, events = [];
    t.mock.method(registry, 'getHandler', () => ({fetchFeed: async url => {
        if (url.includes('failed')) throw Error('Feed unavailable');
        return {title: 'Fixture', items: [{link: url + '/article', title: 'Stable article', content: 'Body',
            image: 'https://example.test/photo.jpg', pubDate: '2026-10-12T00:00:00Z'}]};
    }}));
    const env = {RSS_DATA: {
        get: async key => structuredClone(values[key] || []),
        putMany: async changes => {events.push('publish'); for (const [key, value] of Object.entries(changes)) values[key] = JSON.parse(value);}
    }};
    const observations = [];
    const service = createFeedSync({env, recordFetch() {}, hasOnlyOpenCliFetchMethod: () => false,
        prefetchOpenCliOnlyArticles: async () => {}, computeUniversalPrefetchList: async () => [],
        reconcileAllConfiguredSourceFetchMethods: async () => {},
        observeCacheArticles: async articles => {observations.push(articles); events.push('observe');}
    });
    const result = await service.syncFeeds(env);
    assert.equal(observations.length, 1);
    assert.deepEqual(observations[0].map(article => article.feedUrl), [feeds[0].url, feeds[2].url]);
    assert.deepEqual(events, ['observe', 'publish']);
    assert.equal(values.articles.length, 2);
    assert.match(result.logs[0].Issue, /Feed unavailable/);
});
