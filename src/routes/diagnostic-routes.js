import { authMiddleware } from '../middleware/auth.js';

export function registerDiagnosticRoutes({
    app,
    processStartTime,
    fetchHistory,
    env,
    manualSyncProgress,
    pruneOldEntries,
    systemLogs,
    sync,
} = {}) {
    // ============================================================================
    // EXPRESS ROUTES
    // ============================================================================

    // Health check endpoint for monitoring
    app.get('/health', (req, res) => {
        const memUsage = process.memoryUsage();
        res.json({
            status: 'ok',
            uptime: Math.round((Date.now() - processStartTime) / 1000),
            uptimeHuman: `${Math.floor((Date.now() - processStartTime) / 3600000)}h ${Math.floor(((Date.now() - processStartTime) % 3600000) / 60000)}m`,
            memory: {
                rss: `${(memUsage.rss / 1024 / 1024).toFixed(1)} MB`,
                heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB`,
                heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(1)} MB`,
                external: `${(memUsage.external / 1024 / 1024).toFixed(1)} MB`
            },
            syncPaused: sync.syncPaused,
            lastSyncCompletedAt: sync.lastSyncCompletedAt ? new Date(sync.lastSyncCompletedAt).toISOString() : null,
            feedCount: fetchHistory.length > 0 ? new Set(fetchHistory.map(h => h.feedUrl)).size : 'unknown'
        });
    });

    // Ping endpoint for keepalive
    app.post('/api/ping-active', (req, res) => {
        res.json({ status: 'ok' });
    });

    app.post('/api/login', (req, res) => {
        if (req.body.password === env.ADMIN_PASSWORD) {
            res.status(200).send('OK');
        } else {
            res.status(401).send('Unauthorized');
        }
    });

    app.get('/api/sync-progress', authMiddleware, (req, res) => {
        const requestId = String(req.query.id || '');
        res.json(manualSyncProgress.get(requestId) || {
            stage: 'waiting',
            message: 'Waiting for refresh to start…',
            done: false
        });
    });

    app.get('/api/logs', authMiddleware, (req, res) => {
        pruneOldEntries(systemLogs);
        res.json(systemLogs);
    });

    app.get('/api/fetch-history', authMiddleware, (req, res) => {
        pruneOldEntries(fetchHistory);
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        // Return only the most recent `limit` entries (newest first)
        const start = Math.max(0, fetchHistory.length - limit);
        res.json(fetchHistory.slice(start).reverse());
    });

    app.get('/api/fetch-summary', authMiddleware, (req, res) => {
        pruneOldEntries(fetchHistory);
        const summary = {};
        for (const entry of fetchHistory) {
            if (!summary[entry.feedUrl]) {
                summary[entry.feedUrl] = { feedUrl: entry.feedUrl, feedTitle: entry.feedTitle, success: 0, error: 0, skipped: 0, total: 0, lastFetch: 0, lastStatus: '', lastDetails: '' };
            }
            const s = summary[entry.feedUrl];
            s.total++;
            if (entry.status === 'success') s.success++;
            else if (entry.status === 'error') s.error++;
            else if (entry.status === 'skipped') s.skipped++;
            if (entry.timestamp > s.lastFetch) {
                s.lastFetch = entry.timestamp;
                s.lastStatus = entry.status;
                s.lastDetails = entry.details;
            }
        }
        res.json(Object.values(summary).sort((a, b) => b.lastFetch - a.lastFetch));
    });

    // Error-only fetch history with full details for debugging
    app.get('/api/fetch-errors', authMiddleware, (req, res) => {
        pruneOldEntries(fetchHistory);
        const limit = Math.min(parseInt(req.query.limit) || 100, 200);
        const errors = fetchHistory
            .filter(e => e.status === 'error')
            .map(e => ({
                timestamp: e.timestamp,
                feedUrl: e.feedUrl,
                feedTitle: e.feedTitle,
                details: e.details,
                durationMs: e.durationMs,
                httpStatus: e.httpStatus || null,
                errorType: e.errorType || 'unknown',
                responseSnippet: e.responseSnippet || null
            }))
            .reverse()
            .slice(0, limit);
        res.json(errors);
    });

    // Sync pause/resume toggle
    app.post('/api/sync-toggle', authMiddleware, (req, res) => {
        sync.syncPaused = !sync.syncPaused;
        console.log(`[SYNC] Auto-sync ${sync.syncPaused ? 'PAUSED' : 'RESUMED'} by user`);
        res.json({ paused: sync.syncPaused });
    });

    app.get('/api/sync-status', authMiddleware, (req, res) => {
        res.json({
            paused: sync.syncPaused,
            lastSyncCompletedAt: sync.lastSyncCompletedAt,
        });
    });

}
