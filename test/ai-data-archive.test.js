import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { openSqlite } from '../src/database/sqlite/connection.js';
import { createRepository } from '../src/database/sqlite/repository.js';
import { createSqliteDatabaseStore } from '../src/database/sqlite/store.js';
import { AI_COLLECTIONS } from '../scripts/ai-data-keys.mjs';

const run = promisify(execFile);
const repo = fileURLToPath(new URL('..', import.meta.url));
const script = name => path.join(repo, 'scripts', name);
const node = (name, args) => run(process.execPath, [script(name), ...args], { cwd: repo }).then(r => ({ code: 0, ...r }), e => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));

async function fixture(t) {
    const root = await fs.mkdtemp('/tmp/ai-archive-test-');
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, 'database_state'));
    const db = openSqlite(path.join(root, 'database_state/reader.sqlite'));
    const r = createRepository(db);
    r.write('topStoriesState', JSON.stringify({ a: { rank: 1 }, b: { rank: 2 } }));
    r.write('topStoriesPublished', JSON.stringify({ createdAt: 5, articles: [{ link: 'https://a.test', clusterId: 'c1', relatedArticles: [{ link: 'https://b.test' }] }] }));
    r.write('storyBriefings', JSON.stringify({ s: { text: 'x' } }));
    r.write('smartEditorialAssessmentCache', JSON.stringify({ k: { createdAt: 1 } }));
    r.write('smartEventVerificationCache', JSON.stringify({ k: { createdAt: 1 } }));
    r.write('smartVerificationFailures', JSON.stringify({ k: { at: 1 } }));
    r.write('smartAiProviderHealth', JSON.stringify({ gemini: { status: 'ok' } }));
    r.write('smartPersonalFilters', JSON.stringify({ rules: [1, 2] }));
    r.write('smartProgressivePublication', 'null');
    r.write('smartProgressiveClusterState', JSON.stringify({ active: false }));
    // Keys the Stories path still uses must survive.
    r.write('smartAiConfig', 'cluster-signature');
    r.write('smartDeferredReviewGroups', JSON.stringify({ groups: [], relationships: [{ a: 1 }] }));
    r.write('smartTopPrefilterState', JSON.stringify({ filterVersion: 'v', records: [] }));
    r.write('lastSourceEvalTime', JSON.stringify('2026-11-22T00:00:00Z'));
    r.write('readStates', JSON.stringify(['https://a.test']));
    r.write('userPreferences', JSON.stringify({ smartTabModes: { all: 'top' }, clusteringModel: 'gemini', hideRead: true }));
    db.close();
    return root;
}
const readState = root => {
    const db = openSqlite(path.join(root, 'database_state/reader.sqlite'), { readOnly: true });
    try { const r = createRepository(db); return { names: r.keys({ internal: true }), prefs: JSON.parse(r.read('userPreferences')), info: r.info('userPreferences') }; } finally { db.close(); }
};

