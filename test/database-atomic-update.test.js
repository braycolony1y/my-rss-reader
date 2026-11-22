import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabaseBatchWriter} from '../src/database/batch-writer.js';
import {createDatabaseTransactionQueue} from '../src/database/transaction-queue.js';
import {decodeStoredValue} from '../src/database/stored-value.js';
import {publishFeedResults} from '../src/feeds/publish-results.js';

function database(values, persist = async () => {}) {
    const state = {value: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]))};
    const writer = createDatabaseBatchWriter({state, withDbLock: createDatabaseTransactionQueue().run,
        _loadDBFromDisk: async () => state.value, _jsonParsedCache: {invalidate() {}},
        _parseStoredArray: (snapshot, key) => JSON.parse(decodeStoredValue(snapshot[key]) || 'null'),
        _backupFeeds: async () => {}, _persistToDisk: persist});
    return {writer, read: key => JSON.parse(decodeStoredValue(state.value[key]) || 'null')};
}

test('atomic updaters see preceding commits and rollback on persistence failure', async () => {
    let fail = false;
    const {writer, read} = database({readStates: []}, async () => {if (fail) throw Error('disk failure');});
    await Promise.all(Array.from({length: 12}, (_, i) => writer.updateMany(['readStates'], current => ({
        readStates: JSON.stringify([...current.readStates, String(i)])
    }))));
    assert.equal(read('readStates').length, 12);
    fail = true;
    await assert.rejects(writer.updateMany(['readStates'], () => ({readStates: '[]'})), /disk failure/);
    assert.equal(read('readStates').length, 12);
    await assert.rejects(writer.updateMany(['readStates'], async () => ({})), /synchronous/);
    await assert.rejects(writer.updateMany(['readStates'], () => ({other: '[]'})), /undeclared/);
});

test('RSS publication preserves current feed edits, removals, additions and current user state in one commit', async () => {
    const a = {url: 'https://a.test/rss', title: 'User title', category: 'Finance', fetchMethods: ['direct']};
    const c = {url: 'https://c.test/rss', title: 'New source', category: 'News'};
    const article = (feedUrl, link) => ({feedUrl, link, title: link, pubDate: new Date().toISOString(), image: 'https://a.test/i.jpg'});
    let writes = 0;
    const {writer, read} = database({feeds: [a, c], articles: [article(c.url, 'current')],
        savedStates: ['current'], boardStates: [], readStates: ['current'], hiddenStates: ['current']}, async () => {writes++;});
    await publishFeedResults(writer, [{...article(a.url, 'fetched'), feedTitle: 'Old title'}, article('https://deleted.test/rss', 'obsolete')],
        [{...a, title: 'Old title', category: 'Old category'}, {url: 'https://deleted.test/rss'}], true);
    assert.equal(writes, 1);
    assert.deepEqual(read('feeds'), [a, c]);
    assert.deepEqual(new Set(read('articles').map(row => row.link)), new Set(['fetched','current']));
    assert.equal(read('articles').find(row => row.link === 'fetched').feedTitle, 'User title');
    assert.deepEqual(read('readStates'), ['current']); assert.deepEqual(read('hiddenStates'), ['current']);
    assert.ok(read('universalPrefetchTargets').some(row => row.url === 'fetched'));
    assert.ok(!read('universalPrefetchTargets').some(row => row.url === 'obsolete'));
});
