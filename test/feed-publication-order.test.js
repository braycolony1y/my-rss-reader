import test from 'node:test';
import assert from 'node:assert/strict';
import {beginFeedPublication} from '../src/feeds/publication-order.js';
import {publishFeedResults} from '../src/feeds/publish-results.js';
import {addMemoryUpdates} from './helpers/memory-updates.js';
import {createDatabaseTransactionQueue} from '../src/database/transaction-queue.js';
import {createDatabaseBatchWriter} from '../src/database/batch-writer.js';

const forum = {url: 'https://forum.test/rss', title: 'Forum', category: 'Forum'};
const news = {url: 'https://news.test/rss', title: 'News', category: 'News'};
function article(feed, title) {
    return {feedUrl: feed.url, feedTitle: feed.title, feedCategory: feed.category,
        link: feed.url + '/story', title, image: 'https://image.test/' + title + '.jpg',
        content: title, pubDate: '2026-11-12T00:00:00Z'};
}
function fixture() {
    const values = {feeds: [forum, news], articles: [], savedStates: [forum.url + '/story'], readStates: []};
    let fail = false;
    const db = addMemoryUpdates({putMany: async changes => {
        if (fail) {fail = false; throw Error('write failed');}
        for (const [key, raw] of Object.entries(changes)) values[key] = JSON.parse(raw);
    }}, values);
    return {db, values, failNext: () => {fail = true;}};
}

test('late background publication retains newer manual source fields and publishes unrelated feeds', async () => {
    const {db, values} = fixture();
    const background = beginFeedPublication(db), manual = beginFeedPublication(db);
    await publishFeedResults(db, [article(forum, 'new')], [forum], false, manual);
    await publishFeedResults(db, [article(forum, 'old'), article(news, 'other')],
        [{...forum, title: 'Older inferred title'}, news], false, background);
    const result = values.articles.find(value => value.feedUrl === forum.url);
    assert.equal(result.title, 'new');
    assert.equal(result.content, 'new');
    assert.equal(result.image, 'https://image.test/new.jpg');
    assert.equal(values.feeds[0].title, 'Forum');
    assert.equal(values.articles.find(value => value.feedUrl === news.url).title, 'other');
    assert.deepEqual(values.savedStates, [forum.url + '/story']);
});

test('failed newer publication does not suppress older successful data', async () => {
    const {db, values, failNext} = fixture();
    const background = beginFeedPublication(db), manual = beginFeedPublication(db);
    failNext();
    await assert.rejects(publishFeedResults(db, [article(forum, 'new')], [forum], false, manual), /write failed/);
    await publishFeedResults(db, [article(forum, 'old')], [forum], false, background);
    assert.equal(values.articles[0].title, 'old');
});

test('a scoped publication does not claim every configured feed', async () => {
    const {db, values} = fixture();
    const background = beginFeedPublication(db), manual = beginFeedPublication(db);
    await publishFeedResults(db, [article(forum, 'new')], [forum, news], false, manual);
    await publishFeedResults(db, [article(news, 'older-news')], [forum, news], false, background);
    assert.equal(values.articles.find(value => value.feedUrl === news.url).title, 'older-news');
});

test('queued database publication cannot run before the newer committed watermark advances', async () => {
    const state = {value: {feeds: JSON.stringify([forum, news]), articles: '[]'}};
    const queue = createDatabaseTransactionQueue();
    const db = createDatabaseBatchWriter({state, withDbLock: queue.run,
        _jsonParsedCache: {invalidate() {}},
        _parseStoredArray: (snapshot, key) => snapshot[key] ? JSON.parse(snapshot[key]) : [],
        _backupFeeds: async () => {}, _persistToDisk: async () => {}});
    const background = beginFeedPublication(db), manual = beginFeedPublication(db);
    await Promise.all([
        publishFeedResults(db, [article(forum, 'new')], [forum], false, manual),
        publishFeedResults(db, [article(forum, 'old'), article(news, 'other')], [forum, news], false, background)
    ]);
    const articles = JSON.parse(state.value.articles);
    assert.equal(articles.find(value => value.feedUrl === forum.url).title, 'new');
    assert.equal(articles.find(value => value.feedUrl === news.url).title, 'other');
});
