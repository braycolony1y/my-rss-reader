import test from 'node:test';
import assert from 'node:assert/strict';
import {createCacheObservationBatch} from '../src/feeds/cache-observation-batch.js';
test('completed RSS sources share one observation commit and preserve source ordering and late fields', async () => {
    const calls = [], first = {link: 'a'}, second = {link: 'b'};
    const batch = createCacheObservationBatch(async articles => calls.push(articles));
    batch.add([first, second]); batch.add([]); batch.add([first]);
    first.image = 'resolved';
    assert.equal(calls.length, 0);
    await batch.flush(); await batch.flush();
    assert.deepEqual(calls, [[first, second, first]]);
    assert.equal(calls[0][0], first);
    batch.add([second]); await batch.flush(); assert.equal(calls.length, 2);
});
test('a failed observation reports failure without falsely committing or replaying stale candidates', async () => {
    const batch = createCacheObservationBatch(async () => {throw Error('Disk unavailable');});
    batch.add([{link: 'a'}]);
    await assert.rejects(batch.flush(), /Disk unavailable/);
    await batch.flush();
});
