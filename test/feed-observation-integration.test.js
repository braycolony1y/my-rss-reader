import { addMemoryUpdates } from './helpers/memory-updates.js';
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
    addMemoryUpdates(env.RSS_DATA, values);
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

test('RSS stores the same canonical Google News destination as record repair', async t => {
    const { applyGoogleNewsDestinations } = await import('../src/articles/google-news-repair.js');
    const feedUrl = 'https://news.google.com/rss/search?q=site%3Aexample.test';
    const wrapper = 'https://news.google.com/read/mockArticle';
    const wrongWrapper = 'https://news.google.com/read/mockWrong';
    const decoded = 'https://example.test/story?ref=feed&sig=%2f+~&utm_medium=rss&gclid=123#part';
    const expected = 'https://example.test/story?sig=%2f+~';
    const values = { feeds: [{ url: feedUrl, title: 'Test' }], articles: [] };
    t.mock.method(registry, 'getHandler', url => url === feedUrl ? ({
        fetchFeed: async () => ({ items: [wrapper, wrongWrapper].map((link, index) => ({
            link, title: 'Story ' + index, pubDate: new Date().toISOString(), imageUrl: 'https://example.test/photo.jpg'
        })) })
    }) : null);
    const db = {
        get: async key => structuredClone(values[key] || []),
        putMany: async changes => {
            for (const [key, value] of Object.entries(changes)) values[key] = JSON.parse(value);
        }
    };
    addMemoryUpdates(db, values);
    const sync = createFeedSync({ env: { RSS_DATA: db }, recordFetch() {}, hasOnlyOpenCliFetchMethod: () => false,
        prefetchOpenCliOnlyArticles: async () => {}, reconcileAllConfiguredSourceFetchMethods: async () => {},
        googleDecoder: { decodeBatch: async () => [
            { status: true, source_url: wrapper, decoded_url: decoded, source: 'offline' },
            { status: true, source_url: wrongWrapper, decoded_url: 'https://unrelated.test/wrong' }
        ] }
    });
    assert.deepEqual((await sync.syncFeeds({ RSS_DATA: db })).logs, []);
    const repaired = { link: wrapper, feedUrl };
    assert.equal(applyGoogleNewsDestinations(repaired, { [wrapper]: { resolvedUrl: decoded, source: 'offline' } }), true);
    assert.equal(repaired.link, expected);
    assert.equal(values.articles.find(item => item.originalLink === wrapper).link, expected);
    assert.equal(values.articles.find(item => item.originalLink === wrongWrapper).link, wrongWrapper);
});
