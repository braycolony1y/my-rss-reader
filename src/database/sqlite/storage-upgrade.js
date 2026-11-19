import fs from 'node:fs/promises';
import path from 'node:path';
import { fileHash } from './files.js';
import { backupDatabase } from './maintenance.js';
import { pruneDerivedCaches } from './retention-maintenance.js';

export const STORAGE_UPGRADE = 'backend-storage-v2';
const RECOVERY_NAME = /^before-backend-storage-v2\.sqlite(?:-[0-9]+\.sqlite)?$/;
// A single verified, fsynced pre-change backup is recorded before any
// destructive change (derived-cache pruning, then VACUUM). Every retry reuses
// it; it is never rotated. Pruning is transactional; VACUUM is atomic. A crash
// between phases resumes from the durable phase record, without importing
// legacy files, replaying user actions or replacing an uncertain database.
// The schema is unchanged: rows keep the HEAD table layout, so redeploying
// HEAD code on an upgraded database works. (An early build of this upgrade
// rebuilt metadata_entries WITHOUT ROWID; such a database also keeps working.)
function readProgress(db) {
    const status = db.prepare('SELECT detail FROM maintenance_runs WHERE kind=?').get(STORAGE_UPGRADE);
    return status ? JSON.parse(status.detail) : {};
}
function saveProgress(db, progress) {
    db.prepare('INSERT INTO maintenance_runs VALUES(?,?,?) ON CONFLICT(kind) DO UPDATE SET completed_at=excluded.completed_at,detail=excluded.detail')
        .run(STORAGE_UPGRADE, Date.now(), JSON.stringify(progress));
}
async function verifiedBackup(filename) {
    try {
        const manifest = JSON.parse(await fs.readFile(filename + '.manifest.json', 'utf8'));
        return /^[a-f0-9]{64}$/.test(manifest.sha256 || '') && await fileHash(filename) === manifest.sha256;
    } catch { return false; }
}
// Recovery-backup files of an earlier interrupted attempt (killed between
// publishing the file and saving the progress record). Never the referenced one.
async function removeUnreferencedRecoveryFiles(root, referenced) {
    const directory = path.join(root, 'database_state');
    for (const name of await fs.readdir(directory).catch(() => [])) {
        const base = name.replace(/\.manifest\.json$/, '');
        if (!RECOVERY_NAME.test(base) || path.join(directory, base) === referenced) continue;
        await fs.rm(path.join(directory, name), { force: true });
    }
}
export async function prepareStorageUpgrade(db, root) {
    let progress = readProgress(db);
    if (progress.complete) return progress;
    if (progress.backup && !await verifiedBackup(progress.backup)) {
        // Do not fail every run forever: take a new verified backup of the
        // current state (the latest safe recovery point) and record it.
        console.error('[SQLITE UPGRADE] Recovery backup missing or corrupt; creating a new one:', progress.backup);
        progress.invalidBackups = [...(progress.invalidBackups || []), progress.backup];
        delete progress.backup;
    }
    if (!progress.backup) {
        await removeUnreferencedRecoveryFiles(root, null);
        // Dedicated destination outside rolling backups. Restore only if the
        // upgraded database itself is unusable (see report/README).
        const destination = path.join(root, 'database_state', 'before-backend-storage-v2.sqlite');
        const backup = await backupDatabase(db, root, { destination });
        progress = { ...progress, backup: backup.filename, startedAt: progress.startedAt || Date.now() };
        saveProgress(db, progress);
    }
    return progress;
}

// The client drains and holds main-connection writes around each phase;
// reads continue on WAL snapshots. Backup verification runs beforehand,
// unheld, and integrity is checked afterwards, unheld (client 'check').
export async function upgradeStorage(db, root, { prepared = false, phase = 'all' } = {}) {
    // prepared=true: prepareStorageUpgrade already verified the backup's
    // SHA-256 outside the hold; only confirm it is still present here.
    const progress = prepared ? readProgress(db) : await prepareStorageUpgrade(db, root);
    if (progress.complete) return progress;
    if (!progress.backup) throw Error('Storage upgrade has no verified recovery backup');
    if (prepared) {
        const manifest = JSON.parse(await fs.readFile(progress.backup + '.manifest.json', 'utf8'));
        if (!/^[a-f0-9]{64}$/.test(manifest.sha256 || '') || !(await fs.stat(progress.backup)).size) throw Error('Storage upgrade recovery backup is missing');
    }
    const started = Date.now();
    if (!progress.rowsComplete) {
        db.exec('BEGIN IMMEDIATE');
        try {
            progress.pruned = pruneDerivedCaches(db);
            progress.rowsComplete = true;progress.rowsMs = Date.now() - started;saveProgress(db, progress);db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK');throw error; }
        db.exec('PRAGMA wal_checkpoint(PASSIVE)');
    }
    // The client releases held writes between the two phases.
    if (phase === 'rows') return progress;
    const compactStarted = Date.now();
    // Changing NONE to INCREMENTAL requires one rebuild of an existing database.
    // Future maintenance returns at most 8 MiB of free pages per pass.
    if (db.prepare('PRAGMA auto_vacuum').get().auto_vacuum !== 2) {
        // VACUUM writes a temporary copy plus a database-sized WAL. Refuse
        // (and retry at the next maintenance run) rather than fill the disk.
        const pageBytes = db.prepare('PRAGMA page_size').get().page_size * db.prepare('PRAGMA page_count').get().page_count;
        const file = db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
        if (file) {
            const disk = await fs.statfs(path.dirname(file));
            if (disk.bavail * disk.bsize < 2 * pageBytes + 512 * 1024 * 1024) throw Error('Insufficient free disk space for storage VACUUM; retrying later');
        }
        // PASSIVE: never wait for the main connection's concurrent readers.
        db.exec('PRAGMA wal_checkpoint(PASSIVE); PRAGMA auto_vacuum=INCREMENTAL; VACUUM;');
    }
    // PASSIVE only: TRUNCATE would wait on concurrent readers; the writer's
    // idle checkpoint truncates the WAL afterwards.
    db.exec('PRAGMA optimize=0x10002; PRAGMA wal_checkpoint(PASSIVE);');
    progress.compactMs = Date.now() - compactStarted;progress.complete = true;progress.completedAt = Date.now();
    progress.totalDurationMs = progress.completedAt - progress.startedAt;saveProgress(db, progress);
    console.info('[SQLITE STORAGE UPGRADE]', JSON.stringify(progress));
    return progress;
}
