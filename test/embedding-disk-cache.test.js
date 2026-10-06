import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { embeddingEntries, loadEmbeddingSubset, mergeEmbeddingCache } from '../src/smart/embeddings/disk-cache.js';

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rss-vector-cache-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return path.join(directory, 'vectors.json');
}
test('loads only required vectors across chunk boundaries and preserves historical entries on merge', async t => {
    const file = await fixture(t);
    const original = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`key-${i}`, 'A'.repeat(16387) + i]));
    original['escaped"key'] = 'escaped\\value\n';
    await fs.writeFile(file, JSON.stringify(original));
    const selected = {};
    assert.deepEqual(await loadEmbeddingSubset(file, new Set(['key-1', 'key-79']), values => Object.assign(selected, values)), { entries: 81, matched: 2 });
    assert.deepEqual(selected, { 'key-1': original['key-1'], 'key-79': original['key-79'] });
    assert.equal(await mergeEmbeddingCache(file, { 'key-1': 'replacement', added: 'new' }), 82);
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { ...original, 'key-1': 'replacement', added: 'new' });
});
test('invalid or interrupted input never replaces the durable cache', async t => {
    const file = await fixture(t);
    for (const invalid of ['{"good":"vector",', '{"good":"vector",}', '{"good":"vector"}oops']) {
        await fs.writeFile(file, invalid);
        await assert.rejects(mergeEmbeddingCache(file, { added: 'new' }), SyntaxError);
        assert.equal(await fs.readFile(file, 'utf8'), invalid);
        assert.deepEqual(await fs.readdir(path.dirname(file)), ['vectors.json']);
    }
});
test('supports an empty/missing cache and rejects oversized malformed entries', async t => {
    const file = await fixture(t);
    assert.equal(await mergeEmbeddingCache(file, { initial: 'vector' }), 1);
    await fs.writeFile(file, '{}');
    const entries = []; for await (const value of embeddingEntries(file)) entries.push(value);
    assert.deepEqual(entries, []);
    await fs.writeFile(file, '{"bad":"' + 'x'.repeat(300000));
    await assert.rejects(async () => { for await (const _ of embeddingEntries(file)) {} }, /oversized/);
});