test('archive, gated delete and restore of the AI-only keys', async t => {
    const root = await fixture(t);
    const archived = await node('archive-ai-data.mjs', ['--root', root]);
    assert.equal(archived.code, 0, archived.stderr);
    const base = path.join(root, 'database_state/archive');
    const [dir] = await fs.readdir(base);
    const manifest = JSON.parse(await fs.readFile(path.join(base, dir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.format, 'ai-removed-archive-v1');
    assert.equal(manifest.entries.find(e => e.key === 'topStoriesPublished').rows, 3); // 2 envelope fields + 1 article
    assert.equal(manifest.entries.find(e => e.key === 'topStoriesState').rows, 2);
    for (const e of manifest.entries) assert.match(e.sha256 || '', /^[0-9a-f]{64}$/);
    assert.ok(!manifest.entries.some(e => /smartAiConfig|smartTopPrefilterState|smartDeferredReviewGroups|lastSourceEvalTime/.test(e.key)));
    const before = readState(root);

    // Gate: a young archive is refused and nothing changes.
    const young = await node('delete-ai-data.mjs', ['--root', root]);
    assert.equal(young.code, 2);
    assert.match(young.stderr, /days old/);
    assert.deepEqual(readState(root).names, before.names);

    // Dry run never changes anything, even with the age override.
    const dry = await node('delete-ai-data.mjs', ['--root', root, '--dry-run', '--force-young-archive']);
    assert.equal(dry.code, 0, dry.stderr);
    assert.deepEqual(readState(root).names, before.names);

    // A damaged archive is refused.
    const victim = path.join(base, dir, 'storyBriefings.json.gz');
    const good = await fs.readFile(victim);
    await fs.writeFile(victim, Buffer.concat([good, Buffer.from('x')]));
    const damaged = await node('delete-ai-data.mjs', ['--root', root, '--force-young-archive']);
    assert.equal(damaged.code, 2);
    assert.match(damaged.stderr, /sha256 mismatch/);
    await fs.writeFile(victim, good);

    // Aged archive: backdate createdAt in the manifest (as if 8 days passed) and delete.
    const manifestFile = path.join(base, dir, 'manifest.json');
    await fs.writeFile(manifestFile, JSON.stringify({ ...manifest, createdAt: new Date(Date.now() - 8 * 86400000).toISOString() }));
    const deleted = await node('delete-ai-data.mjs', ['--root', root]);
    assert.equal(deleted.code, 0, deleted.stderr);
    const after = readState(root);
    for (const key of AI_COLLECTIONS) assert.ok(!after.names.some(n => n === key || n.startsWith(`$${key}.`)), key);
    for (const key of ['smartAiConfig', 'smartDeferredReviewGroups', 'smartTopPrefilterState', 'lastSourceEvalTime', 'readStates', 'userPreferences'])
        assert.ok(after.names.includes(key), key);
    assert.deepEqual(after.prefs, { hideRead: true });
    assert.equal(after.info.item_count, 1);
    await assert.rejects(fs.stat(path.join(root, 'database.writer.lock')), { code: 'ENOENT' }, 'delete releases the writer lock');

    // Restore brings everything back.
    const restored = await node('restore-ai-data.mjs', ['--root', root, '--archive', path.join(base, dir)]);
    assert.equal(restored.code, 0, restored.stderr);
    const back = readState(root);
    assert.deepEqual(back.prefs, before.prefs);
    for (const key of AI_COLLECTIONS) assert.ok(back.names.includes(key), key);
    assert.ok(back.names.includes('$topStoriesPublished.articles'));
    const db = openSqlite(path.join(root, 'database_state/reader.sqlite'), { readOnly: true });
    try {
        const r = createRepository(db);
        assert.deepEqual(JSON.parse(r.read('topStoriesPublished')).articles[0].relatedArticles, [{ link: 'https://b.test' }]);
        assert.deepEqual(JSON.parse(r.read('topStoriesState')), { a: { rank: 1 }, b: { rank: 2 } });
    } finally { db.close(); }
});

test('the delete refuses while another process holds the writer lock', async t => {
    const root = await fixture(t);
    assert.equal((await node('archive-ai-data.mjs', ['--root', root])).code, 0);
    await fs.writeFile(path.join(root, 'database.writer.lock'), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    const result = await node('delete-ai-data.mjs', ['--root', root, '--force-young-archive']);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Database writer is still running/);
    assert.ok(readState(root).names.includes('storyBriefings'));
});

test('the SQLite store tolerates retired AI keys left in the database, and leaves them alone', async t => {
    const root = await fs.mkdtemp('/tmp/ai-tolerate-test-');
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const old = { createdAt: Date.now() - 90 * 86400000 };
    await fs.writeFile(path.join(root, 'database.json'), JSON.stringify({
        feeds: '[]', articles: '[]', readStates: '["https://a.test"]',
        storyBriefings: '{"s":{"text":"x"}}', smartEventVerificationCache: JSON.stringify({ old }),
        topStoriesState: '{"a":{"rank":1}}', smartPersonalFilters: '{"rules":[1]}',
    }));
    const owner = createSqliteDatabaseStore({ root }), db = owner.env.RSS_DATA;
    t.after(() => owner.close());
    assert.deepEqual(await db.get('storyBriefings', { type: 'json' }), { s: { text: 'x' } });
    await db.put('readStates', JSON.stringify(['https://a.test', 'https://c.test']));
    assert.deepEqual(await db.get('readStates', { type: 'json' }), ['https://a.test', 'https://c.test']);
    assert.equal((await db.maintenance()).integrity, 'ok');
    // Retired caches are no longer retention-managed, so maintenance never prunes their (archived) rows.
    assert.deepEqual(await db.get('smartEventVerificationCache', { type: 'json' }), { old });
    assert.deepEqual(await db.get('topStoriesState', { type: 'json' }), { a: { rank: 1 } });
});
