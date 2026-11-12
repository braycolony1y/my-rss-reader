import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {manualSyncOutcome} from '../src/feeds/manual-sync-outcome.js';

const source = readFileSync(new URL('../public/js/feeds/manual-refresh.js', import.meta.url), 'utf8');

test('partial feed failures produce a failed manual outcome while clean refreshes succeed', () => {
    assert.equal(manualSyncOutcome({success: true, logs: []}).failed, false);
    const partial = manualSyncOutcome({success: true, logs: [{Issue: 'Browser unavailable'}]});
    assert.equal(partial.failed, true);
    assert.match(partial.message, /could not refresh/);
    assert.equal(manualSyncOutcome({success: true, smart: {ok: false}}).failed, true);
});

test('HTTP 200 source failures remain failed after a delayed progress poll arrives', async () => {
    let poll, resolvePost, resolvePoll;
    const post = new Promise(resolve => {resolvePost = resolve;});
    const delayedPoll = new Promise(resolve => {resolvePoll = resolve;});
    const context = {Date, Math, console, setTimeout() {}, clearInterval() {},
        setInterval(callback) {poll = callback; return 1;},
        fetch: url => url.startsWith('/api/sync-progress') ? delayedPoll : post};
    const refresh = vm.runInNewContext(source + '\nReaderManualRefresh;', context);
    let reloads = 0;
    const app = {selectedFilterType: 'category', selectedFilterValue: 'Forum',
        syncProgress: {}, fetchData: async () => {reloads++;}};
    const running = refresh.syncNow.call(app);
    const polling = poll();
    resolvePost({ok: true, json: async () => ({success: false,
        message: 'Some sources could not refresh. Existing articles were kept.'})});
    await running;
    assert.equal(app.isSyncing, false);
    assert.equal(app.syncProgress.failed, true);
    assert.equal(app.syncProgress.done, true);
    assert.equal(reloads, 1);
    resolvePoll({ok: true, json: async () => ({done: false, failed: false, message: 'Preparing Forum refresh…'})});
    await polling;
    assert.equal(app.syncProgress.failed, true);
    assert.equal(app.syncProgress.done, true);
    assert.match(app.syncProgress.message, /could not refresh/);
});
