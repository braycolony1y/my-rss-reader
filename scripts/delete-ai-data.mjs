#!/usr/bin/env node
// Delete the AI-only data that scripts/archive-ai-data.mjs archived. Run it only after a stable week.
//
// Usage (service stopped):
//   sudo systemctl stop rss-reader
//   nice -n 19 node scripts/delete-ai-data.mjs --dry-run          # report only
//   nice -n 19 node scripts/delete-ai-data.mjs [--archive <dir>]  # delete
//   sudo systemctl start rss-reader
//
// Gates (all must pass, otherwise nothing is touched):
//   1. a manifest exists whose key list matches this script's list and whose gzip files match their sha256;
//   2. the manifest is at least 7 days old (override only with --force-young-archive);
//   3. the rss-reader service is not active (assertOffline: `systemctl show rss-reader`, plus a live
//      writer-lock check) and this script then takes database.writer.lock itself, so the service cannot
//      start mid-delete. The app's lock is a plain exclusive-create file, safe to hold from a script.
// Then: DELETE the collections (children cascade), drop the userPreferences entries, wal_checkpoint(TRUNCATE).
// No VACUUM (heavy IO on this VPS; the freed pages are reused by SQLite).
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openSqlite, assertIntegrity } from '../src/database/sqlite/connection.js';
import { createRepository } from '../src/database/sqlite/repository.js';
import { assertOffline } from '../src/database/sqlite/offline.js';
import { AI_COLLECTIONS, AI_PREFERENCES, ARCHIVE_ROOT, ARCHIVE_PREFIX, MIN_ARCHIVE_AGE_DAYS, parseArgs } from './ai-data-keys.mjs';

const { flags, values } = parseArgs(process.argv.slice(2));
const root = path.resolve(values.get('root') || fileURLToPath(new URL('..', import.meta.url)));
const dryRun = flags.has('dry-run'), forceYoung = flags.has('force-young-archive');
const databaseFile = path.join(root, 'database_state/reader.sqlite');
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const refuse = message => { console.error(`REFUSED: ${message}`); process.exit(2); };
const problems = [];
const gate = (ok, message) => { if (!ok) problems.push(message); };

// ---- Gate 1: archive and manifest ----
let archive = values.get('archive') && path.resolve(values.get('archive'));
if (!archive) {
    const base = path.join(root, ARCHIVE_ROOT);
    const names = fs.existsSync(base) ? fs.readdirSync(base).filter(n => n.startsWith(ARCHIVE_PREFIX) && !n.endsWith('.partial') && fs.existsSync(path.join(base, n, 'manifest.json'))).sort() : [];
    if (!names.length) refuse(`no ${ARCHIVE_ROOT}/${ARCHIVE_PREFIX}* archive with a manifest exists; run scripts/archive-ai-data.mjs first`);
    archive = path.join(base, names.at(-1));
}
let manifest;
try { manifest = JSON.parse(fs.readFileSync(path.join(archive, 'manifest.json'), 'utf8')); }
catch (error) { refuse(`cannot read manifest in ${archive}: ${error.message}`); }
gate(manifest.format === 'ai-removed-archive-v1', 'manifest format is not ai-removed-archive-v1');
const wanted = [...AI_COLLECTIONS, ...AI_PREFERENCES.map(name => `userPreferences.${name}`)].sort();
const listed = (manifest.entries || []).map(entry => entry.key).sort();
gate(JSON.stringify(wanted) === JSON.stringify(listed), `manifest keys do not match this script's key list (manifest: ${listed.join(',')})`);
for (const entry of manifest.entries || []) {
    if (entry.absent) continue;
    try {
        const gz = fs.readFileSync(path.join(archive, entry.file));
        gate(sha256(gz) === entry.sha256, `${entry.file}: sha256 mismatch`);
        gate(sha256(gunzipSync(gz)) === entry.sha256Uncompressed, `${entry.file}: uncompressed sha256 mismatch`);
    } catch (error) { gate(false, `${entry.file}: ${error.message}`); }
}

// ---- Gate 2: age ----
const created = Date.parse(manifest.createdAt), ageDays = (Date.now() - created) / 86400000;
if (!Number.isFinite(created)) gate(false, 'manifest has no valid createdAt');
else if (ageDays < MIN_ARCHIVE_AGE_DAYS) {
    if (forceYoung) console.warn(`WARNING: archive is only ${ageDays.toFixed(1)} days old; continuing because of --force-young-archive`);
    else gate(false, `archive is ${ageDays.toFixed(1)} days old; deletion is allowed from ${manifest.deleteAllowedAfter} (or pass --force-young-archive)`);
}

// ---- Gate 3: service stopped ----
try { await assertOffline(root); } catch (error) { gate(false, error.message); }

if (problems.length) {
    if (!dryRun) refuse(problems.join('\n         '));
    console.log('DRY RUN: a real run would be REFUSED:\n  - ' + problems.join('\n  - '));
}

// ---- Plan / execute ----
const lockFile = path.join(root, 'database.writer.lock');
let lockHandle = null;
if (!dryRun) {
    try { lockHandle = fs.openSync(lockFile, 'wx', 0o600); fs.writeSync(lockHandle, JSON.stringify({ pid: process.pid, startedAt: Date.now(), purpose: 'delete-ai-data' })); }
    catch (error) { refuse(`cannot take ${lockFile}: ${error.message}`); }
}
const releaseLock = () => { if (lockHandle !== null) { try { fs.closeSync(lockHandle); fs.unlinkSync(lockFile); } catch { } lockHandle = null; } };
let db;
try {
    db = openSqlite(databaseFile, { readOnly: dryRun });
    const repository = createRepository(db);
    const plan = [];
    for (const key of AI_COLLECTIONS) {
        const names = [key, ...repository.keys({ internal: true }).filter(name => name.startsWith(`$${key}.`))];
        const rows = names.reduce((sum, name) => sum + (repository.info(name)?.item_count || 0), 0);
        plan.push({ key, names: names.filter(name => repository.info(name)), rows, present: Boolean(repository.info(key)) || names.length > 1 });
    }
    const present = db.prepare("SELECT row_key FROM preferences WHERE collection='userPreferences'").all().map(row => row.row_key).filter(name => AI_PREFERENCES.includes(name));
    console.log(`${dryRun ? 'DRY RUN, nothing will change' : 'Deleting'}; archive ${archive} (${ageDays.toFixed(1)} days old)`);
    for (const item of plan) console.log(`  ${item.present ? 'delete' : 'absent'} ${item.key.padEnd(32)} ${item.rows} rows${item.names.length > 1 ? ` (+${item.names.length - 1} child collection)` : ''}`);
    for (const name of AI_PREFERENCES) console.log(`  ${present.includes(name) ? 'delete' : 'absent'} userPreferences.${name}`);
    if (!dryRun) {
        db.exec('BEGIN IMMEDIATE');
        try {
            const remove = db.prepare('DELETE FROM collections WHERE name=?');
            for (const item of plan) for (const name of item.names) remove.run(name); // foreign keys cascade to row tables
            if (present.length) repository.patchMap('userPreferences', {}, present); // keeps count and digest consistent
            assertIntegrity(db);
            db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        assertIntegrity(db);
        console.log('Done. WAL checkpointed (TRUNCATE); no VACUUM was run.');
    }
} finally { try { db?.close(); } catch { } releaseLock(); }
