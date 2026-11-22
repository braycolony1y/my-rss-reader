#!/usr/bin/env node
// Restore keys from an ai-removed archive into reader.sqlite. Service must be stopped.
//
// Usage: nice -n 19 node scripts/restore-ai-data.mjs --archive <dir> [--key topStoriesPublished]... [--overwrite] [--dry-run]
// Without --key every archived key is restored. Existing keys are never replaced unless --overwrite is given.
// Restoring only brings the data back; the removed code that used it is in git history before the Phase B/C commits.
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openSqlite, assertIntegrity } from '../src/database/sqlite/connection.js';
import { createRepository } from '../src/database/sqlite/repository.js';
import { assertOffline } from '../src/database/sqlite/offline.js';

const argv = process.argv.slice(2), only = new Set(), flags = new Set();
let archive, rootArg;
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--archive') archive = argv[++i];
    else if (argv[i] === '--root') rootArg = argv[++i];
    else if (argv[i] === '--key') only.add(argv[++i]);
    else if (argv[i].startsWith('--')) flags.add(argv[i].slice(2));
    else { console.error(`Unexpected argument: ${argv[i]}`); process.exit(2); }
}
if (!archive) { console.error('--archive <dir> is required'); process.exit(2); }
const root = path.resolve(rootArg || fileURLToPath(new URL('..', import.meta.url)));
const dryRun = flags.has('dry-run'), overwrite = flags.has('overwrite');
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(archive, 'manifest.json'), 'utf8'));
const selected = manifest.entries.filter(entry => !entry.absent && (!only.size || only.has(entry.key)));
if (!selected.length) { console.error('Nothing to restore'); process.exit(2); }
const documents = selected.map(entry => {
    const gz = fs.readFileSync(path.join(archive, entry.file));
    if (sha256(gz) !== entry.sha256) throw Error(`${entry.file}: sha256 mismatch, archive is damaged`);
    return { entry, document: JSON.parse(gunzipSync(gz).toString('utf8')) };
});
await assertOffline(root);
const lockFile = path.join(root, 'database.writer.lock');
let lock = null;
if (!dryRun) { try { lock = fs.openSync(lockFile, 'wx', 0o600); fs.writeSync(lock, JSON.stringify({ pid: process.pid, startedAt: Date.now(), purpose: 'restore-ai-data' })); } catch (error) { console.error(`Cannot take ${lockFile}: ${error.message}`); process.exit(2); } }
const db = openSqlite(path.join(root, 'database_state/reader.sqlite'), { readOnly: dryRun });
try {
    const repository = createRepository(db);
    if (!dryRun) db.exec('BEGIN IMMEDIATE');
    try {
        for (const { entry, document } of documents) {
            if (entry.kind === 'preference') {
                const prefs = repository.info('userPreferences');
                const exists = prefs && db.prepare("SELECT 1 FROM preferences WHERE collection='userPreferences' AND row_key=?").get(document.key);
                if (exists && !overwrite) { console.log(`skip ${entry.key}: exists (use --overwrite)`); continue; }
                console.log(`${dryRun ? 'would restore' : 'restore'} ${entry.key}`);
                if (!dryRun) repository.patchMap('userPreferences', { [document.key]: document.value });
                continue;
            }
            if (repository.info(entry.key) && !overwrite) { console.log(`skip ${entry.key}: exists (use --overwrite)`); continue; }
            console.log(`${dryRun ? 'would restore' : 'restore'} ${entry.key} (${entry.rows} rows)`);
            if (dryRun) continue;
            repository.write(entry.key, document.encoding === 'json' ? JSON.stringify(document.value) : document.value);
            for (const [name, value] of Object.entries(document.orphanChildren || {})) repository.write(name, value);
        }
        if (!dryRun) { assertIntegrity(db); db.exec('COMMIT'); }
    } catch (error) { if (!dryRun) db.exec('ROLLBACK'); throw error; }
} finally {
    db.close();
    if (lock !== null) { try { fs.closeSync(lock); fs.unlinkSync(lockFile); } catch { } }
}
