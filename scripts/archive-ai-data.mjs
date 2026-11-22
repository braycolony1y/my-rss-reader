#!/usr/bin/env node
// Archive the data of the removed AI Smart/Top pipeline as gzip JSON. Read-only on the database.
//
// Usage: nice -n 19 node scripts/archive-ai-data.mjs [--root <dir>] [--dry-run]
// Writes database_state/archive/ai-removed-<timestamp>/{manifest.json,<key>.json.gz,legacy/...}.
// database_state/ is gitignored; never commit an archive. Deletion is a separate, later step
// (scripts/delete-ai-data.mjs, allowed 7 days after the manifest's createdAt).
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openSqlite } from '../src/database/sqlite/connection.js';
import { createRepository } from '../src/database/sqlite/repository.js';
import { AI_COLLECTIONS, AI_PREFERENCES, ARCHIVE_ROOT, ARCHIVE_PREFIX, MIN_ARCHIVE_AGE_DAYS, legacyAiPartFiles, parseArgs } from './ai-data-keys.mjs';

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const { flags, values } = parseArgs(process.argv.slice(2));
const root = path.resolve(values.get('root') || fileURLToPath(new URL('..', import.meta.url)));
const dryRun = flags.has('dry-run');
const createdAt = new Date();
const stamp = createdAt.toISOString().replace(/[:.]/g, '-');
const final = path.join(root, ARCHIVE_ROOT, ARCHIVE_PREFIX + stamp);
const staging = final + '.partial';

const db = openSqlite(path.join(root, 'database_state/reader.sqlite'), { readOnly: true });
const repository = createRepository(db);
const entries = [];
if (!dryRun) fs.mkdirSync(staging, { recursive: true, mode: 0o700 });

function emit(name, key, kind, rows, document) {
    const json = Buffer.from(JSON.stringify(document));
    const gz = gzipSync(json, { level: 6 });
    if (!dryRun) fs.writeFileSync(path.join(staging, name), gz, { mode: 0o600 });
    entries.push({ key, kind, file: name, rows, bytes: json.length, gzipBytes: gz.length, sha256: sha256(gz), sha256Uncompressed: sha256(json) });
}

try {
    for (const key of AI_COLLECTIONS) {
        const info = repository.info(key);
        if (!info) { entries.push({ key, kind: 'collection', file: null, rows: 0, bytes: 0, absent: true }); continue; }
        const value = repository.read(key);
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        // Child collections (e.g. $topStoriesPublished.articles) are embedded in the parent value.
        const children = repository.keys({ internal: true }).filter(name => name.startsWith(`$${key}.`));
        const childRows = children.reduce((sum, name) => sum + repository.info(name).item_count, 0);
        const rows = (info.shape === 'scalar' ? 1 : info.item_count) + childRows;
        // A scalar parent (retired 'null' marker) can leave its child collection orphaned; keep that data too.
        const orphans = info.shape === 'scalar' ? Object.fromEntries(children.map(name => [name, repository.read(name)])) : undefined;
        emit(`${key}.json.gz`, key, 'collection', rows,
            { key, encoding: info.encoding, shape: info.shape, itemCount: info.item_count, digest: info.digest, childCollections: children, value: parsed, orphanChildren: orphans });
    }
    for (const name of AI_PREFERENCES) {
        const row = db.prepare("SELECT value FROM preferences WHERE collection='userPreferences' AND row_key=?").get(name);
        if (!row) { entries.push({ key: `userPreferences.${name}`, kind: 'preference', file: null, rows: 0, bytes: 0, absent: true }); continue; }
        emit(`userPreferences.${name}.json.gz`, `userPreferences.${name}`, 'preference', 1, { key: name, collection: 'userPreferences', value: JSON.parse(row.value) });
    }
} finally { db.close(); }

// Legacy pre-cutover files. Only the keyed-overlay part files that hold AI-only keys are archived;
// smart-data.json*, database.json and the embeddings caches also feed Classic/clustering and are listed only.
const legacy = [];
for (const { key, file } of legacyAiPartFiles(root)) {
    const buffer = fs.readFileSync(path.join(root, file)), gz = gzipSync(buffer, { level: 6 });
    const name = path.join('legacy', file.replaceAll('/', '__') + '.gz');
    if (!dryRun) { fs.mkdirSync(path.join(staging, 'legacy'), { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(staging, name), gz, { mode: 0o600 }); }
    legacy.push({ key, source: file, file: name, bytes: buffer.length, gzipBytes: gz.length, sha256: sha256(gz), sha256Uncompressed: sha256(buffer) });
}
const directoryBytes = directory => fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .reduce((sum, entry) => sum + (entry.isFile() ? fs.statSync(path.join(entry.parentPath, entry.name)).size : 0), 0);
const listed = [];
for (const name of ['smart-state.json', 'smart-data.json', 'database_state/smart-state.json', 'database_state/database-state.json', 'smart-embeddings-worker.json', 'database_state/embeddings']) {
    const full = path.join(root, name);
    let stat; try { stat = fs.statSync(full); } catch { continue; }
    const note = /embeddings/.test(name) ? 'KEEP: clustering and ranker vectors'
        : name === 'smart-data.json' ? 'NOT archived: mixed with Classic corpus keys'
        : name.startsWith('database_state/') ? 'stale pre-cutover overlay; AI-only part files archived above'
        : 'stale pre-cutover file';
    listed.push({ path: name, bytes: stat.isDirectory() ? directoryBytes(full) : stat.size, note });
}

const manifest = {
    format: 'ai-removed-archive-v1', createdAt: createdAt.toISOString(),
    deleteAllowedAfter: new Date(createdAt.getTime() + MIN_ARCHIVE_AGE_DAYS * 86400000).toISOString(),
    source: 'database_state/reader.sqlite (opened read-only)', entries, legacyFiles: legacy, legacyFilesListed: listed,
};
if (dryRun) console.log(JSON.stringify(manifest, null, 2));
else {
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    fs.renameSync(staging, final);
    console.log(`Archive written: ${final}`);
    for (const e of entries) console.log(`${e.key.padEnd(34)} rows=${String(e.rows).padStart(7)} bytes=${String(e.bytes).padStart(10)} gz=${e.gzipBytes ?? '-'}${e.absent ? ' (absent)' : ''}`);
    console.log(`legacy part files archived: ${legacy.length}`);
}
