import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {writeJsonSnapshot} from '../src/database/json-writer.js';

test('large database strings round-trip across escape and surrogate boundaries while allowing other work', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rss-json-writer-'));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const filename = path.join(directory, 'snapshot.json');
    const value = {
        articles: ('x'.repeat(65535) + '😀\\\n\t"\u0000\ud800').repeat(35),
        feeds: '[]', metadata: {revision: 2, values: [true, null, 'Tiếng Việt']}, ignored: undefined
    };
    let complete = false, ticks = 0;
    const pending = writeJsonSnapshot(filename, value).then(() => {complete = true;});
    // Immediate callbacks must run while the snapshot is still being written.
    const tick = () => { if (!complete) {ticks++; setImmediate(tick);} };
    setImmediate(tick);
    await pending;
    assert.ok(ticks > 1);
    assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), JSON.parse(JSON.stringify(value)));
});

test('atomic caller can discard invalid input without replacing a valid snapshot', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rss-json-invalid-'));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const filename = path.join(directory, 'snapshot.json');
    await fs.writeFile(filename, '{"valid":true}');
    const temporary = filename + '.tmp';
    await assert.rejects(writeJsonSnapshot(temporary, '{broken'), SyntaxError);
    assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), {valid: true});
    await writeJsonSnapshot(temporary, '[1,2,3]');
    await fs.rename(temporary, filename);
    assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), [1, 2, 3]);
});
