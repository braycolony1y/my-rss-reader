import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { fileHash } from '../../../src/database/sqlite/files.js';
import { openSqlite } from '../../../src/database/sqlite/connection.js';
import { createRepository } from '../../../src/database/sqlite/repository.js';

const [root, output] = process.argv.slice(2);
if (!root || !output) throw Error('Usage: sqlite-live.mjs ROOT OUTPUT');
const base = process.env.READER_URL || 'http://127.0.0.1:3000';
const get = async route => {
    const start = performance.now();
    const response = await fetch(base + route, { headers: { Cookie: 'auth=true' }, signal: AbortSignal.timeout(90000) });
    assert.equal(response.status, 200, route);
    return { data: await response.json(), ms: performance.now() - start };
};
const before = JSON.parse(await fs.readFile('/tmp/rss-sqlite-audit/live-before-user-states.json', 'utf8'));
const current = (await get('/api/user-states')).data;
const restored = JSON.parse(await fs.readFile('/tmp/rss-sqlite-audit/live-restore-verification.json', 'utf8'));
const db = openSqlite(restored.restoredRoot + '/database_state/reader.sqlite', { readOnly: true });
const repository = createRepository(db), state = {};
try {
    // The restored backup is the exact cutover state. A user may have advanced
    // a read cursor between the earlier API capture and stopping the writer.
    for (const key of Object.keys(before).filter(key => key !== 'clusteringModel')) {
        const value = repository.read(key);
        const expected = value == null ? (Array.isArray(before[key]) ? [] : {}) : typeof value === 'string' ? JSON.parse(value) : value;
        assert.ok(isDeepStrictEqual(current[key], expected), key + ' differs from the verified cutover backup');
        state[key] = { identicalAtCutover: true, count: Object.keys(current[key] || {}).length, changedSinceEarlierCapture: !isDeepStrictEqual(before[key], expected) };
    }
    assert.equal(current.clusteringModel, before.clusteringModel);
} finally { db.close(); }
const routes = [];
for (const [label, query] of [['today','filterType=today&hideRead=false'], ['saved','filterType=saved'], ['recent','filterType=recent'], ['board','filterType=board'], ['classic','filterType=smart&filterValue=tech_vietnam&smartMode=classic'], ['top','filterType=smart&filterValue=tech_vietnam&smartMode=top']]) {
    const result = await get('/api/data?' + query + '&limit=30');
    assert.ok(Array.isArray(result.data.articles), label);
    routes.push({ label, ms: result.ms, articles: result.data.articles.length });
}
const board = await get('/api/board-cache');
const marker = JSON.parse(await fs.readFile(root + '/database_state/sqlite-cutover.json', 'utf8'));
const migration = JSON.parse(await fs.readFile(root + '/database_state/sqlite-migrations/' + marker.id + '/validation.json', 'utf8'));
for (const source of migration.sources) assert.equal(await fileHash(root + '/' + source.path), source.sha256, source.path);
for (const cache of migration.cacheFiles) assert.equal(await fileHash(root + '/' + cache.path), cache.originalDigest, cache.path);
const report = { at: Date.now(), statePreserved: true, state, routes, boardCacheStatus: 'ok', originalFilesVerified: migration.sources.length + migration.cacheFiles.length, health: (await get('/health')).data, resources: (await get('/api/resources')).data };
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
