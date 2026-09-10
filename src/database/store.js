import { readFileSync, unlinkSync } from 'node:fs';
import fs from 'fs/promises';
import path from 'path';
import { repairGoogleNewsRecord } from '../google-news-destination.js';
import { calculateHotness } from '../../smart-news.js';

export function createDatabaseStore() {
    const DB_FILE = './database.json';

    const SMART_DB_FILE = './smart-data.json';
    const STATE_FILE = './database-state.json';
    const STATE_KEYS = new Set(['readStates', 'savedStates', 'hiddenStates', 'boardStates', 'userPreferences', 'cacheMembers', 'cacheIdentityLedger']);
    let stateRevision = 0;
    let stateOverlay = {};


    const SMART_KEYS = new Set(['smartClusters', 'smartRawArticles', 'smartCandidateLinks', 'smartCandidateSignature', 'smartAiConfig', 'smartClusterVersion', 'smartStatus']);

    const NON_PERSISTED_DB_KEYS = new Set(['smartEmbeddings']);

    const DB_WRITER_LOCK_FILE = './database.writer.lock';

    const DB_BACKUP_DIR = './db_backups';

    const MAX_RECOVERY_SNAPSHOTS = 12;

    const RECOVERY_SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000;

    async function acquireDatabaseWriterLock() {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const handle = await fs.open(DB_WRITER_LOCK_FILE, 'wx');
                await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
                return handle;
            } catch (error) {
                if (error.code !== 'EEXIST') throw error;
                let ownerPid = 0;
                try { ownerPid = Number(JSON.parse(await fs.readFile(DB_WRITER_LOCK_FILE, 'utf-8')).pid || 0); } catch (e) { }
                let ownerAlive = false;
                if (ownerPid > 0) {
                    try { process.kill(ownerPid, 0); ownerAlive = true; } catch (e) { }
                }
                if (ownerAlive) throw new Error(`Database writer lock is already held by process ${ownerPid}`);
                await fs.unlink(DB_WRITER_LOCK_FILE).catch(() => {});
            }
        }
        throw new Error('Could not acquire the database writer lock');
    }

    // --- DATABASE LAYER: IN-MEMORY WITH WRITE-THROUGH PERSISTENCE ---
    // The in-memory cache is the source of truth. Disk writes are best-effort persistence.
    // This eliminates ALL race conditions and file corruption issues permanently.

    let _dbCache = null;

    // In-memory database (source of truth once loaded)
    let _jsonParsedCache = {};

    // Version -> clusters history to prevent mid-session flickering on Smart tab
    let _dbMutexQueue = Promise.resolve();

    let _lastRecoverySnapshotAt = 0;

    const FEEDS_BACKUP_FILE = './feeds_backup.json';

    // Separate redundant backup for feeds

    function withDbLock(fn) {
        let release;
        const prev = _dbMutexQueue;
        _dbMutexQueue = new Promise(r => release = r);
        return prev.then(fn).finally(release);
    }

    function _parseStoredArray(snapshot, key) {
        const value = snapshot?.[key];
        if (Array.isArray(value)) return value;
        if (typeof value !== 'string') return null;
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : null;
        } catch (e) {
            return null;
        }
    }

    function _validateDatabaseSnapshot(snapshot, requireCriticalKeys = true) {
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { ok: false, reason: 'Top level is not an object' };
        for (const key of ['articles', 'feeds']) {
            if (!(key in snapshot)) {
                if (requireCriticalKeys) return { ok: false, reason: `Missing ${key}` };
                continue;
            }
            if (!_parseStoredArray(snapshot, key)) return { ok: false, reason: `${key} is not a valid array` };
        }
        return { ok: true };
    }

    async function _writeJsonAtomic(filename, value) {
        const tempFile = `${filename}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        try {
            const serialized = typeof value === 'string' ? value : JSON.stringify(value);
            if (typeof value === 'string') JSON.parse(serialized); // Refuse to place invalid JSON on disk.
            await fs.writeFile(tempFile, serialized, 'utf-8');
            await fs.rename(tempFile, filename);
            if (serialized.length > 5000000 && global.gc) global.gc();
        } catch (error) {
            await fs.unlink(tempFile).catch(() => {});
            throw error;
        }
    }

    async function _readValidSnapshot(filename) {
        try {
            const parsed = JSON.parse(await fs.readFile(filename, 'utf-8'));
            const validation = _validateDatabaseSnapshot(parsed, true);
            if (!validation.ok) throw new Error(validation.reason);
            return parsed;
        } catch (error) {
            console.error(`[DB WARNING] ${filename} is not usable:`, error.message);
            return null;
        }
    }

    async function _recoverySnapshotFiles() {
        try {
            const entries = await fs.readdir(DB_BACKUP_DIR);
            return entries
                .filter(name => /^database-.*\.json$/.test(name))
                .sort()
                .reverse()
                .map(name => path.join(DB_BACKUP_DIR, name));
        } catch (e) {
            return [];
        }
    }

    async function _loadDBFromDisk() {
        let mainSnapshot = await _readValidSnapshot(DB_FILE);
        let backupSnapshot = null;
        if (mainSnapshot) {
            backupSnapshot = await _readValidSnapshot(DB_FILE + '.backup');
            if (backupSnapshot) {
                const mainFeeds = _parseStoredArray(mainSnapshot, 'feeds') || [];
                const mainArticles = _parseStoredArray(mainSnapshot, 'articles') || [];
                const backupFeeds = _parseStoredArray(backupSnapshot, 'feeds') || [];
                const backupArticles = _parseStoredArray(backupSnapshot, 'articles') || [];
                const suspiciousFeedLoss = backupFeeds.length > 0 && mainFeeds.length < Math.ceil(backupFeeds.length * 0.1);
                const suspiciousArticleLoss = backupArticles.length > 0 && mainArticles.length < Math.ceil(backupArticles.length * 0.1);
                if (suspiciousFeedLoss || suspiciousArticleLoss) {
                    console.error('[DB SAFETY] Main database shows destructive content loss; restoring the previous backup.');
                    mainSnapshot = backupSnapshot;
                    await _writeJsonAtomic(DB_FILE, backupSnapshot);
                }
            }
        }
        if (!mainSnapshot) {
            const filenames = [DB_FILE + '.backup', ...await _recoverySnapshotFiles()];
            for (const filename of filenames) {
                const snapshot = await _readValidSnapshot(filename);
                if (snapshot) {
                    console.log(`[DB SAFETY] Restored database from ${filename}`);
                    try { await _writeJsonAtomic(DB_FILE, snapshot); } catch (error) {}
                    mainSnapshot = snapshot;
                    break;
                }
            }
        }
        if (!mainSnapshot) {
            console.log('[DB INFO] No valid database found. Starting a new database.');
            mainSnapshot = { articles: '[]', feeds: '[]' };
        }
        let removedLegacyEmbeddingCache = false;
        for (const snapshot of [mainSnapshot, backupSnapshot]) {
            if (snapshot && Object.hasOwn(snapshot, 'smartEmbeddings')) {
                delete snapshot.smartEmbeddings;
                removedLegacyEmbeddingCache = true;
            }
        }
        if (removedLegacyEmbeddingCache) {
            console.log('[DB MIGRATION] Removing the legacy embedding cache from the main database...');
            await _writeJsonAtomic(DB_FILE, mainSnapshot);
            if (backupSnapshot) {
                await _writeJsonAtomic(DB_FILE + '.backup', backupSnapshot);
            }
        }
        try {
            const smartSnapshot = JSON.parse(await fs.readFile(SMART_DB_FILE, 'utf-8'));
            if (smartSnapshot && typeof smartSnapshot === 'object') {
                for (const key of NON_PERSISTED_DB_KEYS) delete smartSnapshot[key];
                Object.assign(mainSnapshot, smartSnapshot);
            }
        } catch (e) {
            const smartData = {};
            let hasSmartInMain = false;
            for (const k of SMART_KEYS) {
                if (k in mainSnapshot && mainSnapshot[k] !== undefined) {
                    smartData[k] = mainSnapshot[k];
                    hasSmartInMain = true;
                }
            }
            if (hasSmartInMain) {
                console.log('[DB MIGRATION] Separating smart data out of database.json into smart-data.json...');
                try {
                    await _writeJsonAtomic(SMART_DB_FILE, smartData);
                    const cleanedMain = {};
                    for (const k in mainSnapshot) if (!SMART_KEYS.has(k)) cleanedMain[k] = mainSnapshot[k];
                    await _writeJsonAtomic(DB_FILE, cleanedMain);
                    console.log('[DB MIGRATION] Successfully separated smart data into smart-data.json!');
                } catch (err) {
                    console.error('[DB MIGRATION ERROR]', err.message);
                }
            }
        }
        // Repair historical publisher mismatches before any list or sync reads them.
        for (const key of ['articles', 'smartRawArticles', 'smartClusters']) {
            if (!mainSnapshot[key]) continue;
            try {
                const records = JSON.parse(mainSnapshot[key]);
                if (Array.isArray(records)) mainSnapshot[key] = JSON.stringify(records.map(record => {
                    const repaired = repairGoogleNewsRecord(record);
                    if (repaired && repaired !== record) repaired.hotness = calculateHotness([repaired, ...(repaired.relatedArticles || [])]);
                    return repaired;
                }).filter(Boolean));
            } catch { }
        }
        // Older batch-decoded destinations cannot be trusted, even on the same host.
        if (mainSnapshot.googleNewsUrlCache) {
            try {
                const cache = JSON.parse(mainSnapshot.googleNewsUrlCache);
                mainSnapshot.googleNewsUrlCache = JSON.stringify(Object.fromEntries(Object.entries(cache).filter(([, entry]) => entry.individuallyDecoded === true)));
            } catch { }
        }
        // Recover acknowledged lightweight state writes after a restart. The
        // revision prevents an old overlay replaying over a newer full snapshot.
        stateRevision = Number(mainSnapshot.__stateRevision) || 0;
        try {
            const overlay = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
            if (!Number.isSafeInteger(overlay.revision) || !overlay.values ||
                Object.keys(overlay.values).some(key => !STATE_KEYS.has(key))) throw new Error('Invalid state overlay');
            if (overlay.revision > stateRevision) {
                stateOverlay = overlay.values;
                stateRevision = overlay.revision;
                Object.assign(mainSnapshot, stateOverlay);
            }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        return mainSnapshot;
    }

    async function _createRecoverySnapshot(snapshot) {
        if (Date.now() - _lastRecoverySnapshotAt < RECOVERY_SNAPSHOT_INTERVAL_MS) return;
        const validation = _validateDatabaseSnapshot(snapshot, true);
        if (!validation.ok) return;
        await fs.mkdir(DB_BACKUP_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await _writeJsonAtomic(path.join(DB_BACKUP_DIR, `database-${stamp}.json`), snapshot);
        _lastRecoverySnapshotAt = Date.now();
        const files = await _recoverySnapshotFiles();
        for (const oldFile of files.slice(MAX_RECOVERY_SNAPSHOTS)) {
            await fs.unlink(oldFile).catch(() => {});
        }
    }

    async function _persistToDisk(data, previousData, updatedKeys = null, options = {}) {
        const changedKeys = Array.isArray(updatedKeys)
            ? updatedKeys
            : (updatedKeys ? [updatedKeys] : []);
        if (options.lightweight && changedKeys.length && changedKeys.every(key => STATE_KEYS.has(key))) {
            const values = { ...stateOverlay };
            for (const key of changedKeys) values[key] = data[key];
            const revision = stateRevision + 1;
            await _writeJsonAtomic(STATE_FILE, { revision, values });
            stateOverlay = values;
            stateRevision = revision;
            return;
        }
        const smartChanged = changedKeys.some(key => SMART_KEYS.has(key));
        const mainChanged = changedKeys.length === 0 || changedKeys.some(key => !SMART_KEYS.has(key));

        if (smartChanged) {
            const smartData = {};
            for (const k of SMART_KEYS) if (k in data && data[k] !== undefined) smartData[k] = data[k];
            if (previousData) {
                const prevSmartData = {};
                for (const k of SMART_KEYS) if (k in previousData && previousData[k] !== undefined) prevSmartData[k] = previousData[k];
                if (Object.keys(prevSmartData).length > 0) {
                    await _writeJsonAtomic(SMART_DB_FILE + '.backup', prevSmartData).catch(() => {});
                }
            }
            await _writeJsonAtomic(SMART_DB_FILE, smartData);
            if (!mainChanged) return;
        }

        const mainData = {};
        for (const k in data) if (!SMART_KEYS.has(k) && !NON_PERSISTED_DB_KEYS.has(k) && data[k] !== undefined) mainData[k] = data[k];

        mainData.__stateRevision = stateRevision;
        const validation = _validateDatabaseSnapshot(mainData, true);
        if (!validation.ok) throw new Error(`Refusing unsafe database write: ${validation.reason}`);

        if (previousData) {
            const prevMainData = {};
            for (const k in previousData) if (!SMART_KEYS.has(k) && !NON_PERSISTED_DB_KEYS.has(k) && previousData[k] !== undefined) prevMainData[k] = previousData[k];
            prevMainData.__stateRevision = stateRevision;
            if (_validateDatabaseSnapshot(prevMainData, true).ok) {
                await _writeJsonAtomic(DB_FILE + '.backup', prevMainData);
                await _createRecoverySnapshot(prevMainData).catch(error => {
                    console.error('[DB WARNING] Could not create rotating recovery snapshot:', error.message);
                });
            }
        }
        await _writeJsonAtomic(DB_FILE, mainData);
        // The full snapshot now contains all overlay values. A crash before
        // unlink is safe because readers compare revisions before replaying.
        stateOverlay = {};
        await fs.unlink(STATE_FILE).catch(error => { if (error.code !== 'ENOENT') console.warn('[DB STATE]', error.message); });
    }

    // Separately backup feeds to a dedicated file for extra safety
    async function _backupFeeds(feedsStr, previousFeedsStr = null) {
        try {
            if (previousFeedsStr) await _writeJsonAtomic(FEEDS_BACKUP_FILE + '.backup', previousFeedsStr);
            await _writeJsonAtomic(FEEDS_BACKUP_FILE, feedsStr);
        } catch (e) {
            console.error('[DB WARNING] Could not update dedicated feed backup:', e.message);
        }
    }

    // Recover feeds from the dedicated backup file
    async function _recoverFeeds() {
        for (const filename of [FEEDS_BACKUP_FILE, FEEDS_BACKUP_FILE + '.backup']) {
            try {
                const feeds = JSON.parse(await fs.readFile(filename, 'utf-8'));
                if (Array.isArray(feeds) && feeds.length > 0) {
                    console.log(`[DB SAFETY] Recovered ${feeds.length} feeds from ${filename}`);
                    return JSON.stringify(feeds);
                }
            } catch (e) { }
        }
        return null;
    }

    const env = {
        RSS_DATA: {
            get: async (key, opts) => {
                if (!_dbCache) {
                    await withDbLock(async () => {
                        if (!_dbCache) _dbCache = await _loadDBFromDisk();
                    });
                }
                let val = _dbCache[key];
                if (!val) return null;
                if (opts && opts.type === 'json' && typeof val === 'string') {
                    if (_jsonParsedCache[key]?.raw === val) {
                        return opts.shared ? _jsonParsedCache[key].parsed : structuredClone(_jsonParsedCache[key].parsed);
                    }
                    const parsed = JSON.parse(val);
                    _jsonParsedCache[key] = { raw: val, parsed };
                    return opts.shared ? parsed : structuredClone(parsed);
                }
                return val;
            },
            put: (key, value, options = {}) => withDbLock(async () => {
                delete _jsonParsedCache[key];
                if (!_dbCache) _dbCache = await _loadDBFromDisk();
                const previous = _dbCache;
                const next = { ...previous, [key]: value };

                if (['feeds', 'articles', 'smartRawArticles', 'smartClusters', 'blockedArticleKeywords'].includes(key)) {
                    const oldItems = _parseStoredArray(previous, key) || [];
                    const newItems = _parseStoredArray(next, key);
                    if (!newItems) throw new Error(`[DB SAFETY] ${key} write is not a valid array`);
                    if (oldItems.length > 0 && newItems.length === 0) {
                        throw new Error(`[DB SAFETY] Refusing to wipe ${oldItems.length} ${key}`);
                    }
                    const destructiveDrop = oldItems.length >= 20 && newItems.length < Math.ceil(oldItems.length * 0.1);
                    if (destructiveDrop && !options.allowLargeReduction) {
                        throw new Error(`[DB SAFETY] Refusing unexpected ${key} reduction from ${oldItems.length} to ${newItems.length}`);
                    }
                }

                if (key === 'feeds') {
                    const oldFeeds = _parseStoredArray(previous, key) || [];
                    const newFeeds = _parseStoredArray(next, key) || [];
                    const destructiveDrop = oldFeeds.length >= 3 && newFeeds.length < Math.ceil(oldFeeds.length * 0.5);
                    if (destructiveDrop && !options.allowLargeReduction) {
                        throw new Error(`[DB SAFETY] Refusing unexpected feed reduction from ${oldFeeds.length} to ${newFeeds.length}`);
                    }
                    await _backupFeeds(JSON.stringify(newFeeds), oldFeeds.length ? JSON.stringify(oldFeeds) : null);
                }

                _dbCache = next;
                try {
                    await _persistToDisk(next, previous, key, { ...options, lightweight: STATE_KEYS.has(key) });
                } catch (err) {
                    _dbCache = previous; // rollback on failure
                    throw err;
                }
            }),
            putMany: (keyValuePairs, options = {}) => withDbLock(async () => {
                if (!_dbCache) _dbCache = await _loadDBFromDisk();
                const previous = _dbCache;
                let next = { ...previous };

                for (const [key, value] of Object.entries(keyValuePairs)) {
                    delete _jsonParsedCache[key];
                    next[key] = value;

                    if (['feeds', 'articles', 'smartRawArticles', 'smartClusters', 'blockedArticleKeywords'].includes(key)) {
                        const oldItems = _parseStoredArray(previous, key) || [];
                        const newItems = _parseStoredArray(next, key);
                        if (!newItems) throw new Error(`[DB SAFETY] ${key} write is not a valid array`);
                        if (oldItems.length > 0 && newItems.length === 0) {
                            throw new Error(`[DB SAFETY] Refusing to wipe ${oldItems.length} ${key}`);
                        }
                        const destructiveDrop = oldItems.length >= 20 && newItems.length < Math.ceil(oldItems.length * 0.1);
                        if (destructiveDrop && !options.allowLargeReduction) {
                            throw new Error(`[DB SAFETY] Refusing unexpected ${key} reduction from ${oldItems.length} to ${newItems.length}`);
                        }
                    }

                    if (key === 'feeds') {
                        const oldFeeds = _parseStoredArray(previous, key) || [];
                        const newFeeds = _parseStoredArray(next, key) || [];
                        const destructiveDrop = oldFeeds.length >= 3 && newFeeds.length < Math.ceil(oldFeeds.length * 0.5);
                        if (destructiveDrop && !options.allowLargeReduction) {
                            throw new Error(`[DB SAFETY] Refusing unexpected feed reduction from ${oldFeeds.length} to ${newFeeds.length}`);
                        }
                        await _backupFeeds(JSON.stringify(newFeeds), oldFeeds.length ? JSON.stringify(oldFeeds) : null);
                    }
                }

                _dbCache = next;
                try {
                    await _persistToDisk(next, previous, Object.keys(keyValuePairs), options);
                } catch (err) {
                    _dbCache = previous; // rollback on failure
                    throw err;
                }
            })
        },
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD
    };

    // Keep the lock handle alive for the lifetime of this database owner.
    let databaseWriterLock = null;
    async function initializeWriterLock(enabled) {
        databaseWriterLock = enabled ? await acquireDatabaseWriterLock() : null;
        process.on('exit', () => {
            try {
                const owner = JSON.parse(readFileSync(DB_WRITER_LOCK_FILE, 'utf-8'));
                if (Number(owner.pid) === process.pid) unlinkSync(DB_WRITER_LOCK_FILE);
            } catch (e) { }
        });
    }

    return {
        initializeWriterLock,
        env,
        _writeJsonAtomic,
        acquireDatabaseWriterLock
    };
}
