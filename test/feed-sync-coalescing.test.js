import test from 'node:test';
import assert from 'node:assert/strict';
import {coalesceFeedSync} from '../src/feeds/coalescing.js';
import {shouldSkipFeedFetch} from '../src/feeds/fetch-scope.js';

test('overlapping RSS requests have one active run, merge scopes, and fan out pending progress', async () => {
    const gates = [], calls = [], progress = [];
    const sync = coalesceFeedSync(async (env, feed, onProgress, category, options) => {
        calls.push({feed, category, options});
        await new Promise(resolve => gates.push(resolve));
        onProgress({stage: 'done'});
        return calls.length;
    }, () => {});
    const env = {RSS_DATA: {}};
    const active = sync(env, 'a');
    const pendingA = sync(env, 'a', () => progress.push('a'));
    const pendingB = sync(env, 'b', () => progress.push('b'));
    assert.equal(calls.length, 1); assert.strictEqual(pendingA, pendingB);
    gates.shift()(); await active;
    assert.equal(calls.length, 2);
    assert.equal(calls[1].feed, null); assert.equal(calls[1].category, null);
    const now = Date.now(), previous = global.lastFetchTimeByUrl;
    global.lastFetchTimeByUrl = {a: now, b: now};
    try {
        for (const url of ['a', 'b']) {
            const feed = {url, category: 'Macroeconomics'};
            assert.equal(shouldSkipFeedFetch(feed, null, new Set(), now), true);
            assert.equal(shouldSkipFeedFetch(feed, calls[1].feed, calls[1].options.forcedFeedUrls, now), false);
        }
    } finally { global.lastFetchTimeByUrl = previous; }
    gates.shift()(); await pendingA;
    assert.deepEqual(progress, ['a', 'b']);
});

test('a failed RSS run settles callers and allows the pending run and later requests', async () => {
    let fail, calls = 0;
    const sync = coalesceFeedSync(async () => {
        if (++calls === 1) await new Promise((resolve, reject) => {fail = reject;});
        return {success: true};
    }, () => {});
    const env = {RSS_DATA: {}};
    const first = sync(env); const rejection = assert.rejects(first, /failed/);
    const pending = sync(env, null, null, 'News');
    fail(Error('failed')); await rejection;
    assert.deepEqual(await pending, {success: true});
    assert.deepEqual(await sync(env), {success: true});
    assert.equal(calls, 3);
});
