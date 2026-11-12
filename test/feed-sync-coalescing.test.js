import test from 'node:test';
import assert from 'node:assert/strict';
import {coalesceFeedSync} from '../src/feeds/coalescing.js';
import {shouldSkipFeedFetch} from '../src/feeds/fetch-scope.js';
import {manualRefreshOptions} from '../src/articles/manual-refresh-scopes.js';

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
    const pendingA = sync(env, 'a', value => progress.push(['a', value.stage]));
    const pendingB = sync(env, 'b', value => progress.push(['b', value.stage]));
    assert.equal(calls.length, 1); assert.strictEqual(pendingA, pendingB);
    assert.deepEqual(progress, [['a', 'queued'], ['b', 'queued']]);
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
    assert.deepEqual(progress.slice(2), [['a', 'done'], ['b', 'done']]);
});

test('manual Forum refresh completes independently of background and another manual scope', async () => {
    const gates = new Map(), calls = [], progress = [];
    const sync = coalesceFeedSync(async (env, feed, notify, category, options) => {
        calls.push({feed, category, scopes: options.manualRefreshScopes});
        if (category !== 'Forum') await new Promise(resolve => gates.set(category, resolve));
        notify({stage: 'feeds', message: category || 'all'});
        return category || 'all';
    }, () => {});
    const env = {RSS_DATA: {}};
    const background = sync(env);
    const slowManual = sync(env, null, null, 'News', manualRefreshOptions(null, 'News'));
    const forum = sync(env, null, value => progress.push(value), 'Forum', manualRefreshOptions(null, 'Forum'));
    assert.equal(await forum, 'Forum');
    assert.deepEqual(calls.map(call => call.category), [null, 'News', 'Forum']);
    assert.deepEqual(calls[2].scopes, [{feedUrl: null, category: 'Forum'}]);
    assert.equal(progress.at(-1).stage, 'feeds');
    gates.get(null)(); gates.get('News')();
    await Promise.all([background, slowManual]);
});

test('repeated requests for the same manual scope keep one pending batch and every listener', async () => {
    const gates = [], progress = [], calls = [];
    const sync = coalesceFeedSync(async (env, feed, notify, category) => {
        calls.push(category);
        await new Promise(resolve => gates.push(resolve));
        notify({stage: 'feeds'});
    }, () => {});
    const env = {RSS_DATA: {}}, options = manualRefreshOptions(null, 'Forum');
    const active = sync(env, null, null, 'Forum', options);
    const first = sync(env, null, value => progress.push(['first', value.stage]), 'Forum', options);
    const second = sync(env, null, value => progress.push(['second', value.stage]), 'Forum', options);
    assert.strictEqual(first, second);
    assert.deepEqual(calls, ['Forum']);
    assert.deepEqual(progress, [['first', 'queued'], ['second', 'queued']]);
    gates.shift()(); await active;
    assert.deepEqual(calls, ['Forum', 'Forum']);
    gates.shift()(); await Promise.all([first, second]);
    assert.deepEqual(progress.slice(2), [['first', 'feeds'], ['second', 'feeds']]);
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
