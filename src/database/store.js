import {createDatabaseTransactionQueue} from './transaction-queue.js';
import {createKeyedOverlay} from './keyed-overlay.js';
import {createDatabasePersistence} from './persistence.js';
import {createDatabaseAccess} from './access.js';
import {encodeStoredSnapshot,decodeStoredValue,isSerializedValue,storedSnapshotState} from './stored-value.js';
import { createParsedCache } from './parsed-cache.js';
import { PERSONAL_STATE_KEY } from '../smart/feedback/store.js';
import { FILTER_STATE_KEY } from '../smart/prefilter/policy.js';
import { writeJsonSnapshot } from './json-writer.js';
import { readFileSync, unlinkSync } from 'node:fs';
import fs from 'fs/promises';
import path from 'path';
import { repairGoogleNewsRecord } from '../google-news-destination.js';
import { calculateHotness } from '../../smart-news.js';

export function createDatabaseStore() {
    const DB_FILE = './database.json';

    const SMART_DB_FILE = './smart-data.json';
    const SMART_STATE_FILE = './smart-state.json';
    const SMART_STATE_KEYS = new Set([FILTER_STATE_KEY, 'storyBriefings', 'smartStatus', 'smartClusteringCounters', 'smartEventVerificationCache', 'smartEditorialAssessmentCache']);
    let smartStateRevision = 0;
    let smartStateOverlay = {};
    const STATE_FILE = './database-state.json';
    const STATE_KEYS = new Set([PERSONAL_STATE_KEY, 'readStates', 'savedStates', 'hiddenStates', 'boardStates', 'recentReadAt', 'userPreferences', 'cacheMembers', 'cacheIdentityLedger', 'smartAiProviderHealth', 'articleFetchStrategyStats', 'googleNewsUrlCache']);
    let stateRevision = 0;
    let stateOverlay = {};
    const stateFiles = createKeyedOverlay({filename:STATE_FILE,allowedKeys:STATE_KEYS,writeJson:_writeJsonAtomic});
    const smartStateFiles = createKeyedOverlay({filename:SMART_STATE_FILE,allowedKeys:SMART_STATE_KEYS,writeJson:_writeJsonAtomic});


    const SMART_KEYS = new Set([FILTER_STATE_KEY, 'smartClusters', 'smartRawArticles', 'smartCandidateLinks', 'smartCandidateSignature', 'smartAiConfig', 'smartClusterVersion', 'smartStatus', 'smartEmbeddingIdentity', 'smartVerificationFailures', 'smartClusteringInputs', 'smartClusteringFailedAttempt', 'smartClusteringAlgorithmVersion', 'smartClusterState', 'smartEventVerificationCache', 'smartEditorialAssessmentCache', 'smartClusteringCounters', 'smartDeferredReviewGroups', 'smartProgressivePublication', 'smartProgressiveClusterState', 'storyBriefings', 'topStoriesPublished']);

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

    const databaseState = {value: null};

    // In-memory database (source of truth once loaded)
    const _jsonParsedCache = createParsedCache();

    // Version -> clusters history to prevent mid-session flickering on Smart tab
    const transactionQueue = createDatabaseTransactionQueue();

    let _lastRecoverySnapshotAt = 0;

    const FEEDS_BACKUP_FILE = './feeds_backup.json';

    // Separate redundant backup for feeds

    const withDbLock = transactionQueue.run;

    function _parseStoredArray(snapshot, key) {
        const value = snapshot?.[key];
        if (Array.isArray(value)) return value;
        if (!isSerializedValue(value)) return null;
        const cached = _jsonParsedCache.get(key, value);
        if (Array.isArray(cached?.parsed)) return cached.parsed;
        try {
            const parsed = JSON.parse(decodeStoredValue(value));
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
            await writeJsonSnapshot(tempFile, value);
            await fs.rename(tempFile, filename);
            // Let V8 schedule collection. Forcing a full collection after every
            // snapshot/backup repeatedly scans the entire live application heap.
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
        smartStateRevision = Number(mainSnapshot.__smartStateRevision) || 0;
        try {
            const overlay = await smartStateFiles.load(smartStateRevision);
            if (!Number.isSafeInteger(overlay.revision) || !overlay.values ||
                Object.keys(overlay.values).some(key => !SMART_STATE_KEYS.has(key))) throw new Error('Invalid Smart state overlay');
            if (overlay.revision > smartStateRevision) {
                smartStateOverlay = encodeStoredSnapshot(overlay.values);
                smartStateRevision = overlay.revision;
                Object.assign(mainSnapshot, smartStateOverlay);
            }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
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
            const overlay = await stateFiles.load(stateRevision);
            if (!Number.isSafeInteger(overlay.revision) || !overlay.values ||
                Object.keys(overlay.values).some(key => !STATE_KEYS.has(key))) throw new Error('Invalid state overlay');
            if (overlay.revision > stateRevision) {
                stateOverlay = encodeStoredSnapshot(overlay.values);
                stateRevision = overlay.revision;
                Object.assign(mainSnapshot, stateOverlay);
            }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        return encodeStoredSnapshot(mainSnapshot);
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

    const _persistToDisk = createDatabasePersistence({SMART_STATE_KEYS,STATE_KEYS,SMART_KEYS,NON_PERSISTED_DB_KEYS,SMART_DB_FILE,DB_FILE,stateFiles,smartStateFiles,
        getOverlayState: () => ({stateRevision,stateOverlay,smartStateRevision,smartStateOverlay}),
        commitOverlayState: update => {
            if ('stateRevision' in update) stateRevision = update.stateRevision;
            if ('stateOverlay' in update) stateOverlay = update.stateOverlay;
            if ('smartStateRevision' in update) smartStateRevision = update.smartStateRevision;
            if ('smartStateOverlay' in update) smartStateOverlay = update.smartStateOverlay;
        }, _writeJsonAtomic,_validateDatabaseSnapshot,_createRecoverySnapshot});

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
        RSS_DATA: createDatabaseAccess({state: databaseState, withDbLock, _loadDBFromDisk, _jsonParsedCache, _parseStoredArray, _backupFeeds, _persistToDisk, STATE_KEYS}),
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD
    };

    // Keep the lock handle alive for the lifetime of this database owner.
    let databaseWriterLock = null;

    // BACKEND_EAGER_GLOBAL_DB_WARM_V1
    //
    // Warm the global database before normal requests begin.
    // This does NOT create per-view/per-category response caches.
    // It only performs the same global load/JSON parsing that would
    // otherwise be paid by the first foreground /api/data request.
    async function warmGlobalDatabaseMemory() {
        await withDbLock(async () => {
            if (!databaseState.value) {
                databaseState.value = await _loadDBFromDisk();
            }

            const hotJsonKeys = [
                'articles',
                'feeds',
                'readStates',
                'savedStates',
                'boardStates',
                'hiddenStates',
                'recentReadAt',
                'categoryOrder',
                'userPreferences',
                'blockedArticleKeywords'
            ];

            for (const key of hotJsonKeys) {
                const raw = databaseState.value[key];

                if (
                    !isSerializedValue(raw)
                    || _jsonParsedCache.get(key, raw)
                ) {
                    continue;
                }

                try {
                    _jsonParsedCache.set(key, raw, JSON.parse(decodeStoredValue(raw)));
                } catch (error) {
                    console.warn(
                        `[DB WARM] Could not preparse ${key}:`,
                        error.message
                    );
                }
            }
        });

        console.log(
            '[DB WARM] Global database loaded and hot JSON keys parsed'
        );
    }

    async function initializeWriterLock(enabled) {
        databaseWriterLock = enabled ? await acquireDatabaseWriterLock() : null;

        await warmGlobalDatabaseMemory();

        process.on('exit', () => {
            try {
                const owner = JSON.parse(readFileSync(DB_WRITER_LOCK_FILE, 'utf-8'));
                if (Number(owner.pid) === process.pid) unlinkSync(DB_WRITER_LOCK_FILE);
            } catch (e) { }
        });
    }

    return {
        releaseParsedCache() { _jsonParsedCache.clear(); },
        getResourceState: () => ({..._jsonParsedCache.state(), persistentValues:storedSnapshotState(databaseState.value), transactions:transactionQueue.state()}),
        initializeWriterLock,
        env,
        _writeJsonAtomic,
        acquireDatabaseWriterLock
    };
}
