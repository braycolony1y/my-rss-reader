import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { SCHEMA, SCHEMA_VERSION } from './schema.js';

export function openSqlite(filename, { readOnly = false } = {}) {
    if (!readOnly) mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(filename, { readOnly, enableForeignKeyConstraints: true });
    try {
        // SQLite derives WAL/SHM permissions from the database file at creation.
        if(!readOnly&&filename!==':memory:')chmodSync(filename,0o600);
        db.exec('PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE; PRAGMA mmap_size=0;');
        if (!readOnly) {
            const version = db.prepare('PRAGMA user_version').get().user_version;
            if (version > SCHEMA_VERSION) throw Error('SQLite schema is newer than this application; refusing to downgrade');
            db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=1000;');
            db.exec('BEGIN IMMEDIATE');
            try { db.exec(SCHEMA); db.exec(`PRAGMA user_version=${SCHEMA_VERSION}; COMMIT`); }
            catch (error) { db.exec('ROLLBACK'); throw error; }
        }
        return db;
    } catch (error) { db.close(); throw error; }
}

export function assertIntegrity(db, { full = false } = {}) {
    const result = db.prepare(full ? 'PRAGMA integrity_check' : 'PRAGMA quick_check').all();
    if (result.some(row => Object.values(row)[0] !== 'ok')) throw Error('SQLite integrity check failed');
    if (db.prepare('PRAGMA foreign_key_check').get()) throw Error('SQLite foreign key check failed');
    return true;
}
