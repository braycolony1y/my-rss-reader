import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeStoredValue } from '../src/database/stored-value.js';
import { rankingInputs, serializedRankingInput } from '../src/articles/ranking-input.js';
import { createDatabaseAccess } from '../src/database/access.js';
import { createParsedCache } from '../src/database/parsed-cache.js';

test('full fingerprint distinguishes equal lengths and suffixes, ordering and input boundaries', () => {
    const suffix = 'x'.repeat(300000);
    const a = JSON.stringify([{ title: 'one', content: suffix }]);
    const b = JSON.stringify([{ title: 'two', content: suffix }]);
    assert.equal(a.length, b.length);
    assert.equal(a.slice(-1000), b.slice(-1000));
    const first = rankingInputs(encodeStoredValue(a), '[]');
    assert.notEqual(first.digest, rankingInputs(encodeStoredValue(b), '[]').digest);
    assert.equal(first.digest, rankingInputs(a, '[]').digest);
    assert.notEqual(rankingInputs('[1,2]', '[]').digest, rankingInputs('[2,1]', '[]').digest);
    assert.notEqual(rankingInputs('[]', '[1]').digest, rankingInputs('[1]', '[]').digest);
    assert.equal(first.read().publicationJson, a);
});

test('digest comparison never decodes inputs; materialization reads each captured generation once', () => {
    let reads = 0;
    const make = value => ({ digest: serializedRankingInput(value).digest, read: () => { reads++; return value; } });
    const inputs = rankingInputs(make('[1]'), make('[2]'));
    assert.equal(reads, 0);
    assert.deepEqual(inputs.read(), {publicationJson: '[1]', rawJson: '[2]'});
    assert.equal(reads, 2);
});

test('pending readers survive replacement, parsed-cache release, and failed persistence', async () => {
    const a = JSON.stringify([{content: 'a'.repeat(300000)}]);
    const b = JSON.stringify([{content: 'b'.repeat(300000)}]);
    const state = {value: {input: encodeStoredValue(a)}};
    const cache = createParsedCache();
    let fail = false;
    const db = createDatabaseAccess({ state, withDbLock: fn => fn(), _jsonParsedCache: cache,
        STATE_KEYS: new Set(), _persistToDisk: async () => {if (fail) throw Error('disk');} });
    const previous = await db.get('input', {fingerprint: true});
    await db.put('input', b);
    cache.clear();
    const next = await db.get('input', {fingerprint: true});
    assert.notEqual(previous.digest, next.digest);
    assert.equal(previous.read(), a);
    assert.equal(next.read(), b);
    fail = true;
    await assert.rejects(db.put('input', a), /disk/);
    assert.equal((await db.get('input', {fingerprint: true})).digest, next.digest);
    assert.equal(await db.get('input'), b);
});
