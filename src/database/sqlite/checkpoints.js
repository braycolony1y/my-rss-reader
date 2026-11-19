// PASSIVE never waits for readers. TRUNCATE is attempted only after all frames
// were checkpointed and the writer has been idle; busy readers always win.
// journal_size_limit bounds retained WAL capacity after reset, not active WAL
// growth: a long-lived reader can legitimately keep more than 16 MiB alive.
export function checkpointSqlite(db, { idle = false } = {}) {
    if (db.isTransaction) return null;
    const result = db.prepare('PRAGMA wal_checkpoint(PASSIVE)').get();
    if (idle && result.busy === 0 && result.log === result.checkpointed) {
        db.exec('PRAGMA busy_timeout=0');
        try { return db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get(); }
        finally { db.exec('PRAGMA busy_timeout=10000'); }
    }
    return result;
}
