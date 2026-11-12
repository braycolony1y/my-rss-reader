import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeedSync} from '../src/feeds/sync.js';
import {manualRefreshOptions} from '../src/articles/manual-refresh-scopes.js';
import registry from '../src/sources/index.js';
import {addMemoryUpdates} from './helpers/memory-updates.js';

// Exercise the real sync/publication path while unrelated ingestion remains
// unresolved, including the late background result for the same forum story.
test('Forum manual sync publishes before slow full sync and survives its late result', async t => {
    const news = {url: 'https://slow.test/rss', title: 'Slow', category: 'News'};
    const forum = {url: 'https://forum.test/rss', title: 'Forum', category: 'Forum'};
    const values = {feeds: [news, forum], articles: []};
    const db = addMemoryUpdates({
        get: async key => structuredClone(values[key] || []),
        putMany: async changes => {for (const [key, raw] of Object.entries(changes)) values[key] = JSON.parse(raw);}
    }, values);
    const env = {RSS_DATA: db};
    let releaseNews, releaseForum, forumStarted, forumCalls = 0;
    const newsGate = new Promise(resolve => {releaseNews = resolve;});
    const forumGate = new Promise(resolve => {releaseForum = resolve;});
    const backgroundForumStarted = new Promise(resolve => {forumStarted = resolve;});
    t.mock.method(registry, 'getHandler', () => ({fetchFeed: async url => {
        let title = 'news';
        if (url === news.url) await newsGate;
        else if (++forumCalls === 1) {title = 'old'; forumStarted(); await forumGate;}
        else title = 'new';
        return {items: [{title, link: url + '/story', content: title,
            imageUrl: 'https://image.test/' + title + '.jpg', pubDate: '2026-11-12T00:00:00Z'}]};
    }}));
    const service = createFeedSync({env, recordFetch() {},
        hasOnlyOpenCliFetchMethod: () => false, prefetchOpenCliOnlyArticles: async () => {},
        reconcileAllConfiguredSourceFetchMethods: async () => {}});
    const background = service.syncFeeds(env);
    let timeout;
    try {
        await backgroundForumStarted;
        const manual = service.syncFeeds(env, null, null, 'Forum', manualRefreshOptions(null, 'Forum'));
        await Promise.race([manual, new Promise((_, reject) => {
            timeout = setTimeout(() => reject(Error('Manual refresh waited for unrelated feed work')), 5000);
        })]);
        assert.equal(values.articles[0].title, 'new');
        assert.equal(forumCalls, 2);
    } finally {
        clearTimeout(timeout); releaseNews(); releaseForum(); await background;
    }
    assert.equal(values.articles.find(value => value.feedUrl === forum.url).title, 'new');
    assert.equal(values.articles.find(value => value.feedUrl === news.url).title, 'news');
});
