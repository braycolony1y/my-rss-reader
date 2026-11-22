import test from 'node:test';
import assert from 'node:assert/strict';
import {publishBackgroundSources} from '../src/smart/background/publish-sources.js';
import {beginSmartRefresh, endSmartRefresh, getSmartRefreshGeneration} from '../src/smart/refresh/coordination.js';

test('a foreground refresh during destination resolution invalidates the background batch even after it finishes', async () => {
    let writes = 0, observed = 0;
    const db = {get: async () => null, put() {}, updateMany: async () => {writes++;}};
    const committed = await publishBackgroundSources({db, results: [], configuredSources: [],
        generation: getSmartRefreshGeneration(), helpers: {
            resolveSmartArticleDestinations() {beginSmartRefresh(); endSmartRefresh();},
            observeCacheArticles() {observed++;}
        }});
    assert.equal(committed, false); assert.equal(writes, 0); assert.equal(observed, 0);
});

test('a queued background publication checks ownership inside the database transaction', async () => {
    let changed;
    const db = {get: async () => null, put() {}, updateMany: async (keys, update) => {
        beginSmartRefresh();
        try {changed = update({smartRawArticles: []});} finally {endSmartRefresh();}
    }};
    const committed = await publishBackgroundSources({db, results: [], configuredSources: [],
        generation: getSmartRefreshGeneration(), helpers: {}});
    assert.equal(committed, false); assert.deepEqual(changed, {});
});
